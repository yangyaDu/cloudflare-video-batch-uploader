import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateDuplicateMatchHandCases } from '../src/duplicate-match-hand/case-catalog'
import {
  deleteDuplicateMatchHandActivities,
  uploadDuplicateMatchHandCases,
} from '../src/duplicate-match-hand/uploader'
import { readHandTableIdCsv } from '../src/duplicate-match-hand/table-id-store'
import type { DuplicateMatchHandBackend } from '../src/duplicate-match-hand/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('uploadDuplicateMatchHandCases', () => {
  test('每一手依次新增并发布手牌，再创建七天活动并发布', async () => {
    const calls: string[] = []
    const handId = 101
    const activityUuid = '0123456789abcdef0123456789abcdef'
    const backend: DuplicateMatchHandBackend = {
      async addDuplicateMatchHand(payload) {
        calls.push(`add-hand:${payload.title}`)
        return { id: handId }
      },
      async publishDuplicateMatchHand(id) {
        calls.push(`publish-hand:${id}`)
      },
      async addDuplicateMatchActivity(payload) {
        calls.push(`add-activity:${payload.title}`)
        expect(payload).toMatchObject({
          playHandCount: 1,
          playCount: 6,
          handList: [{ handId, itemType: 1, sortNo: 1 }],
        })
        expect(payload.endTime - payload.startTime).toBe(7 * 24 * 60 * 60 * 1000)
        return { activityUuid }
      },
      async publishDuplicateMatchActivity(id) {
        calls.push(`publish-activity:${id}`)
      },
      async unpublishDuplicateMatchActivity() {
        throw new Error('不应取消发布')
      },
      async deleteDuplicateMatchActivity() {
        throw new Error('不应删除')
      },
    }
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)
    const statePath = join(directory, 'upload-state.json')
    const tableIdsPath = join(directory, 'table-ids.csv')
    const item = generateDuplicateMatchHandCases()[0]!

    const result = await uploadDuplicateMatchHandCases([item], backend, {
      statePath,
      tableIdsPath,
      now: () => 1_800_000_000_000,
    })

    expect(result).toEqual({ total: 1, completed: 1, failed: 0 })
    expect(calls).toEqual([
      `add-hand:${item.title}`,
      `publish-hand:${handId}`,
      `add-activity:${item.title}`,
      `publish-activity:${activityUuid}`,
    ])
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    expect(state.items[0]).toMatchObject({
      caseId: item.caseId,
      handId,
      handPublished: true,
      activityUuid,
      activityPublished: true,
      stage: 'completed',
      lastError: null,
    })
    await expect(readHandTableIdCsv(tableIdsPath)).resolves.toEqual([
      {
        caseId: item.caseId,
        title: item.title,
        handId: String(handId),
        activityUuid,
        tableId: '',
      },
    ])
  })

  test('失败后保留已完成阶段，重试不重复新增手牌', async () => {
    let failActivityOnce = true
    const calls: string[] = []
    const backend: DuplicateMatchHandBackend = {
      async addDuplicateMatchHand() {
        calls.push('add-hand')
        return { id: 301 }
      },
      async publishDuplicateMatchHand() {
        calls.push('publish-hand')
      },
      async addDuplicateMatchActivity() {
        calls.push('add-activity')
        if (failActivityOnce) {
          failActivityOnce = false
          throw new Error('temporary error')
        }
        return { activityUuid: 'fedcba9876543210fedcba9876543210' }
      },
      async publishDuplicateMatchActivity() {
        calls.push('publish-activity')
      },
      async unpublishDuplicateMatchActivity() {
        throw new Error('不应取消发布')
      },
      async deleteDuplicateMatchActivity() {
        throw new Error('不应删除')
      },
    }
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)
    const statePath = join(directory, 'upload-state.json')
    const item = generateDuplicateMatchHandCases()[0]!

    await uploadDuplicateMatchHandCases([item], backend, { statePath })
    const result = await uploadDuplicateMatchHandCases([item], backend, { statePath })

    expect(result).toEqual({ total: 1, completed: 1, failed: 0 })
    expect(calls).toEqual([
      'add-hand',
      'publish-hand',
      'add-activity',
      'add-activity',
      'publish-activity',
    ])
  })

  test('按状态文件中的 activityUuid 取消发布、删除并清空活动状态', async () => {
    const calls: string[] = []
    const backend: DuplicateMatchHandBackend = {
      async addDuplicateMatchHand() {
        return { id: 101 }
      },
      async publishDuplicateMatchHand() {},
      async addDuplicateMatchActivity() {
        return { activityUuid: '0123456789abcdef0123456789abcdef' }
      },
      async publishDuplicateMatchActivity() {},
      async unpublishDuplicateMatchActivity(id) {
        calls.push(`unpublish:${id}`)
      },
      async deleteDuplicateMatchActivity(id) {
        calls.push(`delete:${id}`)
      },
    }
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)
    const statePath = join(directory, 'upload-state.json')
    const tableIdsPath = join(directory, 'table-ids.csv')
    const item = generateDuplicateMatchHandCases()[0]!

    await uploadDuplicateMatchHandCases([item], backend, { statePath, tableIdsPath })
    const result = await deleteDuplicateMatchHandActivities([item], backend, {
      statePath,
      tableIdsPath,
    })

    expect(result).toEqual({ total: 1, deleted: 1, failed: 0 })
    expect(calls).toEqual([
      'unpublish:0123456789abcdef0123456789abcdef',
      'delete:0123456789abcdef0123456789abcdef',
    ])
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    expect(state.items[0]).toMatchObject({
      handId: 101,
      handPublished: true,
      stage: 'hand-published',
      lastError: null,
    })
    expect(state.items[0].activityUuid).toBeUndefined()
    expect(state.items[0].activityPublished).toBeUndefined()
    await expect(readHandTableIdCsv(tableIdsPath)).resolves.toEqual([
      {
        caseId: item.caseId,
        title: item.title,
        handId: '101',
        activityUuid: '',
        tableId: '',
      },
    ])
  })

  test('旧状态只含数值 activityId 时拒绝删除，避免发送无效的 activityUuid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-legacy-'))
    temporaryDirectories.push(directory)
    const statePath = join(directory, 'upload-state.json')
    const item = generateDuplicateMatchHandCases()[0]!
    await Bun.write(
      statePath,
      JSON.stringify({
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [
          {
            caseId: item.caseId,
            title: item.title,
            requestHash: createHash('sha256').update(JSON.stringify(item.request)).digest('hex'),
            stage: 'completed',
            handId: 101,
            handPublished: true,
            activityId: 201,
            activityPublished: true,
            lastError: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    )
    const backend: DuplicateMatchHandBackend = {
      async addDuplicateMatchHand() {
        return { id: 101 }
      },
      async publishDuplicateMatchHand() {},
      async addDuplicateMatchActivity() {
        return { activityUuid: '0123456789abcdef0123456789abcdef' }
      },
      async publishDuplicateMatchActivity() {},
      async unpublishDuplicateMatchActivity() {
        throw new Error('不应调用')
      },
      async deleteDuplicateMatchActivity() {
        throw new Error('不应调用')
      },
    }

    await expect(
      deleteDuplicateMatchHandActivities([item], backend, { statePath })
    ).resolves.toEqual({
      total: 1,
      deleted: 0,
      failed: 1,
    })
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    expect(state.items[0].lastError).toContain('缺少 activityUuid')
  })
})
