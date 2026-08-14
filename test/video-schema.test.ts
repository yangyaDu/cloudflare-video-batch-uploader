import { describe, expect, test } from 'bun:test'

import { createDefaultVideoRow, VIDEO_COLUMNS } from '../src/video/video-schema'

describe('video CSV schema', () => {
  test('表头与新增视频接口的 9 个字段一致', () => {
    expect(VIDEO_COLUMNS).toEqual([
      'language',
      'difficulty',
      'title',
      'titleDescription',
      'coverId',
      'coverUrl',
      'primaryTags',
      'secondaryTags',
      'videoUid',
    ])
  })

  test('按批量导入默认值创建记录', () => {
    const row = createDefaultVideoRow('Poker Basics', 'en')

    expect(row.title).toBe('Poker Basics')
    expect(row.language).toBe('en')
    expect(row.difficulty).toBe('10')
    expect(row.titleDescription).toBe('')
    expect(row.primaryTags).toBe('[]')
    expect(row.secondaryTags).toBe('[]')
    expect(row.coverId).toBe('')
    expect(row.videoUid).toBe('')
  })
})
