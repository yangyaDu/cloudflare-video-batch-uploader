import { readFile } from 'node:fs/promises'

import { parse } from 'csv-parse/sync'

import { videoTitle } from './fs-utils'

const TAG_COLUMN = '介绍视频标签'
const INTRO_VIDEO_COLUMN = '介绍视频EN'
const VULNERABILITY_VIDEO_COLUMN = '漏洞视频EN'

export interface VideoTagAssignment {
  configuredName: string
  primaryTag: string
  rowNumber: number
}

function normalizeVideoName(value: string): string {
  return videoTitle(value.trim().replaceAll('\\', '/')).trim().normalize('NFC').toLowerCase()
}

export class VideoTagConfig {
  constructor(private readonly assignments: ReadonlyMap<string, VideoTagAssignment>) {}

  get(videoTitle: string): VideoTagAssignment | undefined {
    return this.assignments.get(normalizeVideoName(videoTitle))
  }

  entries(): IterableIterator<[string, VideoTagAssignment]> {
    return this.assignments.entries()
  }

  /**
   * 校验本地视频与配置一一对应，并返回以实际视频标题为键的标签。
   */
  matchVideoTitles(videoTitles: readonly string[]): Map<string, string> {
    const matchedKeys = new Set<string>()
    const primaryTags = new Map<string, string>()
    const unknownTitles: string[] = []

    for (const title of videoTitles) {
      const key = normalizeVideoName(title)
      if (matchedKeys.has(key)) {
        throw new Error(`本地视频名称重复，无法按配置唯一匹配: "${title}"`)
      }
      matchedKeys.add(key)

      const assignment = this.assignments.get(key)
      if (!assignment) {
        unknownTitles.push(title)
        continue
      }
      primaryTags.set(title, assignment.primaryTag)
    }

    if (unknownTitles.length > 0) {
      throw new Error(`本地视频未出现在配置 CSV: ${unknownTitles.join('、')}`)
    }

    const missingFiles = [...this.assignments.entries()]
      .filter(([key]) => !matchedKeys.has(key))
      .map(([, assignment]) => assignment.configuredName)
    if (missingFiles.length > 0) {
      throw new Error(`配置 CSV 中的视频文件不存在: ${missingFiles.join('、')}`)
    }

    return primaryTags
  }

  get size(): number {
    return this.assignments.size
  }
}

/**
 * 读取知识点配置 CSV；同一行已填写的介绍视频和漏洞视频共享“介绍视频标签”。
 */
export async function readVideoTagConfig(path: string): Promise<VideoTagConfig> {
  const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  const records = parse(content, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
  }) as string[][]

  const headerIndex = records.findIndex(
    (record) =>
      record.includes(TAG_COLUMN) &&
      (record.includes(INTRO_VIDEO_COLUMN) || record.includes(VULNERABILITY_VIDEO_COLUMN))
  )
  if (headerIndex < 0) {
    throw new Error(
      `配置 CSV 缺少表头: ${TAG_COLUMN}，以及 ${INTRO_VIDEO_COLUMN}/${VULNERABILITY_VIDEO_COLUMN} 至少一列`
    )
  }

  const headers = records[headerIndex]!
  const tagIndex = headers.indexOf(TAG_COLUMN)
  const introIndex = headers.indexOf(INTRO_VIDEO_COLUMN)
  const vulnerabilityIndex = headers.indexOf(VULNERABILITY_VIDEO_COLUMN)
  const assignments = new Map<string, VideoTagAssignment>()

  for (let index = headerIndex + 1; index < records.length; index += 1) {
    const record = records[index]!
    const rowNumber = index + 1
    const primaryTag = (record[tagIndex] ?? '').trim()
    const introVideo = introIndex < 0 ? '' : (record[introIndex] ?? '').trim()
    const vulnerabilityVideo =
      vulnerabilityIndex < 0 ? '' : (record[vulnerabilityIndex] ?? '').trim()

    // 未配置英文视频的知识点不属于本次上传批次。
    if (!introVideo && !vulnerabilityVideo) continue
    if (!primaryTag) {
      throw new Error(`配置 CSV 第 ${rowNumber} 行填写英文视频时必须填写介绍视频标签`)
    }

    for (const configuredName of [introVideo, vulnerabilityVideo].filter(Boolean)) {
      const key = normalizeVideoName(configuredName)
      if (!key) throw new Error(`配置 CSV 第 ${rowNumber} 行包含空的视频名称`)

      const previous = assignments.get(key)
      if (previous) {
        throw new Error(
          `配置 CSV 的视频名称重复: "${configuredName}"（第 ${previous.rowNumber}、${rowNumber} 行）`
        )
      }
      assignments.set(key, { configuredName, primaryTag, rowNumber })
    }
  }

  if (assignments.size === 0) {
    throw new Error('配置 CSV 中没有已填写的介绍视频EN / 漏洞视频EN')
  }

  return new VideoTagConfig(assignments)
}
