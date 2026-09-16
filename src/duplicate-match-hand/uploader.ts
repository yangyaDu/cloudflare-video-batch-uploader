import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { atomicWrite, pathExists } from '../fs-utils'
import { syncHandTableIdCsv } from './table-id-store'
import type {
  DuplicateMatchHandBackend,
  GeneratedHandCase,
  HandCaseUploadItemState,
  HandCaseUploadStage,
  HandCaseUploadState,
} from './types'

const ACTIVITY_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export interface HandCaseUploadResult {
  total: number
  completed: number
  failed: number
}

export interface HandCaseUploadOptions {
  statePath: string
  tableIdsPath?: string
  now?: () => number
}

function requestHash(item: GeneratedHandCase): string {
  return createHash('sha256').update(JSON.stringify(item.request)).digest('hex')
}

function markItem(
  item: HandCaseUploadItemState,
  stage: HandCaseUploadStage,
  error: string | null = null
): void {
  item.stage = stage
  item.lastError = error
  item.updatedAt = new Date().toISOString()
}

async function writeState(
  path: string,
  state: HandCaseUploadState,
  cases: readonly GeneratedHandCase[],
  tableIdsPath?: string
): Promise<void> {
  state.updatedAt = new Date().toISOString()
  await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`)
  if (tableIdsPath) await syncHandTableIdCsv(tableIdsPath, cases, state.items)
}

async function loadState(
  cases: readonly GeneratedHandCase[],
  statePath: string
): Promise<HandCaseUploadState> {
  if (!(await pathExists(statePath))) {
    const now = new Date().toISOString()
    return {
      version: 1,
      createdAt: now,
      updatedAt: now,
      items: cases.map((item) => ({
        caseId: item.caseId,
        title: item.title,
        requestHash: requestHash(item),
        stage: 'pending',
        lastError: null,
        updatedAt: now,
      })),
    }
  }

  const state = JSON.parse(await readFile(statePath, 'utf8')) as HandCaseUploadState
  if (state.version !== 1 || !Array.isArray(state.items)) {
    throw new Error(`不支持的手牌上传状态文件: ${statePath}`)
  }
  const byCaseId = new Map(state.items.map((item) => [item.caseId, item]))
  for (const handCase of cases) {
    const existing = byCaseId.get(handCase.caseId)
    const hash = requestHash(handCase)
    if (!existing) {
      const now = new Date().toISOString()
      state.items.push({
        caseId: handCase.caseId,
        title: handCase.title,
        requestHash: hash,
        stage: 'pending',
        lastError: null,
        updatedAt: now,
      })
      continue
    }
    if (existing.requestHash !== hash) {
      throw new Error(`Case ${handCase.caseId} 内容已变化，请清理对应状态后再上传`)
    }
  }
  return state
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function activityUuid(item: HandCaseUploadItemState): string | undefined {
  if (item.activityUuid) return item.activityUuid
  const legacyActivityId = (item as HandCaseUploadItemState & { activityId?: unknown }).activityId
  if (legacyActivityId !== undefined) {
    throw new Error(
      `Case ${item.caseId} 仅保存了旧版 activityId (${legacyActivityId})，缺少 activityUuid；请先从后端查询并写入 activityUuid 后再继续`
    )
  }
  return undefined
}

/**
 * 逐条完成“新增手牌、发布手牌、新增活动、发布活动”，每一步成功后立即保存状态。
 * 已保存的远端 ID 和发布标记会在重试时复用。
 */
export async function uploadDuplicateMatchHandCases(
  cases: readonly GeneratedHandCase[],
  backend: DuplicateMatchHandBackend,
  options: HandCaseUploadOptions
): Promise<HandCaseUploadResult> {
  const now = options.now ?? Date.now
  const state = await loadState(cases, options.statePath)
  const caseById = new Map(cases.map((item) => [item.caseId, item]))
  let completed = 0
  let failed = 0

  for (const item of state.items.filter((candidate) => caseById.has(candidate.caseId))) {
    const handCase = caseById.get(item.caseId)!
    try {
      if (!item.handId) {
        const hand = await backend.addDuplicateMatchHand(handCase.request)
        item.handId = hand.id
        markItem(item, 'hand-created')
        await writeState(options.statePath, state, cases, options.tableIdsPath)
      }

      if (!item.handPublished) {
        await backend.publishDuplicateMatchHand(item.handId)
        item.handPublished = true
        markItem(item, 'hand-published')
        await writeState(options.statePath, state, cases, options.tableIdsPath)
      }

      let savedActivityUuid = activityUuid(item)
      if (!savedActivityUuid) {
        const startTime = now()
        const activity = await backend.addDuplicateMatchActivity({
          title: handCase.title,
          description: `Data Services 场景参数验证：${handCase.title}`,
          playHandCount: 1,
          playCount: handCase.request.drillInfo.players.length,
          handList: [{ handId: item.handId, itemType: 1, sortNo: 1 }],
          startTime,
          endTime: startTime + ACTIVITY_DURATION_MS,
        })
        item.activityUuid = activity.activityUuid
        savedActivityUuid = item.activityUuid
        markItem(item, 'activity-created')
        await writeState(options.statePath, state, cases, options.tableIdsPath)
      }

      if (!item.activityPublished) {
        await backend.publishDuplicateMatchActivity(savedActivityUuid)
        item.activityPublished = true
        markItem(item, 'completed')
        await writeState(options.statePath, state, cases, options.tableIdsPath)
      }

      completed += 1
    } catch (error) {
      failed += 1
      markItem(item, 'failed', errorMessage(error))
      await writeState(options.statePath, state, cases, options.tableIdsPath)
    }
  }

  return { total: cases.length, completed, failed }
}

/**
 * 删除本地状态文件中登记的活动，并清除 activityUuid 以便随后的上传命令重建活动。
 * 仅处理当前 cases.json 中同 caseId、同标题的记录，不会按标题扫描或删除其他远端活动。
 */
export async function deleteDuplicateMatchHandActivities(
  cases: readonly GeneratedHandCase[],
  backend: DuplicateMatchHandBackend,
  options: HandCaseUploadOptions
): Promise<{ deleted: number; failed: number; total: number }> {
  const state = await loadState(cases, options.statePath)
  const caseById = new Map(cases.map((item) => [item.caseId, item]))
  let deleted = 0
  let failed = 0

  for (const item of state.items.filter((candidate) => caseById.has(candidate.caseId))) {
    try {
      const savedActivityUuid = activityUuid(item)
      if (!savedActivityUuid) continue
      const handCase = caseById.get(item.caseId)!
      if (item.title !== handCase.title) {
        throw new Error(`Case ${item.caseId} 标题已变化，拒绝删除远端活动`)
      }
      if (item.activityPublished) {
        await backend.unpublishDuplicateMatchActivity(savedActivityUuid)
        item.activityPublished = false
        markItem(item, 'activity-created')
        await writeState(options.statePath, state, cases, options.tableIdsPath)
      }
      await backend.deleteDuplicateMatchActivity(savedActivityUuid)
      delete item.activityUuid
      delete item.activityPublished
      markItem(item, item.handPublished ? 'hand-published' : 'hand-created')
      await writeState(options.statePath, state, cases, options.tableIdsPath)
      deleted += 1
    } catch (error) {
      failed += 1
      markItem(item, 'failed', errorMessage(error))
      await writeState(options.statePath, state, cases, options.tableIdsPath)
    }
  }

  return { total: cases.length, deleted, failed }
}
