import { join, resolve } from 'node:path'

import { ensureDirectory, pathExists } from '../fs-utils'
import { readVideoCsv, writeVideoCsv } from './csv-store'
import {
  assertDirectory,
  coverFilePath,
  discoverVideos,
  extractCoverFrame,
  stateKey,
  videoTitle,
} from './fs-utils'
import { VIDEO_LANGUAGES, resolveWorkPaths, type WorkPaths } from './paths'
import { readUploadState, writeUploadState } from './state-store'
import { readVideoTagConfig } from './tag-config'
import type { UploadItemState, UploadState } from './types'
import { createDefaultVideoRow, type VideoCsvRow } from './video-schema'

export interface ScanOptions {
  sourceDir?: string
  workDir: string
  force?: boolean
  tagConfigPath?: string
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
  videos: readonly string[],
  paths: WorkPaths,
  force: boolean,
  primaryTagsByTitle?: ReadonlyMap<string, string>
): Promise<{ added: number; failures: number; total: number }> {
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

  let rowsChanged = false
  for (const item of state.items) {
    const row = rows[item.rowIndex]
    if (!row) throw new Error(`状态文件中的 rowIndex 越界: ${item.rowIndex}`)

    const expectedTitle = videoTitle(item.videoPath)
    if (row.title !== expectedTitle) {
      if (item.videoRegistered || item.videoPublished) {
        throw new Error(`已入库视频的 title 与文件名不一致: ${item.relativeVideoPath}`)
      }
      row.title = expectedTitle
      rowsChanged = true
    }
  }
  if (primaryTagsByTitle) {
    for (const item of state.items) {
      const row = rows[item.rowIndex]
      if (!row) throw new Error(`状态文件中的 rowIndex 越界: ${item.rowIndex}`)
      const title = videoTitle(item.videoPath)
      const primaryTag = primaryTagsByTitle.get(title)
      if (!primaryTag) throw new Error(`视频未匹配到介绍视频标签: ${item.relativeVideoPath}`)

      const expectedTags = JSON.stringify([primaryTag])
      if (row.primaryTags !== expectedTags) {
        if (item.videoRegistered || item.videoPublished) {
          throw new Error(`已入库视频的 primaryTags 与配置不一致: ${item.relativeVideoPath}`)
        }
        row.primaryTags = expectedTags
        rowsChanged = true
      }
    }
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
    const row = createDefaultVideoRow(title, paths.language)
    const primaryTag = primaryTagsByTitle?.get(title)
    if (primaryTagsByTitle && !primaryTag) {
      throw new Error(`视频未匹配到介绍视频标签: ${key}`)
    }
    if (primaryTag) row.primaryTags = JSON.stringify([primaryTag])
    rows.push(row)
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

  if (isNewBatch || newItems.length > 0 || rowsChanged) {
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
      await extractCoverFrame(item.videoPath, item.coverPath)
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
  const languageDirectories = await Promise.all(
    VIDEO_LANGUAGES.map(async (language) => ({
      language,
      exists: await pathExists(join(sourceRoot, language)),
    }))
  )
  const languages = languageDirectories
    .filter(({ exists }) => exists)
    .map(({ language }) => language)
  if (languages.length === 0) {
    throw new Error(`视频根目录中缺少 en 或 zh 子目录: ${sourceRoot}`)
  }

  const tagConfig = options.tagConfigPath
    ? await readVideoTagConfig(resolve(options.tagConfigPath))
    : undefined
  if (tagConfig && !languages.includes('en')) {
    throw new Error('标签配置仅适用于英文视频，但视频根目录中缺少 en 子目录')
  }

  // 在生成任何 CSV、状态或封面前完成所有目录读取和英文标签匹配。
  const languageSources = await Promise.all(
    languages.map(async (language) => {
      const sourceDir = join(sourceRoot, language)
      await assertDirectory(sourceDir)
      return { language, sourceDir, videos: await discoverVideos(sourceDir) }
    })
  )
  const englishSource = languageSources.find(({ language }) => language === 'en')
  const primaryTagsByTitle =
    tagConfig && englishSource
      ? tagConfig.matchVideoTitles(englishSource.videos.map(videoTitle))
      : undefined

  const results = await Promise.all(
    languageSources.map(async ({ language, sourceDir, videos }) => {
      const paths = resolveWorkPaths(workDir, language)
      const result = await scanLanguage(
        sourceDir,
        videos,
        paths,
        Boolean(options.force),
        language === 'en' ? primaryTagsByTitle : undefined
      )
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
