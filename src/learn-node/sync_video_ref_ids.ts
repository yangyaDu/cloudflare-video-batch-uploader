import { Command } from 'commander'
import { readVideoCsv } from '../video/csv-store'
import { getVideoList, type AdminVideoItem } from './video-client'

// ==================== 1. 辅助函数：标准化标题 ====================

function normalizeTitle(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/\s*\[\s*\d+\s*\]\s*$/, '') // 去除末尾的 [1], [2] 等序号后缀
    .replace(/\s+/g, '')
}

// ==================== 2. 主逻辑：基于 Admin HTTP API 与 videoUid 同步 ====================

interface VideoManifestEntry {
  title: string
  videoUid?: string
  refId: string
}

async function syncManifestByVideoUid(
  manifestPath = './curriculum_manifest.json',
  uploadResultsPath = './upload_results.json',
  dryRun = false
) {
  console.log(
    `\n================ 基于 Admin API (videoUid) 纯 HTTP 同步 Manifest RefId ================\n`
  )
  console.log(`Manifest 路径:       \x1b[36m${manifestPath}\x1b[0m`)
  console.log(`Upload Results 路径: \x1b[36m${uploadResultsPath}\x1b[0m`)
  console.log(
    `运行模式:            ${dryRun ? '\x1b[33m[Dry Run 预览模式]\x1b[0m' : '\x1b[32m[实际更新文件]\x1b[0m'}`
  )

  // 1. 通过 Admin HTTP API 获取后端所有视频（无需直接连接数据库）
  console.log(`\n正在请求 Admin API (GET /api/adminimda/video/list)...`)
  const uidToApiVideo = new Map<string, AdminVideoItem>()
  try {
    const listRsp = await getVideoList({ pageSize: 100 })
    const videos = listRsp.data || []
    console.log(
      `从 Admin API 获取到有效视频: \x1b[36m${videos.length}\x1b[0m 条 (总数: ${listRsp.count})`
    )
    for (const v of videos) {
      if (v.videoUid && v.videoUid.trim() !== '') {
        uidToApiVideo.set(v.videoUid.trim(), v)
      }
    }
  } catch (e: any) {
    console.error(`\x1b[31m[Error]\x1b[0m 调用 Admin API 获取视频列表失败: ${e.message}`)
    process.exit(1)
  }

  // 2. 从 upload_results.json 加载 videoUid 关联（用于补全 Manifest 中未显式填写的 videoUid）
  const titleToUidFromUpload = new Map<string, string>()
  const normalizedTitleToUid = new Map<string, string>()

  const uploadFile = Bun.file(uploadResultsPath)
  if (await uploadFile.exists()) {
    try {
      const uploadList: any[] = uploadResultsPath.toLowerCase().endsWith('.csv')
        ? await readVideoCsv(uploadResultsPath)
        : JSON.parse(await uploadFile.text())
      for (const item of uploadList) {
        if (item.title && item.videoUid) {
          const rawTitle = item.title.trim()
          const uid = item.videoUid.trim()
          titleToUidFromUpload.set(rawTitle, uid)
          normalizedTitleToUid.set(normalizeTitle(rawTitle), uid)
        }
      }
      console.log(
        `从 ${uploadResultsPath} 加载了 \x1b[36m${titleToUidFromUpload.size}\x1b[0m 个 videoUid 关联`
      )
    } catch (e: any) {
      console.warn(`读取 ${uploadResultsPath} 失败: ${e.message}`)
    }
  }

  // 3. 读取 Manifest
  const manifestFile = Bun.file(manifestPath)
  if (!(await manifestFile.exists())) {
    console.error(`\x1b[31m[Error]\x1b[0m Manifest 文件不存在: ${manifestPath}`)
    process.exit(1)
  }

  const manifest: any[] = JSON.parse(await manifestFile.text())

  let totalVideos = 0
  let updatedCount = 0
  let matchedCount = 0
  let missingUidCount = 0

  // 辅助处理单个视频条目
  const processVideoEntry = (videoEntry: VideoManifestEntry, sectionTitle: string) => {
    totalVideos++

    // 优先使用 entry 自带的 videoUid，若无则从 upload_results.json 中检索（支持归一化模糊匹配）
    let targetUid = videoEntry.videoUid?.trim()
    if (!targetUid) {
      targetUid =
        titleToUidFromUpload.get(videoEntry.title.trim()) ||
        normalizedTitleToUid.get(normalizeTitle(videoEntry.title))
      if (targetUid) {
        videoEntry.videoUid = targetUid // 固化到 Manifest
      }
    }

    if (!targetUid) {
      console.warn(
        `\x1b[31m[No UID]\x1b[0m 无法定位视频 UID: "${videoEntry.title}" (所属小节: ${sectionTitle})`
      )
      missingUidCount++
      return
    }

    // 严格按 videoUid 匹配 API 返回的记录
    const apiVideo = uidToApiVideo.get(targetUid)
    if (!apiVideo) {
      console.warn(
        `\x1b[31m[UID Not in API]\x1b[0m 后端不存在 UID 为 "${targetUid}" 的视频 ("${videoEntry.title}")`
      )
      missingUidCount++
      return
    }

    if (videoEntry.refId === apiVideo.crossId) {
      matchedCount++
      return
    }

    console.log(`\x1b[33m[Update by UID]\x1b[0m ${videoEntry.title}`)
    console.log(`  ├─ 匹配 UID:     \x1b[36m${targetUid}\x1b[0m`)
    console.log(`  ├─ 旧 RefId:     \x1b[90m${videoEntry.refId || '空'}\x1b[0m`)
    console.log(`  └─ 最新 CrossID: \x1b[32m${apiVideo.crossId}\x1b[0m (DB ID: ${apiVideo.id})`)

    videoEntry.refId = apiVideo.crossId
    videoEntry.videoUid = targetUid
    updatedCount++
  }

  // 遍历 Manifest 节点树
  for (const course of manifest) {
    for (const ch of course.chapters) {
      if (ch.subChapters) {
        for (const sub of ch.subChapters) {
          if (sub.video) {
            processVideoEntry(sub.video, sub.subChapterTitle)
          }
        }
      } else if (ch.video) {
        processVideoEntry(ch.video, ch.chapterTitle)
      }
    }
  }

  // 4. 写回 Manifest
  if (!dryRun && updatedCount > 0) {
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(
      `\n\x1b[32m[Success]\x1b[0m 已成功基于 UID 刷新并写入: \x1b[36m${manifestPath}\x1b[0m`
    )
  }

  console.log(`\n==================== 统计结果 ====================`)
  console.log(`Manifest 视频总数:    ${totalVideos}`)
  console.log(`UID 匹配且已一致:     \x1b[32m${matchedCount}\x1b[0m`)
  console.log(`基于 UID 需/已更新:   \x1b[33m${updatedCount}\x1b[0m`)
  console.log(`未找到匹配 UID 记录:  \x1b[31m${missingUidCount}\x1b[0m\n`)
}

// ==================== 3. 主执行入口 ====================

async function main() {
  const program = new Command()
  program
    .name('bun src/learn-node/sync_video_ref_ids.ts')
    .description('通过 Admin HTTP API 根据 Cloudflare videoUid 精确刷新 curriculum_manifest.json')
    .option('-m, --manifest <path>', 'Manifest 文件路径', './curriculum_manifest.json')
    .option(
      '-u, --upload-results <path>',
      '上传结果 JSON 或本项目 doc/en|zh/videos.csv',
      './upload_results.json'
    )
    .option('--dry-run', '仅预览将要修改的 refId，不实际修改 Manifest 文件', false)
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明')

  await program.parseAsync(process.argv)
  const options = program.opts()

  await syncManifestByVideoUid(options.manifest, options.uploadResults, options.dryRun)
  process.exit(0)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
