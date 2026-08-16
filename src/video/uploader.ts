import { readVideoCsv, writeVideoCsv } from './csv-store'
import { VideoBackendClient } from './backend'
import { loadVideoBackendConfig } from './config'
import { pathExists } from '../fs-utils'
import { VIDEO_LANGUAGES, resolveWorkPaths, type WorkPaths } from './paths'
import { readUploadState, writeUploadState } from './state-store'
import type { UploadItemState, UploadState, VideoCreatePayload } from './types'
import type { VideoCsvRow } from './video-schema'

export interface UploadResult {
  workDir: string
  csvPaths: string[]
  total: number
  completed: number
  failed: number
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function persist(
  paths: WorkPaths,
  rows: readonly VideoCsvRow[],
  state: UploadState
): Promise<void> {
  await writeVideoCsv(paths.csvPath, rows)
  await writeUploadState(paths.statePath, state)
}

function markItem(
  item: UploadItemState,
  stage: UploadItemState['stage'],
  error: string | null = null
): void {
  item.stage = stage
  item.lastError = error
  item.updatedAt = new Date().toISOString()
}

function parseTags(value: string, fieldName: string, item: UploadItemState): string[] {
  let tags: unknown
  try {
    tags = JSON.parse(value)
  } catch {
    throw new Error(`${item.relativeVideoPath} 的 ${fieldName} 必须是 JSON 数组`)
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() !== tag)) {
    throw new Error(`${item.relativeVideoPath} 的 ${fieldName} 必须是元素无首尾空格的字符串数组`)
  }
  return tags
}

async function ensureVideoTags(
  rows: readonly VideoCsvRow[],
  state: UploadState,
  client: VideoBackendClient
): Promise<void> {
  const tagNames = new Set<string>()
  for (const item of state.items) {
    const row = rows[item.rowIndex]
    if (!row) throw new Error(`状态文件中的 rowIndex 越界: ${item.rowIndex}`)
    for (const tag of parseTags(row.primaryTags, 'primaryTags', item)) tagNames.add(tag)
    for (const tag of parseTags(row.secondaryTags, 'secondaryTags', item)) tagNames.add(tag)
  }
  if (tagNames.size === 0) return
  console.log(`检查并创建本次视频标签: ${[...tagNames].join('、')}`)
  await client.ensureTags([...tagNames])
}

export function createVideoPayload(row: VideoCsvRow, item: UploadItemState): VideoCreatePayload {
  if (row.language !== 'zh' && row.language !== 'en') {
    throw new Error(`${item.relativeVideoPath} 的 language 必须是 zh 或 en`)
  }
  if (Array.from(row.title).length > 128) {
    throw new Error(`${item.relativeVideoPath} 的 title 超过 128 个字符`)
  }
  const titleDescription = row.titleDescription === '' ? ' ' : row.titleDescription
  if (Array.from(titleDescription).length > 256) {
    throw new Error(`${item.relativeVideoPath} 的 titleDescription 超过 256 个字符`)
  }
  const difficulty = Number(row.difficulty)
  if (difficulty !== 10 && difficulty !== 20 && difficulty !== 30) {
    throw new Error(`${item.relativeVideoPath} 的 difficulty 必须是 10、20 或 30`)
  }
  if (!row.coverId || !row.coverUrl || !row.videoUid) {
    throw new Error(`${item.relativeVideoPath} 缺少封面或视频标识，不能写入 video 表`)
  }

  return {
    language: row.language,
    difficulty,
    title: row.title,
    titleDescription,
    coverId: row.coverId,
    coverUrl: row.coverUrl,
    primaryTags: parseTags(row.primaryTags, 'primaryTags', item),
    secondaryTags: parseTags(row.secondaryTags, 'secondaryTags', item),
    videoUid: row.videoUid,
  }
}

export function saveCreatedVideo(
  item: UploadItemState,
  createdVideo: {
    id: number
    videoDuration?: number
    videoSize?: number
  }
): void {
  if (!Number.isSafeInteger(createdVideo.id) || createdVideo.id <= 0) {
    throw new Error(`${item.relativeVideoPath} 的 /video/add 响应缺少有效 video id`)
  }
  item.videoId = createdVideo.id
  item.videoDuration = createdVideo.videoDuration
  item.videoSize = createdVideo.videoSize
}

interface LanguageUploadResult {
  total: number
  completed: number
  failed: number
}

async function uploadLanguage(
  paths: WorkPaths,
  client: VideoBackendClient
): Promise<LanguageUploadResult> {
  const [rows, state] = await Promise.all([
    readVideoCsv(paths.csvPath),
    readUploadState(paths.statePath),
  ])
  if (rows.length !== state.items.length) {
    throw new Error(`CSV 有 ${rows.length} 行，但状态文件有 ${state.items.length} 项，不能安全续跑`)
  }
  await ensureVideoTags(rows, state, client)

  let completed = 0
  let failed = 0
  for (const [index, item] of state.items.entries()) {
    const row = rows[item.rowIndex]
    console.log(`[上传 ${index + 1}/${state.items.length}] ${item.relativeVideoPath}`)

    try {
      if (!row) throw new Error(`状态文件中的 rowIndex 越界: ${item.rowIndex}`)
      if (item.videoRegistered) {
        if (!item.videoId) throw new Error('状态显示已写入 video 表，但缺少 videoId')
        if (!item.videoPublished) {
          console.log(`  发布视频 (ID: ${item.videoId})...`)
          await client.publishVideo(item.videoId)
          item.videoPublished = true
          await writeUploadState(paths.statePath, state)
        }
        markItem(item, 'completed')
        completed += 1
        await writeUploadState(paths.statePath, state)
        console.log('  跳过上传，已写入并发布 video 表记录')
        continue
      }

      if (!row.videoUid) {
        if (!(await pathExists(item.videoPath)))
          throw new Error(`视频文件不存在: ${item.videoPath}`)
        console.log('  上传视频...')
        const upload = await client.createResumableVideoUpload(item.videoPath)
        row.videoUid = upload.uid
        item.videoUploadUrl = upload.uploadUrl
        markItem(item, 'video-uploaded')
        await persist(paths, rows, state)
      }

      if (item.videoUploadUrl) {
        if (!(await pathExists(item.videoPath)))
          throw new Error(`视频文件不存在: ${item.videoPath}`)
        console.log(`  直传视频到 Cloudflare Stream (UID: ${row.videoUid})...`)
        await client.uploadVideoToTus(item.videoPath, item.videoUploadUrl)
        delete item.videoUploadUrl
        markItem(item, 'video-uploaded')
        await persist(paths, rows, state)
      } else {
        console.log(`  跳过视频直传，已有 UID: ${row.videoUid}`)
      }

      if (!row.coverId || !row.coverUrl) {
        if (!(await pathExists(item.coverPath)))
          throw new Error(`封面文件不存在: ${item.coverPath}`)
        if (!item.imageUploadUrl || !item.imageId || !item.imageVisitUrl) {
          console.log('  创建封面直传会话...')
          const upload = await client.createImageUpload()
          item.imageUploadUrl = upload.uploadUrl
          item.imageId = upload.id
          item.imageVisitUrl = upload.visitUrl
          await writeUploadState(paths.statePath, state)
        }

        console.log('  直传封面到 Cloudflare Images...')
        await client.uploadImageToDirectUrl(item.coverPath, item.imageUploadUrl)
        row.coverId = item.imageId
        row.coverUrl = item.imageVisitUrl
        delete item.imageUploadUrl
        delete item.imageId
        delete item.imageVisitUrl
        await persist(paths, rows, state)
      } else {
        console.log(`  跳过封面上传，已有 ID: ${row.coverId}`)
      }

      console.log('  等待视频转码并写入 video 表...')
      saveCreatedVideo(item, await client.addVideoWhenReady(createVideoPayload(row, item)))
      item.videoRegistered = true
      await writeUploadState(paths.statePath, state)

      const videoId = item.videoId
      if (!videoId) throw new Error('写入 video 表后缺少 videoId')
      console.log(`  发布视频 (ID: ${videoId})...`)
      await client.publishVideo(videoId)
      item.videoPublished = true
      markItem(item, 'completed')
      completed += 1
      await persist(paths, rows, state)
      console.log('  完成，已写入并发布 video 表记录')
    } catch (error) {
      failed += 1
      markItem(item, 'failed', message(error))
      await writeUploadState(paths.statePath, state)
      console.error(`  失败: ${item.lastError}`)
    }
  }

  return { total: state.items.length, completed, failed }
}

export async function uploadVideos(workDir: string): Promise<UploadResult> {
  const workPaths: WorkPaths[] = []

  for (const language of VIDEO_LANGUAGES) {
    const paths = resolveWorkPaths(workDir, language)
    const [csvExists, stateExists] = await Promise.all([
      pathExists(paths.csvPath),
      pathExists(paths.statePath),
    ])
    if (csvExists !== stateExists) {
      throw new Error(`${language} 的 CSV 与上传状态不完整，请先执行 scan`)
    }
    if (csvExists) workPaths.push(paths)
  }

  if (workPaths.length === 0) {
    throw new Error('缺少 en 或 zh 的 CSV 和上传状态，请先执行 scan')
  }

  const client = new VideoBackendClient(loadVideoBackendConfig())
  const languageResults: LanguageUploadResult[] = []
  for (const paths of workPaths) {
    console.log(`\n[${paths.language}]`)
    languageResults.push(await uploadLanguage(paths, client))
  }

  return {
    workDir: resolveWorkPaths(workDir, VIDEO_LANGUAGES[0]).workDir,
    total: languageResults.reduce((sum, result) => sum + result.total, 0),
    completed: languageResults.reduce((sum, result) => sum + result.completed, 0),
    failed: languageResults.reduce((sum, result) => sum + result.failed, 0),
    csvPaths: workPaths.map((paths) => paths.csvPath),
  }
}
