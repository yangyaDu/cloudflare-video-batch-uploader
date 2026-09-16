import { SQL } from 'bun'

import { VideoBackendClient } from './backend'
import { loadVideoBackendConfig } from './config'
import type { VideoExportBackend, VideoExportRow } from './sql-exporter'

export interface DatabaseVideoRow {
  id: number
  crossId: string
  title: string
  titleDescription: string
  coverId: string
  coverUrl: string
  difficulty: number
  primaryTags: string[] | string
  secondaryTags: string[] | string
  publishedAt: Date | string | number | null
  videoDuration: number
  videoSize: number
  videoUid: string
  gmtCreate: Date | string | number
}

function epochMilliseconds(value: Date | string | number): number {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(result) || result <= 0)
    throw new Error(`无效的视频时间字段: ${String(value)}`)
  return result
}

function tags(value: string[] | string): string[] {
  if (Array.isArray(value)) return value
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`无效的视频标签字段: ${value}`)
  }
  return parsed
}

/** 源记录可能已被下架/软删除，目标导入统一恢复为已发布、未删除。 */
export function normalizeDatabaseVideoRow(row: DatabaseVideoRow): VideoExportRow {
  const gmtCreate = epochMilliseconds(row.gmtCreate)
  return {
    ...row,
    primaryTags: tags(row.primaryTags),
    secondaryTags: tags(row.secondaryTags),
    status: 1,
    isDeleted: 0,
    publishedAt: row.publishedAt ? epochMilliseconds(row.publishedAt) : gmtCreate,
    gmtCreate,
  }
}

export class VideoDatabaseExportBackend implements VideoExportBackend {
  private readonly sql: SQL

  constructor(databaseUrl: string) {
    this.sql = new SQL(databaseUrl)
  }

  async listVideosByIds(ids: readonly number[]): Promise<VideoExportRow[]> {
    if (ids.length === 0) return []
    const rows = (await this.sql`
      SELECT
        pk_id AS id,
        uk_cross_id AS crossId,
        title,
        title_description AS titleDescription,
        cover_id AS coverId,
        cover_url AS coverUrl,
        difficulty,
        primary_tags AS primaryTags,
        secondary_tags AS secondaryTags,
        published_at AS publishedAt,
        video_duration AS videoDuration,
        video_size AS videoSize,
        video_uid AS videoUid,
        gmt_create AS gmtCreate
      FROM tb_video
      WHERE pk_id IN ${this.sql([...ids])}
      ORDER BY pk_id
    `) as unknown as DatabaseVideoRow[]
    return rows.map(normalizeDatabaseVideoRow)
  }

  async close(): Promise<void> {
    await this.sql.close()
  }
}

/**
 * 源库可读取已软删除的视频；当前后台则可补齐源库尚未同步的新视频。
 * 两者同时配置时优先保留源库字段，仅对缺失 ID 请求后台。
 */
export class VideoDatabaseWithBackendFallback implements VideoExportBackend {
  constructor(
    private readonly database: VideoExportBackend,
    private readonly backend: VideoExportBackend
  ) {}

  async listVideosByIds(ids: readonly number[]): Promise<VideoExportRow[]> {
    const requestedIds = new Set(ids)
    const rowsById = new Map<number, VideoExportRow>()
    const databaseRows = await this.database.listVideosByIds(ids)

    for (const row of databaseRows) {
      if (!requestedIds.has(row.id)) {
        throw new Error(`源库返回了未请求的视频 ID: ${row.id}`)
      }
      if (rowsById.has(row.id)) throw new Error(`源库返回了重复的视频 ID: ${row.id}`)
      rowsById.set(row.id, row)
    }

    const missingIds = ids.filter((id) => !rowsById.has(id))
    if (missingIds.length > 0) {
      const backendRows = await this.backend.listVideosByIds(missingIds)
      for (const row of backendRows) {
        if (!requestedIds.has(row.id)) {
          throw new Error(`后端返回了未请求的视频 ID: ${row.id}`)
        }
        if (rowsById.has(row.id)) throw new Error(`后端返回了重复的视频 ID: ${row.id}`)
        rowsById.set(row.id, row)
      }
    }

    const stillMissingIds = ids.filter((id) => !rowsById.has(id))
    if (stillMissingIds.length > 0) {
      throw new Error(`源库和后端均找不到视频 ID: ${stillMissingIds.join(', ')}`)
    }
    return ids.map((id) => rowsById.get(id) as VideoExportRow)
  }

  async close(): Promise<void> {
    await Promise.all([this.database.close?.(), this.backend.close?.()])
  }
}

export function createVideoExportBackendFromEnvironment(): VideoExportBackend {
  const databaseUrl =
    process.env.SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ''
  const backend = new VideoBackendClient(loadVideoBackendConfig())
  return databaseUrl
    ? new VideoDatabaseWithBackendFallback(new VideoDatabaseExportBackend(databaseUrl), backend)
    : backend
}
