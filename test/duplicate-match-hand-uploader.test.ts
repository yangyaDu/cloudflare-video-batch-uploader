import { afterEach, describe, expect, test } from 'bun:test'
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
    const activityId = 201
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
        return { id: activityId }
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
      `publish-activity:${activityId}`,
    ])
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    expect(state.items[0]).toMatchObject({
      caseId: item.caseId,
      handId,
      handPublished: true,
      activityId,
      activityPublished: true,
      stage: 'completed',
      lastError: null,
    })
    await expect(readHandTableIdCsv(tableIdsPath)).resolves.toEqual([
      {
        caseId: item.caseId,
        title: item.title,
        handId: String(handId),
        activityId: String(activityId),
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
        return { id: 401 }
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

  test('按状态文件中的 activityId 取消发布、删除并清空活动状态', async () => {
    const calls: string[] = []
    const backend: DuplicateMatchHandBackend = {
      async addDuplicateMatchHand() {
        return { id: 101 }
      },
      async publishDuplicateMatchHand() {},
      async addDuplicateMatchActivity() {
        return { id: 201 }
      },
      async publishDuplicateMatchActivity() {},
      async unpublishDuplicateMatchActivity(id) {
        calls.push(`unpublish:${id}`)
      },
      async deleteDuplicateMatchActivity(id) {
        calls.push(`delete:${id}`)
        return { id, isDeleted: 1 }
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
    expect(calls).toEqual(['unpublish:201', 'delete:201'])
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    expect(state.items[0]).toMatchObject({
      handId: 101,
      handPublished: true,
      stage: 'hand-published',
      lastError: null,
    })
    expect(state.items[0].activityId).toBeUndefined()
    expect(state.items[0].activityPublished).toBeUndefined()
    await expect(readHandTableIdCsv(tableIdsPath)).resolves.toEqual([
      {
        caseId: item.caseId,
        title: item.title,
        handId: '101',
        activityId: '',
        tableId: '',
      },
    ])
  })
})
