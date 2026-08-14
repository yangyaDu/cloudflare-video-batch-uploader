import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'

import ffmpegPath from 'ffmpeg-static'

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

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`视频目录不存在或不是目录: ${path}`)
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null))
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
  return basename(path, extension)
}

export function stateKey(sourceDir: string, videoPath: string): string {
  return relative(sourceDir, videoPath).replaceAll('\\', '/')
}

export function coverFilePath(coverDir: string, key: string, title: string): string {
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || 'video'
  const suffix = createHash('sha256').update(key).digest('hex').slice(0, 12)
  return join(coverDir, `${safeTitle}-${suffix}.jpg`)
}

export async function extractFirstFrame(videoPath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static 未提供当前平台的可执行文件')
  }

  await ensureDirectory(dirname(outputPath))
  const process = Bun.spawn({
    cmd: [
      ffmpegPath,
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      videoPath,
      '-vf',
      'select=eq(n\\,0)',
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
  if (exitCode !== 0) {
    throw new Error(`提取首帧失败: ${stderr.trim() || `ffmpeg exit ${exitCode}`}`)
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await ensureDirectory(dirname(path))
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, path)
}
