import { Command } from 'commander'
import { atomicWrite } from '../fs-utils'

interface SqlVideo {
  title: string
  videoUid: string
  refId: string
  status: number
}

interface DrillConfig {
  drill_id: number
  drill_public_id: string
  drill_name?: string
}

interface CurriculumLesson {
  lessonNumber: number
  subChapterTitle: string
  videoTitle: string
  drillTitle: string
}

interface CurriculumStructure {
  courseTitle: string
  chapters: Array<{
    chapterTitle: string
    lessons: CurriculumLesson[]
  }>
}

function unquoteSqlValue(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === 'NULL') return null
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return trimmed
  return trimmed.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'")
}

function splitSqlValues(values: string): string[] {
  const result: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < values.length; index++) {
    const char = values[index]
    if (char === "'") {
      if (quoted && values[index + 1] === "'") {
        current += "''"
        index++
        continue
      }
      quoted = !quoted
      current += char
      continue
    }
    if (char === ',' && !quoted) {
      result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  result.push(current.trim())
  return result
}

export function parseVideoInserts(sql: string): SqlVideo[] {
  const videos: SqlVideo[] = []
  const insertPattern = /INSERT INTO `tb_video` \(([^\n]+)\) VALUES \(([^\n]+)\);/g

  for (const match of sql.matchAll(insertPattern)) {
    const columnsText = match[1]
    const valuesText = match[2]
    if (!columnsText || !valuesText) {
      throw new Error('无法解析 tb_video INSERT')
    }
    const columns = columnsText.split(',').map((column) => column.trim().replaceAll('`', ''))
    const values = splitSqlValues(valuesText).map(unquoteSqlValue)
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
    if (!row.title || !row.video_uid || !row.uk_cross_id || row.status === undefined) {
      throw new Error('tb_video INSERT 缺少 title、video_uid、uk_cross_id 或 status')
    }
    videos.push({
      title: row.title,
      videoUid: row.video_uid,
      refId: row.uk_cross_id,
      status: Number(row.status),
    })
  }
  return videos
}

function uniqueMap<T>(items: T[], keyOf: (item: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of items) {
    const key = keyOf(item)
    if (result.has(key)) throw new Error(`${label} 存在重复键: ${key}`)
    result.set(key, item)
  }
  return result
}

async function main() {
  const program = new Command()
    .name('bun src/learn-node/extract_curriculum_resources.ts')
    .description('按已确认的二期章节结构，关联视频 SQL 与 Drill 配表并生成课程 Manifest')
    .option(
      '--sql <path>',
      '包含 tb_video INSERT 的 SQL',
      './workdir/learn-node/export_curriculum_pure_numeric.sql'
    )
    .option(
      '--drill-config <path>',
      'drill_scenario_config.json 路径',
      '../backend-framework/src/datasheet/data/drill_scenario_config.json'
    )
    .option(
      '--structure <path>',
      '已确认的二期章节结构 JSON',
      './docs/examples/second-phase-curriculum-structure.json'
    )
    .option('--min-drill-id <id>', '新增 Drill 起始 ID', (value) => Number(value), 47)
    .option('--course-node-uuid <uuid>', '已有课程根节点 UUID', '01a047d4b334709b82b298352a678f90')
    .option(
      '--output <path>',
      '可传给 learn:build 的 Manifest',
      './workdir/learn-node/0914-second-phase-manifest.json'
    )
    .option(
      '--audit-output <path>',
      '提取审计报告',
      './workdir/learn-node/0914-second-phase-audit.json'
    )

  await program.parseAsync(process.argv)
  const options = program.opts()
  const videos = parseVideoInserts(await Bun.file(String(options.sql)).text())
  const allDrills = (await Bun.file(String(options.drillConfig)).json()) as DrillConfig[]
  const newDrills = allDrills.filter((drill) => drill.drill_id >= Number(options.minDrillId))
  const structure = (await Bun.file(String(options.structure)).json()) as CurriculumStructure
  const videoByTitle = uniqueMap(videos, (video) => video.title, 'SQL 视频标题')
  const drillByPublicId = uniqueMap(newDrills, (drill) => drill.drill_public_id, 'Drill public ID')
  const usedVideoTitles = new Set<string>()
  const usedDrillPublicIds = new Set<string>()

  const chapters = structure.chapters.map((chapter) => ({
    chapterTitle: chapter.chapterTitle,
    subChapters: chapter.lessons.map((lesson) => {
      const video = videoByTitle.get(lesson.videoTitle)
      if (!video) throw new Error(`SQL 中找不到视频: ${lesson.videoTitle}`)
      const drillPublicId = `lesson_0914_${lesson.lessonNumber}`
      const drill = drillByPublicId.get(drillPublicId)
      if (!drill) throw new Error(`Drill 配表中找不到: ${drillPublicId}`)
      if (usedVideoTitles.has(video.title)) throw new Error(`视频被重复绑定: ${video.title}`)
      if (usedDrillPublicIds.has(drillPublicId))
        throw new Error(`Drill 被重复绑定: ${drillPublicId}`)
      usedVideoTitles.add(video.title)
      usedDrillPublicIds.add(drillPublicId)

      return {
        subChapterTitle: lesson.subChapterTitle,
        video: {
          title: video.title,
          videoUid: video.videoUid,
          refId: video.refId,
        },
        drill: {
          title: lesson.drillTitle,
          refId: drill.drill_public_id,
        },
      }
    }),
  }))

  const unusedVideos = videos.filter((video) => !usedVideoTitles.has(video.title))
  if (unusedVideos.length) {
    throw new Error(
      `存在未纳入章节结构的视频: ${unusedVideos.map((video) => video.title).join('、')}`
    )
  }

  const manifest = [
    {
      courseTitle: structure.courseTitle,
      nodeUuid: String(options.courseNodeUuid),
      chapters,
    },
  ]
  const unusedNewDrills = newDrills
    .filter((drill) => !usedDrillPublicIds.has(drill.drill_public_id))
    .map((drill) => ({
      drillId: drill.drill_id,
      refId: drill.drill_public_id,
      drillName: drill.drill_name ?? null,
    }))
  const unpublishedVideos = videos
    .filter((video) => video.status !== 1)
    .map((video) => ({ title: video.title, refId: video.refId, status: video.status }))
  const audit = {
    sources: {
      videoSql: String(options.sql),
      drillConfig: String(options.drillConfig),
      curriculumStructure: String(options.structure),
    },
    summary: {
      chapterCount: chapters.length,
      subChapterCount: chapters.reduce((count, chapter) => count + chapter.subChapters.length, 0),
      videoCount: usedVideoTitles.size,
      drillCount: usedDrillPublicIds.size,
      unusedNewDrillCount: unusedNewDrills.length,
      unpublishedVideoCount: unpublishedVideos.length,
    },
    unusedNewDrills,
    unpublishedVideos,
    warnings: [
      '未使用的新增 Drill 不属于本次给出的第 9–14 章，不表示缺少视频。',
      'status 不为 1 的视频可以绑定到草稿节点，但发布课程树前必须先发布视频。',
    ],
  }

  await atomicWrite(String(options.output), `${JSON.stringify(manifest, null, 2)}\n`)
  await atomicWrite(String(options.auditOutput), `${JSON.stringify(audit, null, 2)}\n`)
  console.log(
    `已生成 ${audit.summary.chapterCount} 个大章节、${audit.summary.subChapterCount} 个小节、${audit.summary.videoCount} 个视频和 ${audit.summary.drillCount} 个 Drill`
  )
  console.log(`未纳入本期课程的新增 Drill: ${unusedNewDrills.map((item) => item.refId).join(', ')}`)
  console.log(`Manifest: ${options.output}`)
  console.log(`审计报告: ${options.auditOutput}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
