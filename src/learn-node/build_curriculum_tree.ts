import { Command } from 'commander'
import { atomicWrite } from '../fs-utils'
import { requestAdmin as requestSuperAdmin } from './client'

// ==================== 1. 数据模型与接口定义 ====================

export interface VideoManifestNode {
  title: string
  refId: string // 对应 tb_video 的 crossId (Snowflake ID)
  nodeUuid?: string
}

export interface DrillManifestNode {
  title: string
  refId: string // 对应 30-action-lines.md 中的场景 Name
  nodeUuid?: string
}

export interface SubChapterManifestNode {
  subChapterTitle: string
  nodeUuid?: string
  video: VideoManifestNode | null
  drill: DrillManifestNode | null
}

export interface ChapterManifestNode {
  chapterTitle: string
  nodeUuid?: string
  subChapters?: SubChapterManifestNode[]
  // 兼容扁平结构
  video?: VideoManifestNode | null
  drill?: DrillManifestNode | null
}

export interface CourseManifestNode {
  courseTitle: string
  nodeUuid?: string
  chapters: ChapterManifestNode[]
}

export interface CreateNodeRsp {
  nodeUuid: string
  parentNodeUuid: string | null
  status: string
  level: number
  createdAt: number
}

// ==================== 2. 节点创建与资源绑定 API ====================

async function createNode(
  type: 'course' | 'chapter' | 'video' | 'drill',
  title: string,
  parentNodeUuid: string | null = null,
  existingNodeUuid?: string
): Promise<string> {
  if (existingNodeUuid) return existingNodeUuid
  const rsp = await requestSuperAdmin<CreateNodeRsp>('POST', '/api/adminimda/learn/node/create', {
    body: {
      type,
      title,
      parentNodeUuid,
    },
  })
  if (!rsp.nodeUuid) throw new Error('创建节点响应缺少 nodeUuid')
  return rsp.nodeUuid
}

async function bindNodeRefId(nodeUuid: string, refId: string): Promise<void> {
  await requestSuperAdmin('POST', '/api/adminimda/learn/node/update', {
    body: {
      nodeUuid,
      refId,
    },
  })
}

// ==================== 3. 主执行入口 ====================

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/build_curriculum_tree.ts')
    .description(
      '根据课程清单 (Manifest) 批量创建教学节点树 (支持 4 级: Course -> Chapter -> SubChapter -> Video & Drill)'
    )
    .option('-m, --manifest <path>', '课程清单 JSON 文件路径', './curriculum_manifest.json')
    .option('-o, --output <path>', '执行结果输出文件路径', './curriculum_tree_result.json')
    .option('--dry-run', '仅预览将要构建的节点树结构，不实际请求 API', false)
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明')

  await program.parseAsync(process.argv)
  const options = program.opts()

  const manifestPath = String(options.manifest)
  const manifestFile = Bun.file(manifestPath)
  if (!(await manifestFile.exists())) {
    console.error(`\x1b[31m[Error]\x1b[0m 清单文件不存在: ${manifestPath}`)
    process.exit(1)
  }

  let courses: CourseManifestNode[] = []
  try {
    courses = JSON.parse(await manifestFile.text())
  } catch (e: any) {
    console.error(`解析清单文件失败: ${manifestPath}`, e)
    process.exit(1)
  }

  console.log(`\n================ 教学内容节点树自动化构建 ================\n`)
  console.log(`清单文件: ${manifestPath}`)
  console.log(
    `模式:     ${options.dryRun ? '\x1b[33m[Dry Run 预览模式]\x1b[0m' : '\x1b[32m[实际创建]\x1b[0m'}`
  )

  let totalChapters = 0
  let totalSubChapters = 0
  let totalVideos = 0
  let totalDrills = 0
  let filledVideoRefIds = 0
  let filledDrillRefIds = 0

  for (const c of courses) {
    totalChapters += c.chapters.length
    for (const ch of c.chapters) {
      if (ch.subChapters && ch.subChapters.length > 0) {
        totalSubChapters += ch.subChapters.length
        for (const sub of ch.subChapters) {
          if (sub.video) {
            totalVideos++
            if (sub.video.refId) filledVideoRefIds++
          }
          if (sub.drill) {
            totalDrills++
            if (sub.drill.refId) filledDrillRefIds++
          }
        }
      } else {
        if (ch.video) {
          totalVideos++
          if (ch.video.refId) filledVideoRefIds++
        }
        if (ch.drill) {
          totalDrills++
          if (ch.drill.refId) filledDrillRefIds++
        }
      }
    }
  }

  console.log(`\n清单统计:`)
  console.log(`- Course 课程根节点:     \x1b[35m${courses.length}\x1b[0m 个`)
  console.log(`- Chapter 大章节节点:    \x1b[34m${totalChapters}\x1b[0m 个`)
  if (totalSubChapters > 0) {
    console.log(`- SubChapter 子章节节点: \x1b[36m${totalSubChapters}\x1b[0m 个`)
  }
  console.log(
    `- Video 视频叶子节点:    \x1b[32m${totalVideos}\x1b[0m 个 (已绑定 RefId: ${filledVideoRefIds}/${totalVideos})`
  )
  console.log(
    `- Drill 练习叶子节点:    \x1b[33m${totalDrills}\x1b[0m 个 (已填入 RefId: ${filledDrillRefIds}/${totalDrills})`
  )

  // 预览模式
  if (options.dryRun) {
    console.log(`\n==================== 节点树预览 ====================`)
    for (const [cIdx, c] of courses.entries()) {
      console.log(`\n📦 [Level 1 - Course ${cIdx + 1}] ${c.courseTitle}`)
      for (const [chIdx, ch] of c.chapters.entries()) {
        console.log(`  ├── 📂 [Level 2 - Chapter ${cIdx + 1}.${chIdx + 1}] ${ch.chapterTitle}`)
        if (ch.subChapters && ch.subChapters.length > 0) {
          for (const [sIdx, sub] of ch.subChapters.entries()) {
            console.log(
              `  │    ├── 📑 [Level 3 - SubChapter ${chIdx + 1}.${sIdx + 1}] ${sub.subChapterTitle}`
            )
            if (sub.video) {
              console.log(
                `  │    │    ├── 🎬 [Level 4 - Video] ${sub.video.title} \x1b[90m(RefId: ${sub.video.refId || '未填'})\x1b[0m`
              )
            }
            if (sub.drill) {
              console.log(
                `  │    │    └── 🎯 [Level 4 - Drill] ${sub.drill.title} \x1b[36m(RefId: ${sub.drill.refId || '未填'})\x1b[0m`
              )
            }
          }
        } else {
          if (ch.video) {
            console.log(
              `  │    ├── 🎬 [Video] ${ch.video.title} \x1b[90m(RefId: ${ch.video.refId || '未填'})\x1b[0m`
            )
          }
          if (ch.drill) {
            console.log(
              `  │    └── 🎯 [Drill] ${ch.drill.title} \x1b[36m(RefId: ${ch.drill.refId || '未填'})\x1b[0m`
            )
          }
        }
      }
    }
    console.log(`\n====================================================\n`)
    console.log(`[Dry Run] 预览结束。若确认无误，可去掉 --dry-run 参数执行实际创建。`)
    return
  }

  // 实际创建
  console.log(`\n开始调用 API 批量创建节点树...\n`)
  const startTime = Date.now()
  const checkpoint = () => atomicWrite(String(options.output), JSON.stringify(courses, null, 2))

  for (const [cIdx, course] of courses.entries()) {
    console.log(`------------------------------------------------------------`)
    console.log(
      `\x1b[35m[Course ${cIdx + 1}/${courses.length}]\x1b[0m 正在创建课程: \x1b[1m${course.courseTitle}\x1b[0m`
    )

    const courseNodeUuid = await createNode('course', course.courseTitle, null, course.nodeUuid)
    course.nodeUuid = courseNodeUuid
    await checkpoint()
    console.log(`  └─ UUID: \x1b[36m${courseNodeUuid}\x1b[0m`)

    for (const [chIdx, chapter] of course.chapters.entries()) {
      console.log(
        `  \x1b[34m[Chapter ${chIdx + 1}/${course.chapters.length}]\x1b[0m 创建章节: ${chapter.chapterTitle}`
      )

      const chapterNodeUuid = await createNode(
        'chapter',
        chapter.chapterTitle,
        courseNodeUuid,
        chapter.nodeUuid
      )
      chapter.nodeUuid = chapterNodeUuid
      await checkpoint()

      // 4 级架构：如果包含 subChapters
      if (chapter.subChapters && chapter.subChapters.length > 0) {
        for (const [sIdx, sub] of chapter.subChapters.entries()) {
          console.log(
            `    \x1b[36m[SubChapter ${sIdx + 1}/${chapter.subChapters.length}]\x1b[0m 创建子章节: ${sub.subChapterTitle}`
          )
          const subNodeUuid = await createNode(
            'chapter',
            sub.subChapterTitle,
            chapterNodeUuid,
            sub.nodeUuid
          )
          sub.nodeUuid = subNodeUuid
          await checkpoint()

          // 1. 创建 Video 节点 (Level 4)
          if (sub.video) {
            const videoNodeUuid = await createNode(
              'video',
              sub.video.title,
              subNodeUuid,
              sub.video.nodeUuid
            )
            sub.video.nodeUuid = videoNodeUuid
            await checkpoint()
            if (sub.video.refId) {
              try {
                await bindNodeRefId(videoNodeUuid, sub.video.refId)
                console.log(
                  `      ├─ 🎬 [Video] ${sub.video.title} (绑定 Video RefId: ${sub.video.refId})`
                )
              } catch (e: any) {
                console.warn(`      ├─ 🎬 [Video] ${sub.video.title} (绑定失败: ${e.message})`)
                process.exitCode = 1
              }
            }
          }

          // 2. 创建 Drill 节点 (Level 4)
          if (sub.drill) {
            const drillNodeUuid = await createNode(
              'drill',
              sub.drill.title,
              subNodeUuid,
              sub.drill.nodeUuid
            )
            sub.drill.nodeUuid = drillNodeUuid
            await checkpoint()
            if (sub.drill.refId) {
              try {
                await bindNodeRefId(drillNodeUuid, sub.drill.refId)
                console.log(
                  `      └─ 🎯 [Drill] ${sub.drill.title} (绑定 Drill RefId: ${sub.drill.refId})`
                )
              } catch (e: any) {
                console.warn(
                  `      └─ 🎯 [Drill] ${sub.drill.title} (待写入配表: ${sub.drill.refId})`
                )
                process.exitCode = 1
              }
            }
          }
        }
      } else {
        // 3 级兼容结构
        if (chapter.video) {
          const videoNodeUuid = await createNode(
            'video',
            chapter.video.title,
            chapterNodeUuid,
            chapter.video.nodeUuid
          )
          chapter.video.nodeUuid = videoNodeUuid
          await checkpoint()
          if (chapter.video.refId) {
            await bindNodeRefId(videoNodeUuid, chapter.video.refId)
            console.log(
              `    ├─ 🎬 [Video] ${chapter.video.title} (绑定 Video RefId: ${chapter.video.refId})`
            )
          }
        }
        if (chapter.drill) {
          const drillNodeUuid = await createNode(
            'drill',
            chapter.drill.title,
            chapterNodeUuid,
            chapter.drill.nodeUuid
          )
          chapter.drill.nodeUuid = drillNodeUuid
          await checkpoint()
          if (chapter.drill.refId) {
            await bindNodeRefId(drillNodeUuid, chapter.drill.refId)
            console.log(
              `    └─ 🎯 [Drill] ${chapter.drill.title} (绑定 Drill RefId: ${chapter.drill.refId})`
            )
          }
        }
      }
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n==================== 节点树创建完成 ====================`)
  console.log(`总耗时: ${totalDuration}s`)
  console.log(
    `已成功创建: ${courses.length} 个 Course, ${totalChapters} 个 Chapter, ${totalSubChapters} 个 SubChapter, ${totalVideos} 个 Video, ${totalDrills} 个 Drill`
  )

  const outputPath = options.output || './curriculum_tree_result.json'
  await Bun.write(outputPath, JSON.stringify(courses, null, 2))
  console.log(`完整结构与生成的 UUID 已保存至: \x1b[36m${outputPath}\x1b[0m\n`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
