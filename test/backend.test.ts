import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BackendClient } from '../src/backend'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

function client(): BackendClient {
  return new BackendClient({
    baseUrl: 'https://backend.example.test',
    adminToken: 'admin-token',
    pollIntervalMs: 1,
    readyTimeoutMs: 50,
  })
}

describe('BackendClient', () => {
  test('向后端申请 TUS 会话时携带管理员 token 和元数据', async () => {
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init)
      return Response.json({
        code: 0,
        message: 'success',
        data: { uid: 'stream-uid', uploadUrl: 'https://upload.example.test/tus/stream-uid' },
      })
    }) as typeof fetch

    const directory = await mkdtemp(join(tmpdir(), 'video-uploader-'))
    temporaryDirectories.push(directory)
    const path = join(directory, '示例视频.mp4')
    await writeFile(path, 'abc')

    await expect(client().createResumableVideoUpload(path)).resolves.toEqual({
      uid: 'stream-uid',
      uploadUrl: 'https://upload.example.test/tus/stream-uid',
    })
    expect(request?.url).toBe('https://backend.example.test/api/adminimda/video/resumableUpload')
    expect(request?.headers.get('x-adminimda-token')).toBe('Bearer admin-token')
    const body = (await request?.json()) as { uploadLength: number; uploadMetadata: string }
    expect(body.uploadLength).toBe(3)
    expect(body.uploadMetadata).toContain('requiresignedurls')
  })

  test('使用后端返回的 TUS resource URL 先 HEAD 再 PATCH', async () => {
    const requests: Request[] = []
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.method === 'HEAD') {
        return new Response(null, { headers: { 'Upload-Offset': '0' } })
      }
      return new Response(null, { headers: { 'Upload-Offset': '3' } })
    }) as typeof fetch

    const directory = await mkdtemp(join(tmpdir(), 'video-uploader-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'video.mp4')
    await writeFile(path, 'abc')

    await client().uploadVideoToTus(path, 'https://upload.example.test/tus/stream-uid')

    expect(requests.map((request) => request.method)).toEqual(['HEAD', 'PATCH'])
    expect(requests[1]?.headers.get('Upload-Offset')).toBe('0')
    expect(requests[1]?.headers.get('Tus-Resumable')).toBe('1.0.0')
  })

  test('视频转码中时轮询新增接口，成功后返回后端写入的字段', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) return Response.json({ code: 1108, message: 'video ready ing', data: null })
      return Response.json({
        code: 0,
        message: 'success',
        data: { id: 8, videoDuration: 19.4, videoSize: 1234 },
      })
    }) as unknown as typeof fetch

    await expect(
      client().addVideoWhenReady({
        language: 'zh',
        difficulty: 10,
        title: '标题',
        titleDescription: '描述',
        coverId: 'image-id',
        coverUrl: 'https://imagedelivery.net/account/image-id/public',
        primaryTags: [],
        secondaryTags: [],
        videoUid: 'stream-uid',
      })
    ).resolves.toEqual({ id: 8, videoDuration: 19.4, videoSize: 1234 })
    expect(calls).toBe(2)
  })
})
