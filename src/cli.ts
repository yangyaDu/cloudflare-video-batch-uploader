#!/usr/bin/env bun

import { Command } from 'commander'
import { join } from 'node:path'

import {
  fetchGeneratedHandResults,
  rebuildGeneratedDuplicateMatchHandActivities,
  uploadGeneratedDuplicateMatchHandCases,
} from './duplicate-match-hand/batch'
import {
  generateDuplicateMatchHandCaseFile,
  resolveDuplicateMatchHandPaths,
} from './duplicate-match-hand/workspace'
import { summarizeVideoDurations } from './video/duration'
import { DEFAULT_VIDEO_WORK_DIR } from './video/paths'
import { scanVideos } from './video/scanner'
import { createVideoExportBackendFromEnvironment } from './video/sql-database'
import { exportVideoBatchSql } from './video/sql-exporter'
import { uploadVideos } from './video/uploader'

interface ScanCliOptions {
  input?: string
  workDir: string
  force?: boolean
  tagConfig?: string
}

interface UploadCliOptions {
  workDir: string
}

interface DurationCliOptions {
  input?: string
  workDir: string
}

interface ExportSqlCliOptions {
  workDir: string
  output?: string
}

interface HandCliOptions {
  workDir: string
}

function printScanResult(
  total: number,
  added: number,
  failures: number,
  csvPaths: readonly string[]
): void {
  console.log(`\n扫描完成：共 ${total} 个视频，本次新增 ${added} 个，${failures} 个封面失败`)
  console.log(`CSV:\n${csvPaths.map((path) => `  ${path}`).join('\n')}`)
}

function printUploadResult(
  total: number,
  completed: number,
  failed: number,
  csvPaths: readonly string[]
): void {
  console.log(`\n上传完成：共 ${total} 个，成功 ${completed} 个，失败 ${failed} 个`)
  console.log(`CSV:\n${csvPaths.map((path) => `  ${path}`).join('\n')}`)
  if (failed > 0) process.exitCode = 1
}

const program = new Command()
program
  .name('video-batch-uploader')
  .description('视频上传与 Data Services 验证手牌批量工具')
  .showHelpAfterError()

program
  .command('scan')
  .description('扫描默认视频批次的 video/en 和/或 video/zh，生成封面、CSV 和上传状态文件')
  .option('-i, --input <directory>', '视频根目录；默认 <work-dir>/video，内部包含 en 或 zh')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .option(
    '-t, --tag-config <csv>',
    '知识点配置 CSV；按介绍视频EN/漏洞视频EN为英文视频写入介绍视频标签'
  )
  .option('--force', '覆盖已有 CSV/状态并重新提取封面')
  .action(async (options: ScanCliOptions) => {
    const result = await scanVideos({
      sourceDir: options.input,
      workDir: options.workDir,
      force: options.force,
      tagConfigPath: options.tagConfig,
    })
    printScanResult(result.total, result.added, result.failures, result.csvPaths)
    if (result.failures > 0) process.exitCode = 1
  })

program
  .command('duration')
  .description('汇总 video/en 和/或 video/zh 中所有视频的总时长')
  .option('-i, --input <directory>', '视频根目录；默认 <work-dir>/video，内部包含 en 或 zh')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .action(async (options: DurationCliOptions) => {
    const videoRoot = options.input || join(options.workDir, 'video')
    const result = await summarizeVideoDurations(videoRoot)
    for (const [language, summary] of result.byLanguage) {
      console.log(`${language}: ${summary.videoCount} 个，${summary.formattedDuration}`)
    }
    console.log(`总计: ${result.total.videoCount} 个，${result.total.formattedDuration}`)
  })

program
  .command('upload')
  .description('读取已有的 doc/en 和/或 doc/zh 批次，上传尚未完成的视频和封面')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .action(async (options: UploadCliOptions) => {
    const result = await uploadVideos(options.workDir)
    printUploadResult(result.total, result.completed, result.failed, result.csvPaths)
  })

program
  .command('resume')
  .description('从 doc/en、doc/zh 的上传状态恢复中断任务')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .action(async (options: UploadCliOptions) => {
    const result = await uploadVideos(options.workDir)
    printUploadResult(result.total, result.completed, result.failed, result.csvPaths)
  })

program
  .command('all')
  .description('依次执行 scan 和 upload')
  .option('-i, --input <directory>', '视频根目录；默认 <work-dir>/video，内部包含 en 或 zh')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .option(
    '-t, --tag-config <csv>',
    '知识点配置 CSV；按介绍视频EN/漏洞视频EN为英文视频写入介绍视频标签'
  )
  .option('--force', '覆盖已有 CSV/状态并重新提取封面')
  .action(async (options: ScanCliOptions) => {
    const scan = await scanVideos({
      sourceDir: options.input,
      workDir: options.workDir,
      force: options.force,
      tagConfigPath: options.tagConfig,
    })
    printScanResult(scan.total, scan.added, scan.failures, scan.csvPaths)

    const upload = await uploadVideos(options.workDir)
    printUploadResult(upload.total, upload.completed, upload.failed, upload.csvPaths)
  })

program
  .command('export-sql')
  .description('读取当前批次已发布视频并生成可重复执行的 tb_video INSERT SQL')
  .option('-w, --work-dir <directory>', '工作目录', DEFAULT_VIDEO_WORK_DIR)
  .option('-o, --output <file>', '输出 SQL 文件；默认 <work-dir>/sql/tb_video.sql')
  .action(async (options: ExportSqlCliOptions) => {
    const backend = createVideoExportBackendFromEnvironment()
    try {
      const result = await exportVideoBatchSql(options.workDir, options.output, backend)
      console.log(`\nSQL 导出完成：${result.count} 条视频`)
      console.log(`Video IDs: ${result.videoIds.join(', ')}`)
      console.log(`SQL: ${result.outputPath}`)
    } finally {
      await backend.close?.()
    }
  })

const handProgram = program
  .command('hand')
  .description('生成并批量发布 Data Services 验证手牌及其七天活动')

handProgram
  .command('generate')
  .description('生成复式手牌 Case JSON，不请求后端')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: HandCliOptions) => {
    const manifest = await generateDuplicateMatchHandCaseFile(options.workDir)
    const paths = resolveDuplicateMatchHandPaths(options.workDir)
    console.log(`\n生成完成：共 ${manifest.cases.length} 个 Case`)
    console.log(`Case 文件: ${paths.casesPath}`)
    console.log(`TableId CSV: ${paths.tableIdsPath}`)
  })

handProgram
  .command('upload')
  .description('上传 Case，发布每手牌并创建、发布对应七天活动')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: HandCliOptions) => {
    const result = await uploadGeneratedDuplicateMatchHandCases(options.workDir)
    console.log(
      `\n处理完成：共 ${result.total} 个，成功 ${result.completed} 个，失败 ${result.failed} 个`
    )
    console.log(`状态文件: ${result.statePath}`)
    if (result.failed > 0) process.exitCode = 1
  })

handProgram
  .command('rebuild-activities')
  .description('删除状态文件中登记的活动，并用现有 handId 批量重建')
  .option('--confirm', '确认删除并重建活动')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: HandCliOptions & { confirm?: boolean }) => {
    if (!options.confirm) {
      throw new Error('该命令会删除并重建活动；请显式传入 --confirm')
    }
    const result = await rebuildGeneratedDuplicateMatchHandActivities(options.workDir)
    console.log(
      `\n旧活动删除：共 ${result.total} 个，成功 ${result.deleted} 个，失败 ${result.failed} 个`
    )
    if (result.recreated) {
      console.log(
        `重建完成：共 ${result.recreated.total} 个，成功 ${result.recreated.completed} 个，失败 ${result.recreated.failed} 个`
      )
    }
    console.log(`状态文件: ${result.statePath}`)
    if (result.failed > 0 || result.recreated?.failed) process.exitCode = 1
  })

handProgram
  .command('fetch-results')
  .description('按 table-ids.csv 下载原始牌谱和 Data Services 解析 JSON')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: HandCliOptions) => {
    const result = await fetchGeneratedHandResults(options.workDir)
    console.log(
      `\nget_hand_history：已配置 ${result.gameHandHistory.total} 个，新增 ${result.gameHandHistory.fetched} 个，跳过 ${result.gameHandHistory.skipped} 个，失败 ${result.gameHandHistory.failed} 个`
    )
    console.log(`原始牌谱目录: ${result.gameHandHistoryResultsDir}`)
    console.log(
      `Data Services：已配置 ${result.dataServices.total} 个，新增 ${result.dataServices.fetched} 个，跳过 ${result.dataServices.skipped} 个，失败 ${result.dataServices.failed} 个`
    )
    console.log(`解析结果目录: ${result.dataServicesResultsDir}`)
    if (result.gameHandHistory.failed > 0 || result.dataServices.failed > 0) {
      process.exitCode = 1
    }
  })

handProgram
  .command('all')
  .description('生成 Case 后立即执行上传与发布')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: HandCliOptions) => {
    await generateDuplicateMatchHandCaseFile(options.workDir)
    const result = await uploadGeneratedDuplicateMatchHandCases(options.workDir)
    console.log(
      `\n处理完成：共 ${result.total} 个，成功 ${result.completed} 个，失败 ${result.failed} 个`
    )
    console.log(`Case 文件: ${result.casesPath}`)
    console.log(`TableId CSV: ${resolveDuplicateMatchHandPaths(options.workDir).tableIdsPath}`)
    console.log(`状态文件: ${result.statePath}`)
    if (result.failed > 0) process.exitCode = 1
  })

program.parseAsync().catch((error: unknown) => {
  console.error(`\n执行失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
