import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'

import { DEFAULT_VIDEO_WORK_DIR, resolveWorkPaths } from '../src/video/paths'

describe('video paths', () => {
  test('默认批次的视频、封面和状态都位于 update_video_no_tags 下', () => {
    const workDir = resolve(DEFAULT_VIDEO_WORK_DIR)
    const paths = resolveWorkPaths(DEFAULT_VIDEO_WORK_DIR, 'zh')

    expect(workDir).toEndWith(join('workdir', 'update_video_no_tags'))
    expect(paths.videoDir).toBe(join(workDir, 'video', 'zh'))
    expect(paths.coverDir).toBe(join(workDir, 'covers', 'zh'))
    expect(paths.csvPath).toBe(join(workDir, 'doc', 'zh', 'videos.csv'))
    expect(paths.statePath).toBe(join(workDir, 'doc', 'zh', 'upload-state.json'))
  })
})
