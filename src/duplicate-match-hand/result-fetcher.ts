import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWrite, pathExists } from '../fs-utils'
import type { DataServicesHandsApiResponse } from './data-services-client'
import type { GameHandHistoryApiResponse } from './game-hand-history-client'
import type { HandTableIdRow } from './table-id-store'
import type { GeneratedHandCase } from './types'

export interface DataServicesHandsBackend {
  fetchHandsByTableId(tableId: string): Promise<DataServicesHandsApiResponse>
}

export interface GameHandHistoryBackend {
  fetchGameHandHistory(tableId: string): Promise<GameHandHistoryApiResponse>
}

export interface HandDataServicesResult {
  caseId: string
  title: string
  tableId: string
  fetchedAt: string
  query: {
    page: 1
    pageSize: 1
    filter: string
  }
  response: DataServicesHandsApiResponse
}

export interface HandResultFetchSummary {
  total: number
  fetched: number
  skipped: number
  failed: number
}

export interface GameHandHistoryResult {
  caseId: string
  title: string
  tableId: string
  fetchedAt: string
  request: {
    method: 'POST'
    path: '/api/game_client/get_hand_history'
    body: { tableId: string }
  }
  response: GameHandHistoryApiResponse
}

async function hasSameSavedResult(path: string, row: HandTableIdRow): Promise<boolean> {
  if (!(await pathExists(path))) return false
  try {
    const saved = JSON.parse(await readFile(path, 'utf8')) as Partial<HandDataServicesResult>
    return saved.caseId === row.caseId && saved.tableId === row.tableId
  } catch {
    return false
  }
}

function configuredRowsWithUniqueTableIds(rows: readonly HandTableIdRow[]): HandTableIdRow[] {
  const configuredRows = rows
    .map((row) => ({ ...row, tableId: row.tableId.trim() }))
    .filter((row) => row.tableId)
  const duplicateTableId = configuredRows.find(
    (row, index) => configuredRows.findIndex((other) => other.tableId === row.tableId) !== index
  )?.tableId
  if (duplicateTableId) {
    throw new Error(`tableId 重复关联多个 Case: ${duplicateTableId}`)
  }
  return configuredRows
}

/** 将 CSV 中每个 tableId 的完整 API 响应保存为同 caseId 的独立 JSON。 */
export async function fetchHandDataServicesResults(
  rows: readonly HandTableIdRow[],
  cases: readonly GeneratedHandCase[],
  backend: DataServicesHandsBackend,
  options: { resultsDir: string }
): Promise<HandResultFetchSummary> {
  const caseById = new Map(cases.map((item) => [item.caseId, item]))
  const configuredRows = configuredRowsWithUniqueTableIds(rows)
  const summary: HandResultFetchSummary = {
    total: configuredRows.length,
    fetched: 0,
    skipped: 0,
    failed: 0,
  }

  for (const row of configuredRows) {
    const handCase = caseById.get(row.caseId)
    if (!handCase || handCase.title !== row.title || !/^[a-z0-9-]+$/.test(row.caseId)) {
      summary.failed += 1
      console.error(`[Data Services] CSV Case 不匹配，跳过: ${row.caseId}`)
      continue
    }
    const resultPath = join(options.resultsDir, `${row.caseId}.json`)
    if (await hasSameSavedResult(resultPath, row)) {
      summary.skipped += 1
      continue
    }

    try {
      const response = await backend.fetchHandsByTableId(row.tableId)
      const result: HandDataServicesResult = {
        caseId: row.caseId,
        title: row.title,
        tableId: row.tableId,
        fetchedAt: new Date().toISOString(),
        query: {
          page: 1,
          pageSize: 1,
          filter: `table_id:eq:${row.tableId}`,
        },
        response,
      }
      await atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`)
      summary.fetched += 1
    } catch (error) {
      summary.failed += 1
      console.error(
        `[Data Services] ${row.caseId} 查询失败: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return summary
}

/** 将 get_hand_history 的完整响应按同一 caseId/tableId 保存，并支持独立重试。 */
export async function fetchGameHandHistoryResults(
  rows: readonly HandTableIdRow[],
  cases: readonly GeneratedHandCase[],
  backend: GameHandHistoryBackend,
  options: { resultsDir: string }
): Promise<HandResultFetchSummary> {
  const caseById = new Map(cases.map((item) => [item.caseId, item]))
  const configuredRows = configuredRowsWithUniqueTableIds(rows)
  const summary: HandResultFetchSummary = {
    total: configuredRows.length,
    fetched: 0,
    skipped: 0,
    failed: 0,
  }

  for (const row of configuredRows) {
    const handCase = caseById.get(row.caseId)
    if (!handCase || handCase.title !== row.title || !/^[a-z0-9-]+$/.test(row.caseId)) {
      summary.failed += 1
      console.error(`[get_hand_history] CSV Case 不匹配，跳过: ${row.caseId}`)
      continue
    }
    const resultPath = join(options.resultsDir, `${row.caseId}.json`)
    if (await hasSameSavedResult(resultPath, row)) {
      summary.skipped += 1
      continue
    }

    try {
      const response = await backend.fetchGameHandHistory(row.tableId)
      const result: GameHandHistoryResult = {
        caseId: row.caseId,
        title: row.title,
        tableId: row.tableId,
        fetchedAt: new Date().toISOString(),
        request: {
          method: 'POST',
          path: '/api/game_client/get_hand_history',
          body: { tableId: row.tableId },
        },
        response,
      }
      await atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`)
      summary.fetched += 1
    } catch (error) {
      summary.failed += 1
      console.error(
        `[get_hand_history] ${row.caseId} 查询失败: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return summary
}
