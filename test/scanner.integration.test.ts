import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import ffmpegPath from 'ffmpeg-static'

import { readVideoCsv } from '../src/csv-store'
import { resolveWorkPaths } from '../src/paths'
import { scanVideos } from '../src/scanner'
import { readUploadState } from '../src/state-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('scanVideos integration', () => {
  test('扫描真实视频并提取第一帧', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static 不支持当前平台')

    const root = await mkdtemp(join(tmpdir(), 'video-scan-'))
    temporaryDirectories.push(root)
    const workDir = join(root, 'workdir')
    const videoDir = join(workDir, 'video')
    const videoPath = join(videoDir, 'zh', '中文基础 Lesson 01.mp4')
    await Promise.all([
      mkdir(join(videoDir, 'en'), { recursive: true }),
      mkdir(join(videoDir, 'zh'), { recursive: true }),
    ])

    const ffmpeg = Bun.spawn({
      cmd: [
        ffmpegPath,
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x180:d=1',
        '-pix_fmt',
        'yuv420p',
        '-y',
        videoPath,
      ],
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      ffmpeg.exited,
      new Response(ffmpeg.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)

    const result = await scanVideos({ workDir })
    const zhPaths = resolveWorkPaths(workDir, 'zh')
    const enPaths = resolveWorkPaths(workDir, 'en')
    const rows = await readVideoCsv(zhPaths.csvPath)

    expect(result.total).toBe(1)
    expect(result.added).toBe(1)
    expect(result.failures).toBe(0)
    expect(rows[0]?.title).toBe('中文基础 Lesson 01')
    expect(rows[0]?.language).toBe('zh')
    expect((await stat(zhPaths.coverDir)).isDirectory()).toBeTrue()
    expect((await stat(zhPaths.statePath)).size).toBeGreaterThan(0)
    expect(await readVideoCsv(enPaths.csvPath)).toHaveLength(0)
    expect(result.csvPaths).toEqual([enPaths.csvPath, zhPaths.csvPath])

    const newVideoPath = join(videoDir, 'zh', '新增视频.mp4')
    await copyFile(videoPath, newVideoPath)
    const incrementalResult = await scanVideos({ workDir })
    const incrementalRows = await readVideoCsv(zhPaths.csvPath)
    const incrementalState = await readUploadState(zhPaths.statePath)
    const newItem = incrementalState.items.find((item) => item.relativeVideoPath === '新增视频.mp4')

    expect(incrementalResult.total).toBe(2)
    expect(incrementalResult.added).toBe(1)
    expect(incrementalRows.map((row) => row.title)).toEqual(['中文基础 Lesson 01', '新增视频'])
    expect(newItem).toBeDefined()
    expect((await stat(newItem!.coverPath)).isFile()).toBeTrue()
  })
})
