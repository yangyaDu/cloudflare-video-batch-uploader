import { Command } from 'commander'
import { requestAdmin, type LearnNodeUpdateResponse } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/update.ts')
    .description('编辑教学节点的基础配置（标题、描述、关联资源 ID、通关条件、Explore 状态）')
    .argument('<nodeUuid>', '待编辑节点的 UUID (32 位十六进制小写)')
    .option('--title <title>', '修改节点标题 (1-128 字符)')
    .option('--description <description>', '修改节点描述 (最长 512 字符)')
    .option('--ref-id <refId>', '关联资源 ID (如视频 UUID 或 drill_id；传 null 或 clear 清空)')
    .option(
      '--pass-condition <json>',
      '通关条件 JSON 字符串 (如 \'{"watchRatio": 0.9}\'；传 null 清空)'
    )
    .option('--explore-enabled <boolean>', '是否进入 Explore 探索候选池 (true | false)')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  # 修改标题和描述
  bun src/learn-node/update.ts 01951234567890abcdef1234567890ab --title "新课程名称" --description "课程更新简介"

  # 关联视频资源并设置通关条件
  bun src/learn-node/update.ts 01951234567890abcdef1234567890cd --ref-id 01951111222233334444555566667777 --pass-condition '{"watchRatio":0.8}'

  # 开启章节 Explore 状态
  bun src/learn-node/update.ts 01951234567890abcdef1234567890ef --explore-enabled true
  bun src/learn-node/update.ts -h`
    )
    .action(async (nodeUuid: string, options) => {
      try {
        const body: Record<string, any> = {
          nodeUuid: nodeUuid.trim(),
        }

        if (options.title !== undefined) body.title = options.title.trim()
        if (options.description !== undefined) body.description = options.description.trim()

        if (options.refId !== undefined) {
          body.refId =
            options.refId === 'null' || options.refId === 'clear' ? null : options.refId.trim()
        }

        if (options.passCondition !== undefined) {
          if (options.passCondition === 'null' || options.passCondition === 'clear') {
            body.passCondition = null
          } else {
            try {
              body.passCondition = JSON.parse(options.passCondition)
            } catch (e: any) {
              throw new Error(`--pass-condition 必须是合法的 JSON 格式: ${e.message}`)
            }
          }
        }

        if (options.exploreEnabled !== undefined) {
          if (!['true', 'false'].includes(options.exploreEnabled))
            throw new Error('--explore-enabled 必须为 true 或 false')
          body.exploreEnabled = options.exploreEnabled === 'true' || options.exploreEnabled === true
        }

        const data = await requestAdmin<LearnNodeUpdateResponse>(
          'POST',
          '/api/adminimda/learn/node/update',
          { body }
        )

        console.log('\n\x1b[32m✔ 教学节点更新成功！\x1b[0m')
        console.log(`节点 UUID (nodeUuid):          ${data.nodeUuid}`)
        console.log(`更新时间 (updatedAt):         ${data.updatedAt}\n`)
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 编辑教学节点失败:', err.message || err)
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
