import { describe, expect, test } from 'bun:test'

import { normalizeDatabaseVideoRow } from '../src/video/sql-database'

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
