import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createVideoBatchSql,
  deriveVideoLanguage,
  exportVideoBatchSql,
  type VideoExportRow,
} from '../src/video/sql-exporter'
import { resolveWorkPaths } from '../src/video/paths'
import { writeUploadState } from '../src/video/state-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

function video(overrides: Partial<VideoExportRow> = {}): VideoExportRow {
  return {
    id: 103,
    crossId: '41951987960381445',
    title: "Beginner's Guide",
    titleDescription: 'Line 1\\Line 2',
    coverId: 'cover-id',
    coverUrl: 'https://imagedelivery.net/account/cover-id/public',
    status: 1,
    difficulty: 10,
    isDeleted: 0,
    primaryTags: [],
    secondaryTags: [],
    publishedAt: Date.UTC(2026, 7, 15, 1, 2, 3),
    videoDuration: 16,
    videoSize: 43714120,
    videoUid: 'stream-uid',
    gmtCreate: Date.UTC(2026, 7, 15, 1, 0, 0),
    ...overrides,
  }
}

describe('deriveVideoLanguage', () => {
  test('沿用标题包含一至鿿为中文，否则为英文的规则', () => {
    expect(deriveVideoLanguage('中文素材')).toBe('zh')
    expect(deriveVideoLanguage('English material')).toBe('en')
  })
})

describe('createVideoBatchSql', () => {
  test('不导出 pk_id，操作人字段固定为 1，并按标题重新计算语言', () => {
    const sql = createVideoBatchSql([video({ id: 999, title: '中文素材' })])

    expect(sql).not.toContain('`pk_id`')
    expect(sql).toContain("'zh'")
    expect(sql).toContain('  1,\n  FROM_UNIXTIME(')
    expect(sql).toContain('  1,\n  1,\n  FROM_UNIXTIME(')
    expect(sql).toContain('ON DUPLICATE KEY UPDATE')
    expect(sql).toContain('`uk_cross_id`')
  })

  test('使用十六进制 UTF-8 字面量安全保存引号、反斜杠和中文', () => {
    const sql = createVideoBatchSql([video({ title: "中文'标题\\A" })])

    expect(sql).toContain("CONVERT(X'")
    expect(sql).not.toContain("中文'标题")
    expect(sql).toContain("'zh'")
  })

  test('拒绝空 crossId 和未发布视频，并保留标签 JSON', () => {
    expect(() => createVideoBatchSql([video({ crossId: '' })])).toThrow('crossId')
    expect(() => createVideoBatchSql([video({ status: 0 })])).toThrow('未发布')
    expect(
      createVideoBatchSql([video({ primaryTags: ['tag'], secondaryTags: ['leak'] })])
    ).toContain("CONVERT(X'5b22746167225d' USING utf8mb4)")
    expect(
      createVideoBatchSql([video({ primaryTags: ['tag'], secondaryTags: ['leak'] })])
    ).toContain("CONVERT(X'5b226c65616b225d' USING utf8mb4)")
  })
})

describe('exportVideoBatchSql', () => {
  test('只使用实际存在的英文状态文件中的已发布 videoId 生成指定 SQL 文件', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'video-sql-export-'))
    temporaryDirectories.push(workDir)
    const paths = resolveWorkPaths(workDir, 'en')
    await writeUploadState(paths.statePath, {
      version: 2,
      sourceDir: paths.videoDir,
      workDir,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      items: [
        {
          key: 'en.mp4',
          rowIndex: 0,
          relativeVideoPath: 'en.mp4',
          videoPath: join(paths.videoDir, 'en.mp4'),
          coverPath: join(paths.coverDir, 'en.jpg'),
          stage: 'completed',
          videoId: 103,
          videoRegistered: true,
          videoPublished: true,
          lastError: null,
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    })

    let requestedIds: readonly number[] = []
    const result = await exportVideoBatchSql(workDir, undefined, {
      async listVideosByIds(ids) {
        requestedIds = ids
        return ids.map((id) => video({ id, crossId: `cross-${id}`, title: `Video ${id}` }))
      },
    })

    expect(requestedIds).toEqual([103])
    expect(result.outputPath).toBe(join(workDir, 'sql', 'tb_video.sql'))
    expect(result.count).toBe(1)
    expect(await readFile(result.outputPath, 'utf8')).not.toContain('`pk_id`')
  })
})
