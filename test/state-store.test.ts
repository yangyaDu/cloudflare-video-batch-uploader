import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readUploadState, writeUploadState } from '../src/state-store'
import type { UploadState } from '../src/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('upload state store', () => {
  test('保留视频和封面的中断恢复信息', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-uploader-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'upload-state.json')
    const state: UploadState = {
      version: 2,
      sourceDir: 'C:/workdir/video/zh',
      workDir: 'C:/workdir',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      items: [
        {
          key: 'lesson.mp4',
          rowIndex: 0,
          relativeVideoPath: 'lesson.mp4',
          videoPath: 'C:/workdir/video/zh/lesson.mp4',
          coverPath: 'C:/workdir/covers/zh/lesson.jpg',
          stage: 'video-uploaded',
          videoUploadUrl: 'https://upload.cloudflarestream.com/tus/video',
          imageUploadUrl: 'https://upload.imagedelivery.net/image',
          imageId: 'image-id',
          imageVisitUrl: 'https://imagedelivery.net/account/image-id/public',
          lastError: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }

    await writeUploadState(path, state)
    expect(await readUploadState(path)).toEqual({
      ...state,
      updatedAt: expect.any(String),
    })
  })
})
