import { Command } from 'commander'
import { requestAdmin, type LearnNodeCreateResponse, type LearnNodeType } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/create.ts')
    .description('新建教学节点（可创建根课程节点或挂载在指定父节点下）')
    .requiredOption('-t, --type <type>', '节点类型 (course | chapter | video | drill | article)')
    .requiredOption('--title <title>', '节点标题 (1-128 字符)')
    .option(
      '-p, --parent <parentNodeUuid>',
      '父节点 UUID (32位十六进制小写；若不填或传 null 则创建根节点)'
    )
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  # 创建根课程节点
  bun src/learn-node/create.ts --type course --title "德州扑克进阶课程"

  # 在课程下创建章节
  bun src/learn-node/create.ts --type chapter --title "第一章：翻前基础" --parent 01951234567890abcdef1234567890ab

  # 在章节下创建视频节点
  bun src/learn-node/create.ts --type video --title "1.1 位置优势解析" --parent 01951234567890abcdef1234567890cd
  bun src/learn-node/create.ts -h`
    )
    .action(async (options) => {
      try {
        const parentUuid =
          options.parent && options.parent !== 'null' && options.parent !== 'root'
            ? options.parent.trim()
            : null

        const body = {
          type: options.type as LearnNodeType,
          title: options.title.trim(),
          parentNodeUuid: parentUuid,
        }

        const data = await requestAdmin<LearnNodeCreateResponse>(
          'POST',
          '/api/adminimda/learn/node/create',
          { body }
        )

        console.log('\n\x1b[32m✔ 教学节点创建成功！\x1b[0m')
        console.log(`节点 UUID (nodeUuid):          ${data.nodeUuid}`)
        console.log(`父节点 UUID (parentNodeUuid):  ${data.parentNodeUuid || '(根节点)'}`)
        console.log(`节点层级 (level):              第 ${data.level} 层`)
        console.log(`初始状态 (status):             ${data.status}`)
        console.log(`创建时间 (createdAt):          ${data.createdAt}\n`)
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 新建教学节点失败:', err.message || err)
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
