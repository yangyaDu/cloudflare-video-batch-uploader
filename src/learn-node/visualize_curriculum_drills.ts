import { Command } from 'commander'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// ==================== 1. 数据结构定义 ====================

export interface VisualItem {
  courseIndex: number
  courseTitle: string
  chapterIndex: string
  chapterTitle: string

  // 1. 原 NAS 目录
  nasVideoFileName: string
  nasPokerTitle: string

  // 2. temp_desc/教学章节结构_临时版.md
  structVideoTitle: string
  structDrillTitle: string

  // 3. 30-action-lines.md
  actionDrillTitle: string
  actionDrillId: string

  // 4. Manifest
  manifestVideoTitle: string
  manifestDrillTitle: string
  manifestDrillRefId: string

  // 匹配度
  similarityScore: number
}

// ==================== 2. 文本清洗与相似度计算 ====================

function cleanText(str: string): string {
  return (str || '')
    .replace(/^Travis[_-]/i, '')
    .replace(/^第?\d+[-_]/, '')
    .replace(/-\[CN\](\.mp4)?$/i, '')
    .replace(/\.mp4$/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

function calcSimilarity(a: string, b: string): number {
  const cleanA = cleanText(a)
  const cleanB = cleanText(b)
  if (!cleanA || !cleanB) return 0
  if (cleanA === cleanB) return 1.0
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 0.95

  const getBigrams = (s: string) => {
    const bg = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      bg.add(s.slice(i, i + 2))
    }
    return bg
  }

  const bgA = getBigrams(cleanA)
  const bgB = getBigrams(cleanB)
  let intersection = 0
  for (const x of bgA) {
    if (bgB.has(x)) intersection++
  }
  return (2 * intersection) / (bgA.size + bgB.size || 1)
}

function findBest<T>(
  target: string,
  items: T[],
  getter: (item: T) => string
): { item: T | null; score: number } {
  let best: T | null = null
  let maxScore = -1
  for (const it of items) {
    const text = getter(it)
    const score = calcSimilarity(target, text)
    if (score > maxScore) {
      maxScore = score
      best = it
    }
  }
  return { item: best, score: maxScore }
}

// ==================== 3. 数据加载与多源相似度匹配 ====================

export async function buildVisualData(
  manifestPath = './curriculum_manifest.json',
  chapterMdPath = './temp_desc/教学章节结构_临时版.md',
  actionLinesPath = './30-action-lines.md',
  nasRoot = '/mnt/nas/内容文档/30个视频与场景'
): Promise<VisualItem[]> {
  // A. 读取 Manifest
  const manifestFile = Bun.file(manifestPath)
  if (!(await manifestFile.exists())) {
    throw new Error(`Manifest 文件不存在: ${manifestPath}`)
  }
  const manifestCourses: any[] = JSON.parse(await manifestFile.text())

  // B. 读取 NAS 目录
  const nasItems: { folder: string; videoFile: string; pokerTitle: string }[] = []
  try {
    const folders = readdirSync(nasRoot).filter((f) => !f.startsWith('.'))
    for (const f of folders) {
      const fPath = join(nasRoot, f)
      if (!statSync(fPath).isDirectory()) continue
      const files = readdirSync(fPath)
      const videoFile =
        files.find(
          (file) => file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.mkv')
        ) || ''
      const pokerFile =
        files.find((file) => file.includes('牌局信息') || file.includes('牌局')) || ''
      let pokerTitle = ''
      if (pokerFile) {
        const lines = readFileSync(join(fPath, pokerFile), 'utf-8').split('\n')
        for (let l of lines) {
          l = l
            .trim()
            .replace(/^#+\s*/, '')
            .replace(/^-\s*/, '')
          if (l) {
            pokerTitle = l
            break
          }
        }
      }
      nasItems.push({ folder: f, videoFile, pokerTitle })
    }
  } catch (e: any) {
    console.warn(`[Warning] 读取 NAS 目录失败: ${e.message}`)
  }

  // C. 读取教学章节结构
  const chapterMd = await Bun.file(chapterMdPath).text()
  const structItems: { videoTitle: string; drillTitle: string }[] = []
  const chLines = chapterMd.split('\n')
  for (let l of chLines) {
    l = l.trim()
    const vMatch = l.match(/(?:├|│|\s)*(?:├|└)─\s*视频：(.*)/)
    const dMatch = l.match(/(?:├|│|\s)*(?:├|└)─\s*Drill：(.*)/)
    if (vMatch) {
      structItems.push({ videoTitle: vMatch[1]!.trim(), drillTitle: '' })
    }
    if (dMatch && structItems.length > 0) {
      structItems[structItems.length - 1]!.drillTitle = dMatch[1]!.trim()
    }
  }

  // D. 读取 30-action-lines.md
  const actionMd = await Bun.file(actionLinesPath).text()
  const actionItems: { title: string; name: string }[] = []
  const actLines = actionMd.split('\n')
  for (let i = 0; i < actLines.length; i++) {
    const l = actLines[i]!.trim()
    const hMatch = l.match(/^###\s+(\d+)\.\s+(.*)/)
    if (hMatch) {
      const rawTitle = hMatch[2]!.replace(/\(.*?\)$/, '').trim()
      let name = ''
      for (let j = i + 1; j < Math.min(i + 5, actLines.length); j++) {
        const nameMatch = actLines[j]!.match(/-\s+\*\*Name\*\*:\s*`([^`]+)`/)
        if (nameMatch) {
          name = nameMatch[1]!.trim()
          break
        }
      }
      actionItems.push({ title: rawTitle, name })
    }
  }

  // E. 以 Manifest 为基础，通过相似度匹配提取各源属性
  const result: VisualItem[] = []

  for (let cIdx = 0; cIdx < manifestCourses.length; cIdx++) {
    const c = manifestCourses[cIdx]
    for (let chIdx = 0; chIdx < c.chapters.length; chIdx++) {
      const ch = c.chapters[chIdx]
      const vTitle = ch.video?.title || ''

      // 1. NAS 匹配 (优先匹配视频文件名与目录名)
      const nasMatch = findBest(vTitle, nasItems, (n) => n.videoFile || n.folder)

      // 2. 教学结构匹配 (匹配 Markdown 中的视频标题)
      const structMatch = findBest(vTitle, structItems, (s) => s.videoTitle)

      // 3. 30-action 匹配 (优先通过 DrillRefId 精确索引，备用相似度匹配)
      const targetDrillRefId = ch.drill?.refId || ''
      let exactAction = actionItems.find((a) => a.name === targetDrillRefId)
      if (!exactAction) {
        const actionMatch = findBest(vTitle, actionItems, (a) => `${a.title} ${a.name}`)
        exactAction = actionMatch.item || undefined
      }

      result.push({
        courseIndex: cIdx + 1,
        courseTitle: c.courseTitle,
        chapterIndex: `${cIdx + 1}.${chIdx + 1}`,
        chapterTitle: ch.chapterTitle,

        // 1. NAS
        nasVideoFileName: nasMatch.item?.videoFile || '未找到',
        nasPokerTitle: nasMatch.item?.pokerTitle || '无',

        // 2. 章节结构
        structVideoTitle: structMatch.item?.videoTitle || '无',
        structDrillTitle: structMatch.item?.drillTitle || '无',

        // 3. 30-action
        actionDrillTitle: exactAction?.title || '无',
        actionDrillId: exactAction?.name || '无',

        // 4. Manifest
        manifestVideoTitle: ch.video?.title || '无',
        manifestDrillTitle: ch.drill?.title || '无',
        manifestDrillRefId: ch.drill?.refId || '无',

        similarityScore: Math.min(nasMatch.score, structMatch.score),
      })
    }
  }

  return result
}

// ==================== 4. 渲染视图 ====================

function renderCardView(items: VisualItem[]) {
  console.log(
    `\n====================================================================================================`
  )
  console.log(` 教学大纲与牌局信息多源交叉可视化 (共 ${items.length} 节)`)
  console.log(
    `====================================================================================================\n`
  )

  let curCourse = ''

  for (const it of items) {
    if (curCourse !== it.courseTitle) {
      curCourse = it.courseTitle
      console.log(`\n\x1b[1m\x1b[35m📦 [课程 ${it.courseIndex}] ${it.courseTitle}\x1b[0m`)
      console.log(
        `----------------------------------------------------------------------------------------------------`
      )
    }

    console.log(`\x1b[1m\x1b[34m【${it.chapterIndex}节】${it.chapterTitle}\x1b[0m`)

    console.log(`  \x1b[90m┌─ [1. 原 NAS 目录]\x1b[0m`)
    console.log(`  │  1. 视频文件名:     \x1b[32m${it.nasVideoFileName}\x1b[0m`)
    console.log(`  │  2. 牌局信息标题:   \x1b[33m${it.nasPokerTitle}\x1b[0m`)

    console.log(`  \x1b[90m├─ [2. 教学章节结构 (Markdown)]\x1b[0m`)
    console.log(`  │  3. 视频标题名:     \x1b[32m${it.structVideoTitle}\x1b[0m`)
    console.log(`  │  4. Drill标题名:    \x1b[36m${it.structDrillTitle}\x1b[0m`)

    console.log(`  \x1b[90m├─ [3. 30-action 行动线规范]\x1b[0m`)
    console.log(`  │  5. Drill标题名:    \x1b[36m${it.actionDrillTitle}\x1b[0m`)
    console.log(`  │  6. DrillId:        \x1b[1m\x1b[33m${it.actionDrillId}\x1b[0m`)

    console.log(`  \x1b[90m└─ [4. 当前课程清单 (Manifest)]\x1b[0m`)
    console.log(`     7. 视频标题:       \x1b[32m${it.manifestVideoTitle}\x1b[0m`)
    console.log(`     8. Drill标题:      \x1b[36m${it.manifestDrillTitle}\x1b[0m`)
    console.log(`     9. DrillRefId:     \x1b[1m\x1b[35m${it.manifestDrillRefId}\x1b[0m`)
    console.log(``)
  }
}

function renderMarkdownReport(items: VisualItem[]): string {
  const lines: string[] = []
  lines.push(`# 教学大纲与牌局信息多源交叉可视化报告\n`)
  lines.push(
    `> 生成时间: ${new Date().toLocaleString()} | 涵盖 ${items.length} 个教学章节与牌局场景\n`
  )

  let curCourse = ''

  for (const it of items) {
    if (curCourse !== it.courseTitle) {
      curCourse = it.courseTitle
      lines.push(`\n## 📦 课程 ${it.courseIndex}: ${it.courseTitle}\n`)
    }

    lines.push(`### 📂 章节 ${it.chapterIndex}: ${it.chapterTitle}\n`)
    lines.push(`| 数据源 | 属性 | 值 |`)
    lines.push(`| :--- | :--- | :--- |`)
    lines.push(`| **原 NAS 目录** | 1. 视频文件名 | \`${it.nasVideoFileName}\` |`)
    lines.push(`| | 2. 牌局信息标题 | **${it.nasPokerTitle}** |`)
    lines.push(`| **教学章节结构 (MD)** | 3. 视频标题名 | \`${it.structVideoTitle}\` |`)
    lines.push(`| | 4. Drill标题名 | \`${it.structDrillTitle}\` |`)
    lines.push(`| **30-action 规范** | 5. Drill标题名 | \`${it.actionDrillTitle}\` |`)
    lines.push(`| | 6. DrillId | \`${it.actionDrillId}\` |`)
    lines.push(`| **当前 Manifest** | 7. 视频标题 | \`${it.manifestVideoTitle}\` |`)
    lines.push(`| | 8. Drill标题 | \`${it.manifestDrillTitle}\` |`)
    lines.push(`| | 9. DrillRefId | **\`${it.manifestDrillRefId}\`** |\n`)
  }

  return lines.join('\n')
}

// ==================== 5. 主执行入口 ====================

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/visualize_curriculum_drills.ts')
    .description('基于名字相似度对齐 NAS、章节结构、30-action 及 Manifest 的 9 大核心属性')
    .option('-m, --manifest <path>', '课程清单 JSON 文件路径', './curriculum_manifest.json')
    .option(
      '-s, --chapter-md <path>',
      '章节结构 markdown 文件路径',
      './temp_desc/教学章节结构_临时版.md'
    )
    .option('-a, --action-md <path>', '行动线文档路径', './30-action-lines.md')
    .option('-n, --nas-root <path>', 'NAS 根目录', '/mnt/nas/内容文档/30个视频与场景')
    .option('-c, --course <number>', '仅查看指定课程编号 (1~8)')
    .option('-k, --keyword <string>', '按关键字过滤')
    .option(
      '-o, --export-md <path>',
      '导出完整 Markdown 对比报告文件',
      './curriculum_visualization_report.md'
    )
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明')

  await program.parseAsync(process.argv)
  const options = program.opts()

  let items = await buildVisualData(
    options.manifest,
    options.chapterMd,
    options.actionMd,
    options.nasRoot
  )

  if (options.course) {
    const cNum = Number(options.course)
    items = items.filter((i) => i.courseIndex === cNum)
  }

  if (options.keyword) {
    const kw = options.keyword.toLowerCase()
    items = items.filter(
      (i) =>
        i.chapterTitle.toLowerCase().includes(kw) ||
        i.manifestVideoTitle.toLowerCase().includes(kw) ||
        i.manifestDrillTitle.toLowerCase().includes(kw) ||
        i.manifestDrillRefId.toLowerCase().includes(kw) ||
        i.nasPokerTitle.toLowerCase().includes(kw)
    )
  }

  // 终端渲染
  renderCardView(items)

  // 导出 Markdown 报告
  if (options.exportMd) {
    const mdContent = renderMarkdownReport(items)
    await Bun.write(options.exportMd, mdContent)
    console.log(
      `\n\x1b[32m[Success]\x1b[0m 完整 9 维对比 Markdown 报告已导出至: \x1b[36m${options.exportMd}\x1b[0m\n`
    )
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
