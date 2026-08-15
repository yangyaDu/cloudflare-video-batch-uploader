import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  generateDuplicateMatchHandCaseFile,
  readDuplicateMatchHandCaseFile,
  resolveDuplicateMatchHandPaths,
} from '../src/duplicate-match-hand/workspace'
import { readHandTableIdCsv, writeHandTableIdCsv } from '../src/duplicate-match-hand/table-id-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('duplicate match hand workspace', () => {
  test('生成并重新读取 Case 清单', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)

    const generated = await generateDuplicateMatchHandCaseFile(directory)
    const loaded = await readDuplicateMatchHandCaseFile(directory)
    const paths = resolveDuplicateMatchHandPaths(directory)

    expect(generated.cases.length).toBeGreaterThan(0)
    expect(loaded.cases).toEqual(generated.cases)
    expect(paths.casesPath).toBe(join(directory, 'duplicate-match-hand', 'cases.json'))
    expect(paths.statePath).toBe(join(directory, 'duplicate-match-hand', 'upload-state.json'))
    expect(paths.tableIdsPath).toBe(join(directory, 'duplicate-match-hand', 'table-ids.csv'))
    expect(paths.gameHandHistoryResultsDir).toBe(
      join(directory, 'duplicate-match-hand', 'game-hand-history-results')
    )
    expect(paths.dataServicesResultsDir).toBe(
      join(directory, 'duplicate-match-hand', 'data-services-results')
    )

    const csvText = await readFile(paths.tableIdsPath, 'utf8')
    expect(csvText.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]).toBe(
      'caseId,title,handId,activityId,tableId'
    )
    const tableIdRows = await readHandTableIdCsv(paths.tableIdsPath)
    expect(tableIdRows).toHaveLength(generated.cases.length)
    expect(tableIdRows[0]).toEqual({
      caseId: generated.cases[0]!.caseId,
      title: generated.cases[0]!.title,
      handId: '',
      activityId: '',
      tableId: '',
    })
  })

  test('重复生成 Case 时保留已经填写的 tableId', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)

    const generated = await generateDuplicateMatchHandCaseFile(directory)
    const paths = resolveDuplicateMatchHandPaths(directory)
    const rows = await readHandTableIdCsv(paths.tableIdsPath)
    rows[0]!.tableId = '7f0000010fa0_125201195936514053'
    await writeHandTableIdCsv(paths.tableIdsPath, rows)

    await generateDuplicateMatchHandCaseFile(directory)

    const regeneratedRows = await readHandTableIdCsv(paths.tableIdsPath)
    expect(regeneratedRows).toHaveLength(generated.cases.length)
    expect(regeneratedRows[0]!.tableId).toBe('7f0000010fa0_125201195936514053')
  })

  test('兼容读取旧版三列表头的 tableId CSV', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'duplicate-match-hand-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'table-ids.csv')
    await writeFile(path, 'caseId,title,tableId\ncase-1,Legacy title,table-1\n')

    await expect(readHandTableIdCsv(path)).resolves.toEqual([
      {
        caseId: 'case-1',
        title: 'Legacy title',
        handId: '',
        activityId: '',
        tableId: 'table-1',
      },
    ])
  })
})
