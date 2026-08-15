import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { writeVideoCsv } from '../src/video/csv-store'
import { resolveWorkPaths } from '../src/video/paths'
import { writeUploadState } from '../src/video/state-store'
import type { UploadItemState } from '../src/video/types'
import { createVideoPayload, saveCreatedVideo, uploadVideos } from '../src/video/uploader'
import { createDefaultVideoRow } from '../src/video/video-schema'

const temporaryDirectories: string[] = []
const originalBackendBaseUrl = process.env.BACKEND_BASE_URL
const originalBackendAdminToken = process.env.BACKEND_ADMIN_TOKEN

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
  if (originalBackendBaseUrl === undefined) delete process.env.BACKEND_BASE_URL
  else process.env.BACKEND_BASE_URL = originalBackendBaseUrl
  if (originalBackendAdminToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN
  else process.env.BACKEND_ADMIN_TOKEN = originalBackendAdminToken
})

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

  test('保存 video/add 响应中的 videoId、时长和大小', () => {
    saveCreatedVideo(item, { id: 88, videoDuration: 19.4, videoSize: 1234 })

    expect(item).toMatchObject({
      videoId: 88,
      videoDuration: 19.4,
      videoSize: 1234,
    })
  })

  test('拒绝缺少有效 video id 的新增响应', () => {
    expect(() => saveCreatedVideo(item, { id: 0 })).toThrow('缺少有效 video id')
  })

  test('只有英文批次文件时不会要求中文 CSV 和状态文件', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'video-upload-en-only-'))
    temporaryDirectories.push(workDir)
    const paths = resolveWorkPaths(workDir, 'en')
    await writeVideoCsv(paths.csvPath, [])
    await writeUploadState(paths.statePath, {
      version: 2,
      sourceDir: paths.videoDir,
      workDir,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      items: [],
    })
    process.env.BACKEND_BASE_URL = 'https://backend.example.test'
    process.env.BACKEND_ADMIN_TOKEN = 'test-token'

    const result = await uploadVideos(workDir)

    expect(result).toMatchObject({ total: 0, completed: 0, failed: 0 })
    expect(result.csvPaths).toEqual([paths.csvPath])
  })
})
