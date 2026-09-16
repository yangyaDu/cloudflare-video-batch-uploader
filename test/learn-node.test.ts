import { afterEach, expect, test } from 'bun:test'
import { requestAdmin } from '../src/learn-node/client'
import { getVideoList } from '../src/learn-node/video-client'

const originalFetch = globalThis.fetch
const baseUrl = process.env.BACKEND_BASE_URL
const token = process.env.BACKEND_ADMIN_TOKEN
afterEach(() => {
  globalThis.fetch = originalFetch
  if (baseUrl === undefined) delete process.env.BACKEND_BASE_URL
  else process.env.BACKEND_BASE_URL = baseUrl
  if (token === undefined) delete process.env.BACKEND_ADMIN_TOKEN
  else process.env.BACKEND_ADMIN_TOKEN = token
})

test('学习节点客户端使用项目后端配置并传递 UUID 请求体', async () => {
  process.env.BACKEND_BASE_URL = 'https://backend.example.test'
  process.env.BACKEND_ADMIN_TOKEN = 'test-token'
  let captured: Request | undefined
  globalThis.fetch = (async (input, init) => {
    captured = new Request(input, init)
    return Response.json({ code: 0, data: { nodeUuid: 'node-uuid' } })
  }) as typeof fetch
  await requestAdmin('POST', '/api/adminimda/learn/node/update', {
    body: { nodeUuid: 'node-uuid', refId: 'video-cross-id' },
  })
  expect(captured?.url).toBe('https://backend.example.test/api/adminimda/learn/node/update')
  expect(captured?.headers.get('x-adminimda-token')).toBe('Bearer test-token')
  expect(await captured?.json()).toEqual({ nodeUuid: 'node-uuid', refId: 'video-cross-id' })
})

test('同步视频引用读取第二页而非仅前一页', async () => {
  process.env.BACKEND_BASE_URL = 'https://backend.example.test'
  process.env.BACKEND_ADMIN_TOKEN = 'test-token'
  const pages: string[] = []
  globalThis.fetch = (async (input) => {
    const page = new URL(String(input)).searchParams.get('page')!
    pages.push(page)
    return Response.json({
      code: 0,
      data: {
        count: 2,
        data: [
          { id: Number(page), title: page, crossId: 'cross-' + page, videoUid: 'uid-' + page },
        ],
      },
    })
  }) as typeof fetch
  const result = await getVideoList({ pageSize: 1 })
  expect(pages).toEqual(['1', '2'])
  expect(result.data.map((item) => item.crossId)).toEqual(['cross-1', 'cross-2'])
})

test('课程树 dry-run 无需凭据且不请求后端', async () => {
  const process = Bun.spawn({
    cmd: [
      Bun.which('bun')!,
      'run',
      'src/learn-node/build_curriculum_tree.ts',
      '--manifest',
      'docs/examples/learn-node-manifest.json',
      '--dry-run',
    ],
    env: { ...Bun.env, BACKEND_BASE_URL: 'http://127.0.0.1:1', BACKEND_ADMIN_TOKEN: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  expect(error).toBe('')
  expect(code).toBe(0)
  expect(output).toContain('位置优势解析')
  expect(output).toContain('[Dry Run]')
})
