import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { formatDuration, summarizeVideoDurations } from '../src/video/duration'

describe('video duration summary', () => {
  test('formats a total duration as H:MM:SS', () => {
    expect(formatDuration(26124)).toBe('7:15:24')
  })

  test('groups video durations by language and totals them', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static 不支持当前平台')

    const root = await mkdtemp(join(tmpdir(), 'video-duration-'))
    try {
      const enDir = join(root, 'en')
      const zhDir = join(root, 'zh')
      await Promise.all([mkdir(enDir), mkdir(zhDir)])
      const inputs = [
        [join(enDir, 'one-second.mp4'), '1'],
        [join(zhDir, 'two-second.mp4'), '2'],
      ] as const
      for (const [output, duration] of inputs) {
        const ffmpeg = Bun.spawn({
          cmd: [
            ffmpegPath,
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            `color=c=blue:s=320x180:d=${duration}`,
            '-pix_fmt',
            'yuv420p',
            '-y',
            output,
          ],
          stderr: 'pipe',
        })
        expect(await ffmpeg.exited).toBe(0)
      }

      const result = await summarizeVideoDurations(root)

      expect(result.byLanguage.get('en')).toMatchObject({ videoCount: 1, totalSeconds: 1 })
      expect(result.byLanguage.get('zh')).toMatchObject({ videoCount: 1, totalSeconds: 2 })
      expect(result.total).toMatchObject({
        videoCount: 2,
        totalSeconds: 3,
        formattedDuration: '0:00:03',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
