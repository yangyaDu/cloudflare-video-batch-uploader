#!/usr/bin/env bun

import { Command } from 'commander'

import { scanVideos } from './scanner'
import { uploadVideos } from './uploader'

interface ScanCliOptions {
  input?: string
  workDir: string
  force?: boolean
}

interface UploadCliOptions {
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
  .description('扫描本地视频，提取首帧，并批量上传到 Cloudflare Stream/Images')
  .showHelpAfterError()

program
  .command('scan')
  .description('扫描 workdir/video/en 和 workdir/video/zh，生成封面、CSV 和上传状态文件')
  .option('-i, --input <directory>', '视频根目录；默认 <work-dir>/video，内部必须包含 en、zh')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .option('--force', '覆盖已有 CSV/状态并重新提取封面')
  .action(async (options: ScanCliOptions) => {
    const result = await scanVideos({
      sourceDir: options.input,
      workDir: options.workDir,
      force: options.force,
    })
    printScanResult(result.total, result.added, result.failures, result.csvPaths)
    if (result.failures > 0) process.exitCode = 1
  })

program
  .command('upload')
  .description('读取 doc/en、doc/zh 的 CSV 和状态，上传尚未完成的视频和封面')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: UploadCliOptions) => {
    const result = await uploadVideos(options.workDir)
    printUploadResult(result.total, result.completed, result.failed, result.csvPaths)
  })

program
  .command('resume')
  .description('从 doc/en、doc/zh 的上传状态恢复中断任务')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .action(async (options: UploadCliOptions) => {
    const result = await uploadVideos(options.workDir)
    printUploadResult(result.total, result.completed, result.failed, result.csvPaths)
  })

program
  .command('all')
  .description('依次执行 scan 和 upload')
  .option('-i, --input <directory>', '视频根目录；默认 <work-dir>/video，内部必须包含 en、zh')
  .option('-w, --work-dir <directory>', '工作目录', './workdir')
  .option('--force', '覆盖已有 CSV/状态并重新提取封面')
  .action(async (options: ScanCliOptions) => {
    const scan = await scanVideos({
      sourceDir: options.input,
      workDir: options.workDir,
      force: options.force,
    })
    printScanResult(scan.total, scan.added, scan.failures, scan.csvPaths)

    const upload = await uploadVideos(options.workDir)
    printUploadResult(upload.total, upload.completed, upload.failed, upload.csvPaths)
  })

program.parseAsync().catch((error: unknown) => {
  console.error(`\n执行失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
