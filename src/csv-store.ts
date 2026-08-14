import { readFile } from 'node:fs/promises'

import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

import { atomicWrite } from './fs-utils'
import {
  assertVideoHeaders,
  VIDEO_COLUMNS,
  type VideoColumn,
  type VideoCsvRow,
} from './video-schema'

export async function writeVideoCsv(path: string, rows: readonly VideoCsvRow[]): Promise<void> {
  const csv = stringify([...rows], {
    header: true,
    columns: [...VIDEO_COLUMNS],
    bom: true,
    record_delimiter: 'windows',
  })
  await atomicWrite(path, csv)
}

export async function readVideoCsv(path: string): Promise<VideoCsvRow[]> {
  const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  let headers: string[] = []
  const records = parse(content, {
    bom: true,
    columns: (actualHeaders: string[]) => {
      headers = actualHeaders
      return actualHeaders
    },
    skip_empty_lines: true,
    relax_column_count: false,
    trim: false,
  }) as Array<Record<string, string>>

  assertVideoHeaders(headers)
  return records.map((record, rowIndex) => {
    const row = {} as VideoCsvRow
    for (const column of VIDEO_COLUMNS) {
      const value = record[column]
      if (value === undefined) {
        throw new Error(`CSV 第 ${rowIndex + 2} 行缺少字段 ${column}`)
      }
      row[column as VideoColumn] = value
    }
    return row
  })
}
