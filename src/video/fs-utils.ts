import { createHash } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { ensureDirectory, pathExists } from '../fs-utils'

const VIDEO_EXTENSIONS = new Set([
  '.3gp',
  '.avi',
  '.flv',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.mxf',
  '.ts',
  '.webm',
])

export async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`视频目录不存在或不是目录: ${path}`)
  }
}

export async function discoverVideos(sourceDir: string): Promise<string[]> {
  const videos: string[] = []

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        videos.push(path)
      }
    }
  }

  await walk(sourceDir)
  return videos
}

export function videoTitle(path: string): string {
  const extension = extname(path)
  const fileName = basename(path, extension)
  const withoutSequence = fileName.replace(/^\d+-/, '')
  const withoutLanguage = withoutSequence.replace(/[-_]+(?:\[(?:cn|en)\]|cn|en)[-_]*$/i, '')
  const withoutMetadata = withoutLanguage.replace(
    /(?:[-_]+\[(?:river|postflop_fta|sb|bet|kqo)\])+$/i,
    ''
  )
  return withoutMetadata.replace(/[-_]+$/, '')
}

export function stateKey(sourceDir: string, videoPath: string): string {
  return relative(sourceDir, videoPath).replaceAll('\\', '/')
}

export function coverFilePath(coverDir: string, key: string, title: string): string {
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || 'video'
  const suffix = createHash('sha256').update(key).digest('hex').slice(0, 12)
  return join(coverDir, `${safeTitle}-${suffix}.jpg`)
}

const COVER_TIMESTAMP_SECONDS = 1

export async function extractCoverFrame(videoPath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static 未提供当前平台的可执行文件')
  }
  const executablePath = ffmpegPath

  await ensureDirectory(dirname(outputPath))

  async function extractAt(timestamp?: number): Promise<string | null> {
    await rm(outputPath, { force: true }).catch(() => undefined)
    const process = Bun.spawn({
      cmd: [
        executablePath,
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...(timestamp === undefined ? [] : ['-ss', String(timestamp)]),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outputPath,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ])
    return exitCode === 0 && (await pathExists(outputPath))
      ? null
      : stderr.trim() || `ffmpeg exit ${exitCode}`
  }

  const seekError = await extractAt(COVER_TIMESTAMP_SECONDS)
  if (seekError) {
    const fallbackError = await extractAt()
    if (fallbackError) {
      throw new Error(`提取 1 秒处封面失败，且首帧回退失败: ${fallbackError}; 原因: ${seekError}`)
    }
  }
}
