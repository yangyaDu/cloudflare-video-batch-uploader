import { readFile } from 'node:fs/promises'

import { atomicWrite } from '../fs-utils'
import type { UploadState } from './types'

export async function writeUploadState(path: string, state: UploadState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`)
}

export async function readUploadState(path: string): Promise<UploadState> {
  const value = JSON.parse(await readFile(path, 'utf8')) as UploadState
  if ((value.version !== 1 && value.version !== 2) || !Array.isArray(value.items)) {
    throw new Error(`不支持的上传状态文件: ${path}`)
  }
  return value
}
