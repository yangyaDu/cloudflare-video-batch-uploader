import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import ffmpegPath from 'ffmpeg-static'

import { readVideoCsv } from '../src/video/csv-store'
import { resolveWorkPaths } from '../src/video/paths'
import { scanVideos } from '../src/video/scanner'
import { readUploadState } from '../src/video/state-store'

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

  test('仅扫描英文目录并按配置为介绍和漏洞视频写入相同 primaryTags', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static 不支持当前平台')

    const root = await mkdtemp(join(tmpdir(), 'video-tag-scan-'))
    temporaryDirectories.push(root)
    const workDir = join(root, 'workdir')
    const videoDir = join(workDir, 'video', 'en')
    const introPath = join(videoDir, 'BTN Steal Intro.mp4')
    const leakPath = join(videoDir, 'BTN Steal Leak.mp4')
    const tagConfigPath = join(workDir, 'knowledge.csv')
    await mkdir(videoDir, { recursive: true })

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
        introPath,
      ],
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      ffmpeg.exited,
      new Response(ffmpeg.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    await copyFile(introPath, leakPath)
    await writeFile(
      tagConfigPath,
      [
        '\uFEFF知识点配置表,,,,',
        '展示序号,介绍视频标签,介绍视频EN,漏洞视频EN,备注',
        '1,BTN Steal,BTN Steal Intro,BTN Steal Leak,新加',
      ].join('\r\n'),
      'utf8'
    )

    const result = await scanVideos({ workDir, tagConfigPath })
    const enPaths = resolveWorkPaths(workDir, 'en')
    const zhPaths = resolveWorkPaths(workDir, 'zh')
    const rows = await readVideoCsv(enPaths.csvPath)

    expect(result.total).toBe(2)
    expect(result.csvPaths).toEqual([enPaths.csvPath])
    expect(Object.fromEntries(rows.map((row) => [row.title, JSON.parse(row.primaryTags)]))).toEqual(
      {
        'BTN Steal Intro': ['BTN Steal'],
        'BTN Steal Leak': ['BTN Steal'],
      }
    )
    expect(await stat(zhPaths.statePath).catch(() => null)).toBeNull()
  })

  test('标签匹配失败时不会写入其他语言的半批次文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-tag-preflight-'))
    temporaryDirectories.push(root)
    const workDir = join(root, 'workdir')
    const enDir = join(workDir, 'video', 'en')
    const zhDir = join(workDir, 'video', 'zh')
    const tagConfigPath = join(workDir, 'knowledge.csv')
    await Promise.all([mkdir(enDir, { recursive: true }), mkdir(zhDir, { recursive: true })])
    await writeFile(join(enDir, 'Unexpected.mp4'), '')
    await writeFile(
      tagConfigPath,
      ['介绍视频标签,介绍视频EN,漏洞视频EN', 'BTN Steal,BTN Steal Intro,BTN Steal Leak'].join(
        '\r\n'
      ),
      'utf8'
    )

    await expect(scanVideos({ workDir, tagConfigPath })).rejects.toThrow('未出现在配置 CSV')

    const zhPaths = resolveWorkPaths(workDir, 'zh')
    expect(await stat(zhPaths.csvPath).catch(() => null)).toBeNull()
    expect(await stat(zhPaths.statePath).catch(() => null)).toBeNull()
  })
})
