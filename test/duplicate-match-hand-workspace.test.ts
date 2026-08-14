import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  generateDuplicateMatchHandCaseFile,
  readDuplicateMatchHandCaseFile,
  resolveDuplicateMatchHandPaths,
} from '../src/duplicate-match-hand/workspace'

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
  })
})
