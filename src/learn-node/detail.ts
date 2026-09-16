import { Command } from 'commander'
import { requestAdmin, type LearnNodeDetailResponse } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/detail.ts')
    .description('查询指定教学节点的完整配置详情及关联资源实时状态')
    .argument('<nodeUuid>', '目标节点的 UUID (32 位十六进制小写)')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  bun src/learn-node/detail.ts 01951234567890abcdef1234567890ab
  bun src/learn-node/detail.ts -h`
    )
    .action(async (nodeUuid: string) => {
      try {
        const data = await requestAdmin<LearnNodeDetailResponse>(
          'GET',
          '/api/adminimda/learn/node/detail',
          {
            query: { nodeUuid: nodeUuid.trim() },
          }
        )

        console.log('\n=== 教学节点详情 ===')
        console.log(`节点 UUID (nodeUuid):          ${data.nodeUuid}`)
        console.log(`父节点 UUID (parentNodeUuid):  ${data.parentNodeUuid || '(根节点)'}`)
        console.log(`节点层级 (level):              第 ${data.level} 层`)
        console.log(`节点类型 (type):               ${data.type}`)
        console.log(`节点标题 (title):              ${data.title}`)
        console.log(
          `发布状态 (status):             ${data.status === 'published' ? '\x1b[32m已发布 (published)\x1b[0m' : '\x1b[33m未发布 (unpublished)\x1b[0m'}`
        )
        console.log(
          `进入探索池 (exploreEnabled):   ${data.exploreEnabled ? '是 (true)' : '否 (false)'}`
        )
        console.log(`节点描述 (description):        ${data.description || '(无)'}`)
        console.log(`资源引用 ID (refId):           ${data.refId || '(无)'}`)

        if (data.passCondition) {
          console.log(`通关条件 (passCondition):      ${JSON.stringify(data.passCondition)}`)
        } else {
          console.log(`通关条件 (passCondition):      (无)`)
        }

        if (data.resource) {
          console.log('\n--- 关联资源实时信息 ---')
          console.log(`资源 UUID:                     ${data.resource.resourceUuid}`)
          console.log(`资源标题:                      ${data.resource.title}`)
          console.log(`资源状态:                      ${data.resource.status}`)
        } else {
          console.log(`关联资源 (resource):           (无)`)
        }

        console.log('\n--- 审计与时间 ---')
        console.log(`创建者 UUID:                   ${data.createdByUuid}`)
        console.log(`创建时间:                      ${data.createdAt}`)
        console.log(`最后修改者 UUID:               ${data.updatedByUuid}`)
        console.log(`更新时间:                      ${data.updatedAt}`)
        console.log(`发布者 UUID:                   ${data.publishedByUuid || '(未发布)'}`)
        console.log(`发布时间:                      ${data.publishedAt || '(未发布)'}`)
        console.log('====================\n')
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 查询教学节点详情失败:', err.message || err)
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
