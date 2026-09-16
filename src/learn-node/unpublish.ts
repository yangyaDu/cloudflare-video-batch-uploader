import { Command } from 'commander'
import { requestAdmin, type LearnNodeUnpublishResponse } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/unpublish.ts')
    .description('下架完整教学节点树（整树所有节点统一置为未发布状态）')
    .argument('<rootNodeUuid>', '目标根节点 UUID (32 位十六进制小写)')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  bun src/learn-node/unpublish.ts 01951234567890abcdef1234567890ab
  bun src/learn-node/unpublish.ts -h`
    )
    .action(async (rootNodeUuid: string) => {
      try {
        const body = {
          rootNodeUuid: rootNodeUuid.trim(),
        }

        const data = await requestAdmin<LearnNodeUnpublishResponse>(
          'POST',
          '/api/adminimda/learn/node/unpublish',
          { body }
        )

        console.log('\n\x1b[32m✔ 教学节点树下架成功！\x1b[0m')
        console.log(`根节点 UUID (rootNodeUuid):      ${data.rootNodeUuid}`)
        console.log(`下架状态 (status):               \x1b[33m${data.status}\x1b[0m`)
        console.log(`整树节点总数 (totalNodeCount):   ${data.totalNodeCount}`)
        console.log(`已下架节点数 (unpublishedCount): ${data.unpublishedNodeCount}`)
        console.log(`更新时间 (updatedAt):            ${data.updatedAt}\n`)
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 下架教学节点树失败:', err.message || err)
        process.exit(1)
      }
    })

  await program.parseAsync(process.argv)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
