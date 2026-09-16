import { Command } from 'commander'

// ==================== 1. 类型定义 ====================

export interface OldChapter {
  chapterTitle: string
  video: { title: string; refId: string } | null
  drill: { title: string; refId: string } | null
}

export interface OldCourse {
  courseTitle: string
  chapters: OldChapter[]
}

export interface NewSubChapter {
  subChapterTitle: string
  video: { title: string; refId: string } | null
  drill: { title: string; refId: string } | null
}

export interface NewChapter {
  chapterTitle: string
  subChapters: NewSubChapter[]
}

export interface NewSingleCourseManifest {
  courseTitle: string
  chapters: NewChapter[]
}

// ==================== 2. 转换核心逻辑 ====================

export function transformToSingleCourse(
  oldManifest: OldCourse[],
  courseTitle = '核心决策训练'
): NewSingleCourseManifest[] {
  const newChapters: NewChapter[] = oldManifest.map((oldCourse) => {
    return {
      chapterTitle: oldCourse.courseTitle,
      subChapters: oldCourse.chapters.map((ch) => ({
        subChapterTitle: ch.chapterTitle,
        video: ch.video ? { ...ch.video } : null,
        drill: ch.drill ? { ...ch.drill } : null,
      })),
    }
  })

  return [
    {
      courseTitle,
      chapters: newChapters,
    },
  ]
}

// ==================== 3. 主执行入口 ====================

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/restructure_manifest_to_single_course.ts')
    .description(
      '确定性重构 curriculum_manifest.json 为单一大课程层级 (1 Course -> 8 Chapters -> SubChapters -> Video & Drill)'
    )
    .option('-i, --input <path>', '输入 manifest 文件路径', './curriculum_manifest.json')
    .option('-o, --output <path>', '输出 manifest 文件路径', './curriculum_manifest.json')
    .option('-b, --backup <path>', '备份原文件路径', './curriculum_manifest.backup.json')
    .option('-t, --title <string>', '单门课程名称', '核心决策训练')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明')

  await program.parseAsync(process.argv)
  const options = program.opts()

  const inputFile = Bun.file(options.input)
  if (!(await inputFile.exists())) {
    console.error(`\x1b[31m[Error]\x1b[0m 输入文件不存在: ${options.input}`)
    process.exit(1)
  }

  const rawContent = await inputFile.text()
  const oldData: OldCourse[] = JSON.parse(rawContent)

  console.log(`\n================ 重构课程清单层级结构 ================\n`)
  console.log(`原文件:     ${options.input}`)
  console.log(`原课程总数: ${oldData.length} 个 (将转换为 8 个 Chapter)`)

  let originalSubChapterCount = 0
  for (const c of oldData) {
    originalSubChapterCount += c.chapters.length
  }
  console.log(`原章节总数: ${originalSubChapterCount} 个 (已确认排除 5.2 节)`)

  // 1. 备份原文件
  if (options.backup) {
    await Bun.write(options.backup, rawContent)
    console.log(`\x1b[32m[Backup]\x1b[0m 原文件已备份至: \x1b[36m${options.backup}\x1b[0m`)
  }

  // 2. 执行确定性结构转换
  const newManifest = transformToSingleCourse(oldData, options.title)

  // 3. 统计转换后结果
  const singleCourse = newManifest[0]
  if (!singleCourse) throw new Error('转换结果缺少课程')
  let totalSubChapters = 0
  let totalVideos = 0
  let totalDrills = 0

  for (const ch of singleCourse.chapters) {
    totalSubChapters += ch.subChapters.length
    for (const sub of ch.subChapters) {
      if (sub.video) totalVideos++
      if (sub.drill) totalDrills++
    }
  }

  // 4. 写入新结构
  await Bun.write(options.output, JSON.stringify(newManifest, null, 2))

  console.log(`\n\x1b[32m[Success]\x1b[0m 重构完成并写入: \x1b[36m${options.output}\x1b[0m`)
  console.log(`\n新层级结构明细:`)
  console.log(`📦 [Level 1] Course:      \x1b[35m${singleCourse.courseTitle}\x1b[0m (1 个)`)
  console.log(
    ` ├── 📂 [Level 2] Chapters:    \x1b[34m${singleCourse.chapters.length}\x1b[0m 个大章节`
  )
  console.log(` │    └── 📑 [Level 3] SubChapters: \x1b[36m${totalSubChapters}\x1b[0m 个子章节`)
  console.log(` │         ├── 🎬 [Level 4] Video:  \x1b[32m${totalVideos}\x1b[0m 个`)
  console.log(` │         └── 🎯 [Level 4] Drill:  \x1b[33m${totalDrills}\x1b[0m 个\n`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
