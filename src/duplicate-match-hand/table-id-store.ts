import { readFile } from 'node:fs/promises'

import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

import { atomicWrite, pathExists } from '../fs-utils'
import type { GeneratedHandCase } from './types'

const HAND_TABLE_ID_COLUMNS = ['caseId', 'title', 'tableId'] as const

export interface HandTableIdRow {
  caseId: string
  title: string
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

  if (
    headers.length !== HAND_TABLE_ID_COLUMNS.length ||
    headers.some((header, index) => header !== HAND_TABLE_ID_COLUMNS[index])
  ) {
    throw new Error(`tableId CSV 表头必须为: ${HAND_TABLE_ID_COLUMNS.join(',')}`)
  }
  return rows
}

/** 根据当前 Case 刷新 CSV 行，同时按 caseId 保留人工填写的 tableId。 */
export async function syncHandTableIdCsv(
  path: string,
  cases: readonly GeneratedHandCase[]
): Promise<HandTableIdRow[]> {
  const existingRows = (await pathExists(path)) ? await readHandTableIdCsv(path) : []
  const tableIdByCaseId = new Map(existingRows.map((row) => [row.caseId, row.tableId]))
  const rows = cases.map((item) => ({
    caseId: item.caseId,
    title: item.title,
    tableId: tableIdByCaseId.get(item.caseId) ?? '',
  }))
  await writeHandTableIdCsv(path, rows)
  return rows
}
