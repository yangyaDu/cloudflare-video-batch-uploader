import { Command } from 'commander'
import { requestAdmin, type LearnNodeMoveResponse } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/move.ts')
    .description('移动教学节点（可跨父节点移动或在同级调整先后排序）')
    .argument('<nodeUuid>', '待移动的目标节点 UUID (32 位十六进制小写)')
    .option(
      '-p, --parent <parentNodeUuid>',
      '新父节点 UUID (传 null 或 root 表示提升为根节点；若不传或同级移动则保持原父节点)'
    )
    .option(
      '--prev <previousNodeUuid>',
      '目标位置的前一个同级兄弟节点 UUID (传 null 或 first 表示排在同级最前；不传排在同级最后)'
    )
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  # 移到指定父节点下，并排在某个节点之后
  bun src/learn-node/move.ts 01951234567890abcdef1234567890cd --parent 01951234567890abcdef1234567890ab --prev 01951234567890abcdef1234567890ef

  # 移到指定父节点下的第一个位置
  bun src/learn-node/move.ts 01951234567890abcdef1234567890cd --parent 01951234567890abcdef1234567890ab --prev null

  # 提升为根节点
  bun src/learn-node/move.ts 01951234567890abcdef1234567890cd --parent root
  bun src/learn-node/move.ts -h`
    )
    .action(async (nodeUuid: string, options) => {
      try {
        let parentNodeUuid: string | null = null
        if (options.parent !== undefined) {
          if (options.parent === 'null' || options.parent === 'root') {
            parentNodeUuid = null
          } else {
            parentNodeUuid = options.parent.trim()
          }
        }

        let previousNodeUuid: string | null = null
        if (options.prev !== undefined) {
          if (options.prev === 'null' || options.prev === 'first') {
            previousNodeUuid = null
          } else {
            previousNodeUuid = options.prev.trim()
          }
        }

        const body = {
          nodeUuid: nodeUuid.trim(),
          parentNodeUuid,
          previousNodeUuid,
        }

        const data = await requestAdmin<LearnNodeMoveResponse>(
          'POST',
          '/api/adminimda/learn/node/move',
          { body }
        )

        console.log('\n\x1b[32m✔ 教学节点移动成功！\x1b[0m')
        console.log(`节点 UUID (nodeUuid):          ${data.nodeUuid}`)
        console.log(`新父节点 (parentNodeUuid):     ${data.parentNodeUuid || '(根节点)'}`)
        console.log(`前序节点 (previousNodeUuid):   ${data.previousNodeUuid || '(排在首位)'}`)
        console.log(`新节点层级 (level):            第 ${data.level} 层`)
        console.log(`受影响节点数 (affected):       ${data.affectedNodeCount}`)
        console.log(`更新时间 (updatedAt):          ${data.updatedAt}\n`)
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 移动教学节点失败:', err.message || err)
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
