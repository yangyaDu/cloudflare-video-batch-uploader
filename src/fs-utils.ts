import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null))
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await ensureDirectory(dirname(path))
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, path)
}
