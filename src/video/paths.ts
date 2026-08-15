import { join, resolve } from 'node:path'

export const VIDEO_LANGUAGES = ['en', 'zh'] as const
export type VideoLanguage = (typeof VIDEO_LANGUAGES)[number]

/** 当前视频批次的默认工作目录。 */
export const DEFAULT_VIDEO_WORK_DIR = './workdir/update_video_no_tags'

export interface WorkPaths {
  workDir: string
  language: VideoLanguage
  videoDir: string
  coverDir: string
  docDir: string
  csvPath: string
  statePath: string
}

export function resolveWorkPaths(workDir: string, language: VideoLanguage): WorkPaths {
  const absoluteWorkDir = resolve(workDir)
  return {
    workDir: absoluteWorkDir,
    language,
    videoDir: join(absoluteWorkDir, 'video', language),
    coverDir: join(absoluteWorkDir, 'covers', language),
    docDir: join(absoluteWorkDir, 'doc', language),
    csvPath: join(absoluteWorkDir, 'doc', language, 'videos.csv'),
    statePath: join(absoluteWorkDir, 'doc', language, 'upload-state.json'),
  }
}
