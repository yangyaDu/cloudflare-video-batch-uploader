import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { writeVideoCsv } from '../src/video/csv-store'
import { resolveWorkPaths } from '../src/video/paths'
import { readUploadState, writeUploadState } from '../src/video/state-store'
import type { UploadItemState } from '../src/video/types'
import { createVideoPayload, saveCreatedVideo, uploadVideos } from '../src/video/uploader'
import { createDefaultVideoRow } from '../src/video/video-schema'

const temporaryDirectories: string[] = []
const originalBackendBaseUrl = process.env.BACKEND_BASE_URL
const originalBackendAdminToken = process.env.BACKEND_ADMIN_TOKEN
const originalFetch = globalThis.fetch

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
  if (originalBackendBaseUrl === undefined) delete process.env.BACKEND_BASE_URL
  else process.env.BACKEND_BASE_URL = originalBackendBaseUrl
  if (originalBackendAdminToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN
  else process.env.BACKEND_ADMIN_TOKEN = originalBackendAdminToken
  globalThis.fetch = originalFetch
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

  test('视频直传成功后清除 TUS 地址，恢复时不再重复直传视频', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'video-upload-resume-'))
    temporaryDirectories.push(workDir)
    const paths = resolveWorkPaths(workDir, 'en')
    const videoPath = join(workDir, 'video.mp4')
    const coverPath = join(workDir, 'cover.jpg')
    await Promise.all([writeFile(videoPath, 'video'), writeFile(coverPath, 'cover')])

    const row = createDefaultVideoRow('Poker Basics', 'en')
    row.videoUid = 'stream-uid'
    await writeVideoCsv(paths.csvPath, [row])
    await writeUploadState(paths.statePath, {
      version: 2,
      sourceDir: paths.videoDir,
      workDir,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      items: [
        {
          ...item,
          videoPath,
          coverPath,
          videoUploadUrl: 'https://upload.example.test/tus/stream-uid',
        },
      ],
    })
    process.env.BACKEND_BASE_URL = 'https://backend.example.test'
    process.env.BACKEND_ADMIN_TOKEN = 'test-token'

    let imageUploads = 0
    const requests: Request[] = []
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      const url = new URL(request.url)
      if (url.hostname === 'upload.example.test' && request.method === 'HEAD') {
        return new Response(null, { headers: { 'Upload-Offset': '5' } })
      }
      if (url.pathname === '/api/adminimda/image/upload') {
        return Response.json({
          code: 0,
          message: 'success',
          data: {
            id: 'image-id',
            uploadUrl: 'https://image.example.test/upload',
            visitUrl: 'https://image.example.test/image-id/public',
          },
        })
      }
      if (url.hostname === 'image.example.test') {
        imageUploads += 1
        return new Response(null, { status: imageUploads === 1 ? 500 : 200 })
      }
      if (url.pathname === '/api/adminimda/video/add') {
        return Response.json({ code: 0, message: 'success', data: { id: 99 } })
      }
      if (url.pathname === '/api/adminimda/video/publish') {
        return Response.json({ code: 0, message: 'success', data: { id: 99, status: 1 } })
      }
      throw new Error(`未预期的请求: ${request.method} ${request.url}`)
    }) as typeof fetch

    await expect(uploadVideos(workDir)).resolves.toMatchObject({ completed: 0, failed: 1 })
    const stateAfterFailure = await readUploadState(paths.statePath)
    expect(stateAfterFailure.items[0]?.videoUploadUrl).toBeUndefined()

    requests.splice(0)
    await expect(uploadVideos(workDir)).resolves.toMatchObject({ completed: 1, failed: 0 })
    expect(
      requests.some(
        (request) =>
          new URL(request.url).hostname === 'upload.example.test' &&
          ['HEAD', 'PATCH'].includes(request.method)
      )
    ).toBe(false)
  })
})
