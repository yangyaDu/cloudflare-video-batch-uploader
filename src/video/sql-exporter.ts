import { dirname, join, resolve } from 'node:path'

import { atomicWrite, pathExists } from '../fs-utils'
import { VideoBackendClient } from './backend'
import { loadVideoBackendConfig } from './config'
import { readVideoCsv } from './csv-store'
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
  tagCount: number
  tagOutputPath: string
  count: number
  videoIds: number[]
}

export interface VideoTagSqlExportResult {
  tagCount: number
  tagNames: string[]
  tagOutputPath: string
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

const VIDEO_TAG_COLUMNS = ['uk_name', 'created_by', 'updated_by'] as const

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

/** 收集当前批次视频引用的标签，保持首次出现顺序并拒绝非法标签名。 */
export function collectVideoTagNames(rows: readonly VideoExportRow[]): string[] {
  return collectTagNames(
    rows.map((row) => ({
      context: `视频 ${row.id}`,
      tags: [...row.primaryTags, ...row.secondaryTags],
    }))
  )
}

function collectTagNames(
  groups: ReadonlyArray<{ context: string; tags: readonly string[] }>
): string[] {
  const names = new Set<string>()
  for (const group of groups) {
    for (const tag of group.tags) {
      assertTagName(tag, group.context)
      names.add(tag)
    }
  }
  return [...names]
}

function assertTagName(name: string, context: string): void {
  if (!name || name.trim() !== name || Array.from(name).length > 64) {
    throw new Error(`${context} 包含无效标签名: ${JSON.stringify(name)}`)
  }
}

/**
 * 生成 tb_admin_tag 的幂等导入 SQL。
 * 目标环境已有同名标签时不会重复创建，也不会修改其审计字段。
 */
export function createVideoTagBatchSql(tagNames: readonly string[]): string {
  const names = [...new Set(tagNames)]
  for (const name of names) assertTagName(name, '标签 SQL')
  if (names.length === 0) {
    return '-- 当前视频批次没有引用标签，无需导入 tb_admin_tag。\n'
  }

  const columns = VIDEO_TAG_COLUMNS.map((column) => `  \`${column}\``).join(',\n')
  const values = names.map((name) => `(\n  ${sqlString(name)},\n  1,\n  1\n)`).join(',\n')
  return `-- 视频标签导入批次；共 ${names.length} 个标签。\nSET NAMES utf8mb4;\nSTART TRANSACTION;\n\nINSERT INTO \`tb_admin_tag\` (\n${columns}\n) VALUES\n${values}\nON DUPLICATE KEY UPDATE\n  \`uk_name\` = VALUES(\`uk_name\`);\n\nCOMMIT;\n`
}

function parseCsvTags(value: string, context: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${context} 不是合法的标签 JSON 数组`)
  }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
    throw new Error(`${context} 必须是字符串数组`)
  }
  return parsed
}

/**
 * 从批次 CSV 导出标签 SQL，不依赖视频已经写入当前后端。
 * 因此即使视频导出所连接的环境不一致，标签 SQL 仍可单独用于同步。
 */
export async function exportVideoTagBatchSql(
  workDir: string,
  videoSqlOutputPath = join(resolve(workDir), 'sql', 'tb_video.sql')
): Promise<VideoTagSqlExportResult> {
  const tagGroups: Array<{ context: string; tags: string[] }> = []
  for (const language of VIDEO_LANGUAGES) {
    const csvPath = resolveWorkPaths(workDir, language).csvPath
    if (!(await pathExists(csvPath))) continue
    const rows = await readVideoCsv(csvPath)
    rows.forEach((row, index) => {
      const context = `${language}/videos.csv 第 ${index + 2} 行`
      tagGroups.push({
        context,
        tags: [
          ...parseCsvTags(row.primaryTags, `${context} primaryTags`),
          ...parseCsvTags(row.secondaryTags, `${context} secondaryTags`),
        ],
      })
    })
  }
  if (tagGroups.length === 0) throw new Error('工作目录中没有可导出标签的 videos.csv')

  const tagNames = collectTagNames(tagGroups)
  const tagOutputPath = join(dirname(resolve(videoSqlOutputPath)), 'tb_admin_tag.sql')
  await atomicWrite(tagOutputPath, createVideoTagBatchSql(tagNames))
  return { tagNames, tagCount: tagNames.length, tagOutputPath }
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
  backend: VideoExportBackend = new VideoBackendClient(loadVideoBackendConfig()),
  exportedTagNames?: readonly string[]
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
  const tagOutputPath = join(dirname(absoluteOutputPath), 'tb_admin_tag.sql')
  const tagNames = exportedTagNames ? [...exportedTagNames] : collectVideoTagNames(orderedRows)
  await Promise.all([
    atomicWrite(absoluteOutputPath, createVideoBatchSql(orderedRows)),
    atomicWrite(tagOutputPath, createVideoTagBatchSql(tagNames)),
  ])
  return {
    outputPath: absoluteOutputPath,
    tagOutputPath,
    tagCount: tagNames.length,
    count: orderedRows.length,
    videoIds: uniqueIds,
  }
}
