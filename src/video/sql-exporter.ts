import { join, resolve } from 'node:path'

import { atomicWrite, pathExists } from '../fs-utils'
import { VideoBackendClient } from './backend'
import { loadVideoBackendConfig } from './config'
import { VIDEO_LANGUAGES, resolveWorkPaths } from './paths'
import { readUploadState } from './state-store'

export interface VideoExportRow {
  id: number
  crossId: string
  title: string
  titleDescription: string
  coverId: string
  coverUrl: string
  status: number
  difficulty: number
  isDeleted: number
  primaryTags: string[]
  secondaryTags: string[]
  publishedAt: number
  videoDuration: number
  videoSize: number
  videoUid: string
  gmtCreate: number
}

export interface VideoExportBackend {
  listVideosByIds(ids: readonly number[]): Promise<VideoExportRow[]>
  close?(): Promise<void>
}

export interface VideoSqlExportResult {
  outputPath: string
  count: number
  videoIds: number[]
}

const VIDEO_COLUMNS = [
  'uk_cross_id',
  'title',
  'language',
  'title_description',
  'cover_id',
  'cover_url',
  'status',
  'difficulty',
  'is_deleted',
  'primary_tags',
  'secondary_tags',
  'published_by',
  'published_at',
  'video_duration',
  'video_size',
  'video_uid',
  'created_by',
  'updated_by',
  'gmt_create',
  'gmt_modified',
] as const

/** 与数据库回填 SQL 的 `[一-鿿]` 规则保持一致。 */
export function deriveVideoLanguage(title: string): 'zh' | 'en' {
  return /[一-鿿]/u.test(title) ? 'zh' : 'en'
}

/** 使用可读的 UTF-8 SQL 字符串字面量，并转义 MySQL 的特殊字符。 */
function sqlString(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "''")
    .replaceAll('\u0000', '\\0')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\u001a', '\\Z')
  return `'${escaped}'`
}

function timestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return 'NULL'
  return sqlString(
    new Date(epochMs)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '')
  )
}

function validateRow(row: VideoExportRow): void {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) throw new Error('视频缺少有效 id')
  if (!row.crossId) throw new Error(`视频 ${row.id} 缺少 crossId`)
  if (!row.title) throw new Error(`视频 ${row.id} 缺少 title`)
  if (!row.videoUid || !row.coverId || !row.coverUrl) {
    throw new Error(`视频 ${row.id} 缺少 Cloudflare 视频或封面字段`)
  }
  if (row.status !== 1) throw new Error(`视频 ${row.id} 未发布，拒绝导出`)
  if (row.isDeleted !== 0) throw new Error(`视频 ${row.id} 已删除，拒绝导出`)
}

function rowValues(row: VideoExportRow): string {
  validateRow(row)
  return [
    sqlString(row.crossId),
    sqlString(row.title),
    `'${deriveVideoLanguage(row.title)}'`,
    sqlString(row.titleDescription),
    sqlString(row.coverId),
    sqlString(row.coverUrl),
    '1',
    String(row.difficulty),
    '0',
    sqlString(JSON.stringify(row.primaryTags)),
    sqlString(JSON.stringify(row.secondaryTags)),
    '1',
    timestamp(row.publishedAt),
    String(row.videoDuration),
    String(row.videoSize),
    sqlString(row.videoUid),
    '1',
    '1',
    timestamp(row.gmtCreate),
    timestamp(row.gmtCreate),
  ]
    .map((value) => `  ${value}`)
    .join(',\n')
}

export function createVideoBatchSql(rows: readonly VideoExportRow[]): string {
  if (rows.length === 0) throw new Error('没有可导出的视频')
  const crossIds = new Set<string>()
  for (const row of rows) {
    validateRow(row)
    if (crossIds.has(row.crossId)) throw new Error(`批次存在重复 crossId: ${row.crossId}`)
    crossIds.add(row.crossId)
  }

  const columns = VIDEO_COLUMNS.map((column) => `  \`${column}\``).join(',\n')
  const values = rows.map((row) => `(\n${rowValues(row)}\n)`).join(',\n')
  const updateColumns = VIDEO_COLUMNS.filter(
    (column) => column !== 'uk_cross_id' && column !== 'created_by' && column !== 'gmt_create'
  )
    .map((column) => `  \`${column}\` = VALUES(\`${column}\`)`)
    .join(',\n')
  const ids = rows.map((row) => row.id).join(', ')

  return `-- 视频导入批次；源 video IDs: ${ids}\n-- 不包含 pk_id，目标库自行生成；三个操作人字段固定为 1。\nSET NAMES utf8mb4;\nSTART TRANSACTION;\n\nINSERT INTO \`tb_video\` (\n${columns}\n) VALUES\n${values}\nON DUPLICATE KEY UPDATE\n${updateColumns};\n\nCOMMIT;\n`
}

export async function exportVideoBatchSql(
  workDir: string,
  outputPath = join(resolve(workDir), 'sql', 'tb_video.sql'),
  backend: VideoExportBackend = new VideoBackendClient(loadVideoBackendConfig())
): Promise<VideoSqlExportResult> {
  const ids: number[] = []
  for (const language of VIDEO_LANGUAGES) {
    const statePath = resolveWorkPaths(workDir, language).statePath
    if (!(await pathExists(statePath))) continue
    const state = await readUploadState(statePath)
    for (const item of state.items) {
      if (!item.videoRegistered || !item.videoPublished || !item.videoId) {
        throw new Error(`${language}/${item.relativeVideoPath} 尚未完成入库和发布，拒绝导出`)
      }
      ids.push(item.videoId)
    }
  }

  const uniqueIds = [...new Set(ids)].sort((a, b) => a - b)
  if (uniqueIds.length === 0) {
    throw new Error('工作目录中没有可导出的已发布视频状态文件')
  }
  if (uniqueIds.length !== ids.length) throw new Error('批次状态中存在重复 videoId')
  const rows = await backend.listVideosByIds(uniqueIds)
  if (rows.length !== uniqueIds.length) {
    throw new Error(`期望查询 ${uniqueIds.length} 条视频，实际返回 ${rows.length} 条`)
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const orderedRows = uniqueIds.map((id) => {
    const row = rowsById.get(id)
    if (!row) throw new Error(`后端未返回 videoId=${id}`)
    return row
  })

  const absoluteOutputPath = resolve(outputPath)
  await atomicWrite(absoluteOutputPath, createVideoBatchSql(orderedRows))
  return { outputPath: absoluteOutputPath, count: orderedRows.length, videoIds: uniqueIds }
}
