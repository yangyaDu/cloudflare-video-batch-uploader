import { Command } from 'commander'
import { requestAdmin, type LearnNodeDeleteResponse } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/delete.ts')
    .description('删除单个未发布叶子节点（若节点已发布或包含子节点则无法删除）')
    .argument('<nodeUuid>', '待删除的目标节点 UUID (32 位十六进制小写)')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  bun src/learn-node/delete.ts 01951234567890abcdef1234567890cd
  bun src/learn-node/delete.ts -h`
    )
    .action(async (nodeUuid: string) => {
      try {
        const body = {
          nodeUuid: nodeUuid.trim(),
        }

        const data = await requestAdmin<LearnNodeDeleteResponse>(
          'POST',
          '/api/adminimda/learn/node/delete',
          { body }
        )

        console.log('\n\x1b[32m✔ 教学节点删除成功！\x1b[0m')
        console.log(`节点 UUID (nodeUuid):          ${data.nodeUuid}`)
        console.log(`删除节点数 (deletedCount):     ${data.deletedNodeCount}`)
        console.log(`删除时间 (deletedAt):          ${data.deletedAt}\n`)
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 删除教学节点失败:', err.message || err)
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
