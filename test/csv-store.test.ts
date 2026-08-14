import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readVideoCsv, writeVideoCsv } from '../src/video/csv-store'
import { createDefaultVideoRow } from '../src/video/video-schema'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('video CSV store', () => {
  test('可往返保存中文、逗号和 JSON 字段', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-uploader-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'videos.csv')
    const row = createDefaultVideoRow('中文,标题', 'zh')
    row.primaryTags = '["基础","翻前"]'

    await writeVideoCsv(path, [row])
    const loaded = await readVideoCsv(path)

    expect(loaded).toEqual([row])
    expect(await readFile(path, 'utf8')).toStartWith('\uFEFF')
  })
})
