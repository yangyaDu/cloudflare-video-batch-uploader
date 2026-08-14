import { describe, expect, test } from 'bun:test'

import type { UploadItemState } from '../src/video/types'
import { createVideoPayload } from '../src/video/uploader'
import { createDefaultVideoRow } from '../src/video/video-schema'

const item: UploadItemState = {
  key: 'lesson.mp4',
  rowIndex: 0,
  relativeVideoPath: 'lesson.mp4',
  videoPath: 'C:/videos/lesson.mp4',
  coverPath: 'C:/work/covers/lesson.jpg',
  stage: 'pending',
  lastError: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('createVideoPayload', () => {
  test('保留 CSV 默认值，并将空描述转换为单个空格', () => {
    const row = createDefaultVideoRow('Poker Basics', 'en')
    row.coverId = 'image-id'
    row.coverUrl = 'https://imagedelivery.net/account/image-id/public'
    row.videoUid = 'stream-uid'

    expect(createVideoPayload(row, item)).toEqual({
      language: 'en',
      difficulty: 10,
      title: 'Poker Basics',
      titleDescription: ' ',
      coverId: 'image-id',
      coverUrl: 'https://imagedelivery.net/account/image-id/public',
      primaryTags: [],
      secondaryTags: [],
      videoUid: 'stream-uid',
    })
  })
})
