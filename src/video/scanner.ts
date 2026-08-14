import { join, resolve } from 'node:path'

import { ensureDirectory, pathExists } from '../fs-utils'
import { readVideoCsv, writeVideoCsv } from './csv-store'
import {
  assertDirectory,
  coverFilePath,
  discoverVideos,
  extractFirstFrame,
  stateKey,
  videoTitle,
} from './fs-utils'
import { VIDEO_LANGUAGES, resolveWorkPaths, type WorkPaths } from './paths'
import { readUploadState, writeUploadState } from './state-store'
import type { UploadItemState, UploadState } from './types'
import { createDefaultVideoRow, type VideoCsvRow } from './video-schema'

export interface ScanOptions {
  sourceDir?: string
  workDir: string
  force?: boolean
}

export interface ScanResult {
  workDir: string
  total: number
  added: number
  failures: number
  csvPaths: string[]
}

async function scanLanguage(
  sourceDir: string,
  paths: WorkPaths,
  force: boolean
): Promise<{ added: number; failures: number; total: number }> {
  await assertDirectory(sourceDir)

  const videos = await discoverVideos(sourceDir)
  await Promise.all([ensureDirectory(paths.coverDir), ensureDirectory(paths.docDir)])
  const now = new Date().toISOString()
  const csvExists = await pathExists(paths.csvPath)
  const stateExists = await pathExists(paths.statePath)
  if (!force && csvExists !== stateExists) {
    throw new Error(`${paths.language} 的 CSV 与上传状态不完整，无法安全增量扫描`)
  }

  const isNewBatch = force || !csvExists
  const rows: VideoCsvRow[] = isNewBatch ? [] : await readVideoCsv(paths.csvPath)
  const state: UploadState = isNewBatch
    ? {
        version: 2,
        sourceDir,
        workDir: paths.workDir,
        createdAt: now,
        updatedAt: now,
        items: [],
      }
    : await readUploadState(paths.statePath)

  if (rows.length !== state.items.length) {
    throw new Error(`${paths.language} 的 CSV 与上传状态行数不一致，无法安全增量扫描`)
  }

  const existingKeys = new Set(state.items.map((item) => item.key))
  const newItems: UploadState['items'] = []
  for (const videoPath of videos) {
    const title = videoTitle(videoPath)
    if (Array.from(title).length > 128) {
      throw new Error(`视频标题超过 128 个字符: ${videoPath}`)
    }
    const key = stateKey(sourceDir, videoPath)
    if (existingKeys.has(key)) continue

    const coverPath = coverFilePath(paths.coverDir, key, title)
    rows.push(createDefaultVideoRow(title, paths.language))
    const item: UploadItemState = {
      key,
      rowIndex: rows.length - 1,
      relativeVideoPath: key,
      videoPath,
      coverPath,
      stage: 'pending',
      lastError: null,
      updatedAt: now,
    }
    state.items.push(item)
    newItems.push(item)
  }

  if (isNewBatch || newItems.length > 0) {
    await writeVideoCsv(paths.csvPath, rows)
    await writeUploadState(paths.statePath, state)
  }

  let failures = 0
  const newKeys = new Set(newItems.map((item) => item.key))
  const itemsNeedingCover: UploadState['items'] = []
  for (const item of state.items) {
    if (newKeys.has(item.key) || !(await pathExists(item.coverPath))) {
      itemsNeedingCover.push(item)
    }
  }

  for (const [index, item] of itemsNeedingCover.entries()) {
    console.log(`[封面 ${index + 1}/${itemsNeedingCover.length}] ${item.relativeVideoPath}`)
    try {
      await extractFirstFrame(item.videoPath, item.coverPath)
      item.stage = 'cover-created'
      item.lastError = null
    } catch (error) {
      failures += 1
      item.stage = 'failed'
      item.lastError = error instanceof Error ? error.message : String(error)
      console.error(`  失败: ${item.lastError}`)
    }
    item.updatedAt = new Date().toISOString()
    await writeUploadState(paths.statePath, state)
  }

  return { total: state.items.length, added: newItems.length, failures }
}

export async function scanVideos(options: ScanOptions): Promise<ScanResult> {
  const workDir = resolve(options.workDir)
  const sourceRoot = resolve(options.sourceDir || join(workDir, 'video'))
  const results = await Promise.all(
    VIDEO_LANGUAGES.map(async (language) => {
      const paths = resolveWorkPaths(workDir, language)
      const result = await scanLanguage(join(sourceRoot, language), paths, Boolean(options.force))
      return { ...result, paths }
    })
  )

  const total = results.reduce((sum, result) => sum + result.total, 0)
  if (total === 0) {
    throw new Error(`目录中未找到支持的视频文件: ${sourceRoot}`)
  }
  return {
    workDir,
    total,
    added: results.reduce((sum, result) => sum + result.added, 0),
    failures: results.reduce((sum, result) => sum + result.failures, 0),
    csvPaths: results.map((result) => result.paths.csvPath),
  }
}
