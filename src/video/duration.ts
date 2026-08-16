import { join, resolve } from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { pathExists } from '../fs-utils'
import { assertDirectory, discoverVideos } from './fs-utils'
import { VIDEO_LANGUAGES } from './paths'

export interface DurationSummary {
  videoCount: number
  totalSeconds: number
  formattedDuration: string
}

export interface VideoDurationSummary {
  byLanguage: ReadonlyMap<string, DurationSummary>
  total: DurationSummary
}

function parseDuration(stderr: string): number {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (!match) throw new Error('未能从 ffmpeg 输出读取视频时长')

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return hours * 60 * 60 + minutes * 60 + seconds
}

export function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.round(totalSeconds)
  const hours = Math.floor(roundedSeconds / 3600)
  const minutes = Math.floor((roundedSeconds % 3600) / 60)
  const seconds = roundedSeconds % 60
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export async function probeVideoDuration(videoPath: string): Promise<number> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台的可执行文件')

  const process = Bun.spawn({
    cmd: [ffmpegPath, '-hide_banner', '-i', videoPath],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])

  try {
    return parseDuration(stderr)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`读取视频时长失败: ${videoPath}; ${reason}`)
  }
}

function createSummary(durations: readonly number[]): DurationSummary {
  const totalSeconds = durations.reduce((sum, duration) => sum + duration, 0)
  return {
    videoCount: durations.length,
    totalSeconds,
    formattedDuration: formatDuration(totalSeconds),
  }
}

export async function summarizeVideoDurations(videoRoot: string): Promise<VideoDurationSummary> {
  const root = resolve(videoRoot)
  await assertDirectory(root)

  const byLanguage = new Map<string, DurationSummary>()
  const allDurations: number[] = []
  for (const language of VIDEO_LANGUAGES) {
    const sourceDir = join(root, language)
    const directory = await pathExists(sourceDir)
    if (!directory) continue

    await assertDirectory(sourceDir)
    const durations: number[] = []
    for (const videoPath of await discoverVideos(sourceDir)) {
      durations.push(await probeVideoDuration(videoPath))
    }
    allDurations.push(...durations)
    byLanguage.set(language, createSummary(durations))
  }

  if (byLanguage.size === 0) {
    throw new Error(`视频根目录中缺少 en 或 zh 子目录: ${root}`)
  }

  return { byLanguage, total: createSummary(allDurations) }
}
