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

export function createVideoExportBackendFromEnvironment(): VideoExportBackend {
  const databaseUrl =
    process.env.SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ''
  return databaseUrl
    ? new VideoDatabaseExportBackend(databaseUrl)
    : new VideoBackendClient(loadVideoBackendConfig())
}
