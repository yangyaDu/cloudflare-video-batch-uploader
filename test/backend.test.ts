import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { VideoBackendClient } from '../src/video/backend'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

function client(): VideoBackendClient {
  return new VideoBackendClient({
    baseUrl: 'https://backend.example.test',
    adminToken: 'admin-token',
    pollIntervalMs: 1,
    readyTimeoutMs: 50,
  })
}

describe('BackendClient', () => {
  test('依次调用复式手牌和活动的新增、发布接口', async () => {
    const requests: Request[] = []
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      const path = new URL(request.url).pathname
      const id = path.includes('/activity/') ? 22 : 11
      const data = path.includes('/activity/delete') ? { id, isDeleted: 1 } : { id, status: 1 }
      return Response.json({ code: 0, message: 'success', data })
    }) as typeof fetch

    const hand = await client().addDuplicateMatchHand({
      title: 'DS-SPOT-PREFLOP-RFI',
      drillInfo: {
        players: [],
        big_blind: 2,
        ante: 1,
        dealer_seat: 0,
        sb_seat: 1,
        bb_seat: 2,
        straddle_seat: -1,
        heroPosition: 'BTN',
        actions: [],
        communityCards: { flop: '', turn: '', river: '' },
      },
    })
    await client().publishDuplicateMatchHand(hand.id)
    const activity = await client().addDuplicateMatchActivity({
      title: 'DS-SPOT-PREFLOP-RFI',
      description: 'test',
      playHandCount: 1,
      playCount: 6,
      handList: [{ handId: hand.id, itemType: 1, sortNo: 1 }],
      startTime: 1,
      endTime: 2,
    })
    await client().publishDuplicateMatchActivity(activity.id)
    await client().unpublishDuplicateMatchActivity(activity.id)
    await expect(client().deleteDuplicateMatchActivity(activity.id)).resolves.toEqual({
      id: 22,
      isDeleted: 1,
    })

    expect([hand.id, activity.id]).toEqual([11, 22])
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/adminimda/duplicate-match/hand/add',
      '/api/adminimda/duplicate-match/hand/publish',
      '/api/adminimda/duplicate-match/activity/add',
      '/api/adminimda/duplicate-match/activity/publish',
      '/api/adminimda/duplicate-match/activity/unpublish',
      '/api/adminimda/duplicate-match/activity/delete',
    ])
    expect(
      requests.every((request) => request.headers.get('x-adminimda-token') === 'Bearer admin-token')
    ).toBe(true)
  })

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

  test('使用 video/add 返回的数据库 ID 调用发布接口', async () => {
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init)
      return Response.json({
        code: 0,
        message: 'success',
        data: { id: 88, crossId: 'video-cross-id', status: 1 },
      })
    }) as typeof fetch

    await expect(client().publishVideo(88)).resolves.toBeUndefined()
    expect(request?.url).toBe('https://backend.example.test/api/adminimda/video/publish')
    expect(request?.headers.get('x-adminimda-token')).toBe('Bearer admin-token')
    await expect(request?.json()).resolves.toEqual({ id: 88 })
  })

  test('发布请求重复执行时将后端 1106 已发布视为成功', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        code: 1106,
        message: 'already published',
        data: null,
      })) as unknown as typeof fetch

    await expect(client().publishVideo(88)).resolves.toBeUndefined()
  })
})
