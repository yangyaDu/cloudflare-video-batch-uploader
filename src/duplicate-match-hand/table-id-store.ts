import { readFile } from 'node:fs/promises'

import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

import { atomicWrite, pathExists } from '../fs-utils'
import type { GeneratedHandCase, HandCaseUploadItemState } from './types'

const HAND_TABLE_ID_COLUMNS = ['caseId', 'title', 'handId', 'activityId', 'tableId'] as const
const LEGACY_HAND_TABLE_ID_COLUMNS = ['caseId', 'title', 'tableId'] as const

export interface HandTableIdRow {
  caseId: string
  title: string
  handId?: string
  activityId?: string
  tableId: string
}

export async function writeHandTableIdCsv(
  path: string,
  rows: readonly HandTableIdRow[]
): Promise<void> {
  const csv = stringify([...rows], {
    header: true,
    columns: [...HAND_TABLE_ID_COLUMNS],
    bom: true,
    record_delimiter: 'windows',
  })
  await atomicWrite(path, csv)
}

export async function readHandTableIdCsv(path: string): Promise<HandTableIdRow[]> {
  const content = await readFile(path, 'utf8')
  let headers: string[] = []
  const rows = parse(content, {
    bom: true,
    columns: (actualHeaders: string[]) => {
      headers = actualHeaders
      return actualHeaders
    },
    skip_empty_lines: true,
  }) as HandTableIdRow[]

  const isCurrentHeader =
    headers.length === HAND_TABLE_ID_COLUMNS.length &&
    headers.every((header, index) => header === HAND_TABLE_ID_COLUMNS[index])
  const isLegacyHeader =
    headers.length === LEGACY_HAND_TABLE_ID_COLUMNS.length &&
    headers.every((header, index) => header === LEGACY_HAND_TABLE_ID_COLUMNS[index])
  if (!isCurrentHeader && !isLegacyHeader) {
    throw new Error(`tableId CSV 表头必须为: ${HAND_TABLE_ID_COLUMNS.join(',')}`)
  }
  return rows.map((row) => ({
    caseId: row.caseId,
    title: row.title,
    handId: row.handId ?? '',
    activityId: row.activityId ?? '',
    tableId: row.tableId,
  }))
}

/** 根据当前 Case 刷新 CSV 行，同时按 caseId 保留人工填写的 tableId。 */
export async function syncHandTableIdCsv(
  path: string,
  cases: readonly GeneratedHandCase[],
  states?: readonly HandCaseUploadItemState[]
): Promise<HandTableIdRow[]> {
  const existingRows = (await pathExists(path)) ? await readHandTableIdCsv(path) : []
  const existingByCaseId = new Map(existingRows.map((row) => [row.caseId, row]))
  const stateByCaseId = states ? new Map(states.map((item) => [item.caseId, item])) : undefined
  const rows = cases.map((item) => ({
    caseId: item.caseId,
    title: item.title,
    handId: stateByCaseId?.has(item.caseId)
      ? String(stateByCaseId.get(item.caseId)?.handId ?? '')
      : (existingByCaseId.get(item.caseId)?.handId ?? ''),
    activityId: stateByCaseId?.has(item.caseId)
      ? String(stateByCaseId.get(item.caseId)?.activityId ?? '')
      : (existingByCaseId.get(item.caseId)?.activityId ?? ''),
    tableId: existingByCaseId.get(item.caseId)?.tableId ?? '',
  }))
  await writeHandTableIdCsv(path, rows)
  return rows
}
