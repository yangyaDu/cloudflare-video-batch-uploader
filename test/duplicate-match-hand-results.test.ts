import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DataServicesHandsClient } from '../src/duplicate-match-hand/data-services-client'
import { GameHandHistoryClient } from '../src/duplicate-match-hand/game-hand-history-client'
import {
  fetchGameHandHistoryResults,
  fetchHandDataServicesResults,
} from '../src/duplicate-match-hand/result-fetcher'
import type {
  DataServicesHandsBackend,
  GameHandHistoryBackend,
} from '../src/duplicate-match-hand/result-fetcher'
import type { GeneratedHandCase } from '../src/duplicate-match-hand/types'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

function handCase(): GeneratedHandCase {
  return {
    caseId: 'spot-preflop-rfi-first-to-act',
    title: 'DS-SPOT-PREFLOP-RFI-FIRST-TO-ACT',
    expected: { street: 'preflop', spot_type: 'preflop_rfi' },
    request: {
      title: 'DS-SPOT-PREFLOP-RFI-FIRST-TO-ACT',
      drillInfo: {} as GeneratedHandCase['request']['drillInfo'],
    },
  }
}

describe('Data Services 手牌结果', () => {
  test('使用固定分页和 table_id filter 查询完整 API JSON', async () => {
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init)
      return Response.json({
        code: 0,
        message: 'success',
        data: { metadata: { total: 1 }, data: [{ id: 'card-1' }] },
      })
    }) as typeof fetch

    const client = new DataServicesHandsClient({
      baseUrl: 'https://backend.example.test',
      webToken: 'web-token',
    })
    const response = await client.fetchHandsByTableId('7f0000010fa0_125201195936514053')

    expect(response).toEqual({
      code: 0,
      message: 'success',
      data: { metadata: { total: 1 }, data: [{ id: 'card-1' }] },
    })
    expect(request?.headers.get('authorization')).toBe('Bearer web-token')
    const url = new URL(request!.url)
    expect(url.pathname).toBe('/api/hands-review/data-services/hands')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '1',
      pageSize: '1',
      filter: 'table_id:eq:7f0000010fa0_125201195936514053',
    })
  })

  test('使用 tableId 查询完整 get_hand_history API JSON', async () => {
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init)
      return Response.json({
        code: 0,
        message: 'success',
        data: { tableId: 'table-1', handHistory: { gameuuid: 'card-1' } },
      })
    }) as typeof fetch
    const client = new GameHandHistoryClient({
      baseUrl: 'https://backend.example.test',
      webToken: 'web-token',
    })

    const response = await client.fetchGameHandHistory('table-1')

    expect(response.data).toEqual({ tableId: 'table-1', handHistory: { gameuuid: 'card-1' } })
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('https://backend.example.test/api/game_client/get_hand_history')
    expect(request?.headers.get('authorization')).toBe('Bearer web-token')
    expect(await request?.json()).toEqual({ tableId: 'table-1' })
  })

  test('Data Services 尚未返回目标手牌时不保存空结果', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        code: 0,
        message: 'success',
        data: { metadata: { total: 0 }, data: [] },
      })) as unknown as typeof fetch
    const client = new DataServicesHandsClient({
      baseUrl: 'https://backend.example.test',
      webToken: 'web-token',
    })

    await expect(client.fetchHandsByTableId('table-not-ready')).rejects.toThrow('没有查到对应牌谱')
  })

  test('按 caseId 保存响应并在 tableId 未变化时跳过重复查询', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hand-results-'))
    temporaryDirectories.push(directory)
    let calls = 0
    const backend: DataServicesHandsBackend = {
      async fetchHandsByTableId(tableId) {
        calls += 1
        return {
          code: 0,
          message: 'success',
          data: { metadata: { total: 1 }, data: [{ table_id: tableId }] },
        }
      },
    }
    const cases = [handCase()]
    const rows = [
      {
        caseId: cases[0]!.caseId,
        title: cases[0]!.title,
        tableId: '7f0000010fa0_125201195936514053',
      },
    ]

    const first = await fetchHandDataServicesResults(rows, cases, backend, {
      resultsDir: directory,
    })
    const second = await fetchHandDataServicesResults(rows, cases, backend, {
      resultsDir: directory,
    })

    expect(first).toEqual({ total: 1, fetched: 1, skipped: 0, failed: 0 })
    expect(second).toEqual({ total: 1, fetched: 0, skipped: 1, failed: 0 })
    expect(calls).toBe(1)
    const saved = JSON.parse(await readFile(join(directory, `${cases[0]!.caseId}.json`), 'utf8'))
    expect(saved).toMatchObject({
      caseId: cases[0]!.caseId,
      title: cases[0]!.title,
      tableId: rows[0]!.tableId,
      query: {
        page: 1,
        pageSize: 1,
        filter: `table_id:eq:${rows[0]!.tableId}`,
      },
      response: { code: 0, message: 'success' },
    })
    expect(saved.fetchedAt).toBeString()
  })

  test('同一个 tableId 不能关联两个 Case', async () => {
    const backend: DataServicesHandsBackend = {
      async fetchHandsByTableId() {
        throw new Error('不应发出查询')
      },
    }
    const first = handCase()
    const second = {
      ...handCase(),
      caseId: 'spot-preflop-rfi-after-folds',
      title: 'DS-SPOT-PREFLOP-RFI-AFTER-FOLDS',
    }
    const tableId = '7f0000010fa0_125201195936514053'

    await expect(
      fetchHandDataServicesResults(
        [
          { caseId: first.caseId, title: first.title, tableId },
          { caseId: second.caseId, title: second.title, tableId },
        ],
        [first, second],
        backend,
        { resultsDir: 'unused' }
      )
    ).rejects.toThrow(`tableId 重复关联多个 Case: ${tableId}`)
  })

  test('get_hand_history 响应按相同 caseId 和 tableId 独立保存', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'game-hand-history-'))
    temporaryDirectories.push(directory)
    let calls = 0
    const backend: GameHandHistoryBackend = {
      async fetchGameHandHistory(tableId) {
        calls += 1
        return {
          code: 0,
          message: 'success',
          data: { tableId, handHistory: { gameuuid: 'card-1' } },
        }
      },
    }
    const cases = [handCase()]
    const rows = [
      {
        caseId: cases[0]!.caseId,
        title: cases[0]!.title,
        tableId: '7f0000010fa0_125201195936514053',
      },
    ]

    const first = await fetchGameHandHistoryResults(rows, cases, backend, {
      resultsDir: directory,
    })
    const second = await fetchGameHandHistoryResults(rows, cases, backend, {
      resultsDir: directory,
    })

    expect(first).toEqual({ total: 1, fetched: 1, skipped: 0, failed: 0 })
    expect(second).toEqual({ total: 1, fetched: 0, skipped: 1, failed: 0 })
    expect(calls).toBe(1)
    const saved = JSON.parse(await readFile(join(directory, `${cases[0]!.caseId}.json`), 'utf8'))
    expect(saved).toMatchObject({
      caseId: cases[0]!.caseId,
      title: cases[0]!.title,
      tableId: rows[0]!.tableId,
      request: {
        method: 'POST',
        path: '/api/game_client/get_hand_history',
        body: { tableId: rows[0]!.tableId },
      },
      response: {
        code: 0,
        data: { tableId: rows[0]!.tableId },
      },
    })
  })
})
