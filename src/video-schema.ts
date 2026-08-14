export const VIDEO_COLUMNS = [
  'language',
  'difficulty',
  'title',
  'titleDescription',
  'coverId',
  'coverUrl',
  'primaryTags',
  'secondaryTags',
  'videoUid',
] as const

export type VideoColumn = (typeof VIDEO_COLUMNS)[number]
export type VideoCsvRow = Record<VideoColumn, string>

/**
 * 与 /api/adminimda/video/add 的请求体一一对应。
 * 视频 UID 和封面字段由上传流程回填，其他默认值按批量导入约定生成。
 */
export function createDefaultVideoRow(title: string, language: 'zh' | 'en'): VideoCsvRow {
  return {
    language,
    difficulty: '10',
    title,
    titleDescription: '',
    coverId: '',
    coverUrl: '',
    primaryTags: '[]',
    secondaryTags: '[]',
    videoUid: '',
  }
}

export function assertVideoHeaders(headers: readonly string[]): void {
  const expected = VIDEO_COLUMNS.join(',')
  const actual = headers.join(',')
  if (actual !== expected) {
    throw new Error(`CSV 表头不匹配。\n期望: ${expected}\n实际: ${actual}`)
  }
}
