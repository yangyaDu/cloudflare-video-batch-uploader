import { describe, expect, test } from 'bun:test'

import {
  normalizeDatabaseVideoRow,
  VideoDatabaseWithBackendFallback,
} from '../src/video/sql-database'
import type { VideoExportRow } from '../src/video/sql-exporter'

describe('normalizeDatabaseVideoRow', () => {
  test('将已软删除的源视频恢复为目标库中的已发布记录', () => {
    const gmtCreate = new Date('2026-08-15T01:46:12.000Z')
    const row = normalizeDatabaseVideoRow({
      id: 103,
      crossId: '126379296846512133',
      title: 'english_materies',
      titleDescription: ' ',
      coverId: 'cover-id',
      coverUrl: 'https://example.com/cover/public',
      difficulty: 10,
      primaryTags: [],
      secondaryTags: [],
      publishedAt: null,
      videoDuration: 14,
      videoSize: 52_467_201,
      videoUid: 'video-uid',
      gmtCreate,
    })

    expect(row.status).toBe(1)
    expect(row.isDeleted).toBe(0)
    expect(row.publishedAt).toBe(gmtCreate.getTime())
    expect(row.gmtCreate).toBe(gmtCreate.getTime())
  })
})

describe('VideoDatabaseWithBackendFallback', () => {
  test('优先使用源库记录，并从后台补齐源库尚未同步的视频', async () => {
    const databaseRow = video({ id: 10, title: 'source video' })
    const backendRow = video({ id: 11, title: 'backend video' })
    const database = {
      listVideosByIds: async () => [databaseRow],
    }
    let requestedBackendIds: readonly number[] = []
    const backend = {
      listVideosByIds: async (ids: readonly number[]) => {
        requestedBackendIds = ids
        return [backendRow]
      },
    }

    const exporter = new VideoDatabaseWithBackendFallback(database, backend)
    await expect(exporter.listVideosByIds([10, 11])).resolves.toEqual([databaseRow, backendRow])
    expect(requestedBackendIds).toEqual([11])
  })
})

function video(overrides: Partial<VideoExportRow> = {}): VideoExportRow {
  return {
    id: 1,
    crossId: 'cross-id',
    title: 'video',
    titleDescription: 'description',
    coverId: 'cover-id',
    coverUrl: 'https://example.com/cover',
    status: 1,
    difficulty: 10,
    isDeleted: 0,
    primaryTags: [],
    secondaryTags: [],
    publishedAt: 1_700_000_000_000,
    videoDuration: 60,
    videoSize: 100,
    videoUid: 'stream-id',
    gmtCreate: 1_700_000_000_000,
    ...overrides,
  }
}
