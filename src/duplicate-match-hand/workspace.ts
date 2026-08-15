import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { atomicWrite } from '../fs-utils'
import { generateDuplicateMatchHandCases } from './case-catalog'
import { syncHandTableIdCsv } from './table-id-store'
import type { GeneratedHandCase } from './types'

export interface DuplicateMatchHandManifest {
  version: 1
  generatedAt: string
  cases: GeneratedHandCase[]
}

export function resolveDuplicateMatchHandPaths(workDir: string) {
  const rootDir = join(resolve(workDir), 'duplicate-match-hand')
  return {
    rootDir,
    casesPath: join(rootDir, 'cases.json'),
    statePath: join(rootDir, 'upload-state.json'),
    tableIdsPath: join(rootDir, 'table-ids.csv'),
    dataServicesResultsDir: join(rootDir, 'data-services-results'),
    gameHandHistoryResultsDir: join(rootDir, 'game-hand-history-results'),
  }
}

export async function generateDuplicateMatchHandCaseFile(
  workDir: string
): Promise<DuplicateMatchHandManifest> {
  const manifest: DuplicateMatchHandManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    cases: generateDuplicateMatchHandCases(),
  }
  const { casesPath, tableIdsPath } = resolveDuplicateMatchHandPaths(workDir)
  await atomicWrite(casesPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await syncHandTableIdCsv(tableIdsPath, manifest.cases)
  return manifest
}

export async function readDuplicateMatchHandCaseFile(
  workDir: string
): Promise<DuplicateMatchHandManifest> {
  const { casesPath } = resolveDuplicateMatchHandPaths(workDir)
  const manifest = JSON.parse(await readFile(casesPath, 'utf8')) as DuplicateMatchHandManifest
  if (manifest.version !== 1 || !Array.isArray(manifest.cases)) {
    throw new Error(`不支持的复式手牌 Case 文件: ${casesPath}`)
  }
  return manifest
}
