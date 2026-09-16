import { Command } from 'commander'
import { requestAdmin, type LearnNodeListRootResponse, type LearnNodeStatus } from './client'

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/list_root.ts')
    .description('查询管理后台教学根节点列表（支持关键词搜索、状态过滤与分页）')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .option('-k, --keyword <keyword>', '按根节点标题模糊搜索')
    .option('-s, --status <status>', '按发布状态过滤 (unpublished | published)')
    .option('-p, --page <page>', '当前页码', (val) => parseInt(val, 10), 1)
    .option('--page-size <pageSize>', '每页条数', (val) => parseInt(val, 10), 20)
    .addHelpText(
      'after',
      `
示例 (Examples):
  bun src/learn-node/list_root.ts
  bun src/learn-node/list_root.ts --status published
  bun src/learn-node/list_root.ts --keyword "德州" --page 1 --page-size 10
  bun src/learn-node/list_root.ts -h`
    )
    .action(async (options) => {
      try {
        const query: Record<string, any> = {
          page: options.page,
          pageSize: options.pageSize,
        }
        if (options.keyword) query.keyword = options.keyword
        if (options.status) query.status = options.status as LearnNodeStatus

        const data = await requestAdmin<LearnNodeListRootResponse>(
          'GET',
          '/api/adminimda/learn/node/list-root',
          { query }
        )

        console.log('\n=== 教学根节点列表 ===')
        console.log(`总数: ${data.total} | 当前页: ${data.page} | 每页: ${data.pageSize}\n`)

        if (!data.list || data.list.length === 0) {
          console.log('（暂无根节点数据）')
          return
        }

        console.log(
          '序号'.padEnd(4),
          '节点 UUID'.padEnd(34),
          '类型'.padEnd(10),
          '状态'.padEnd(10),
          '直接子节点数'.padEnd(14),
          '标题'
        )
        console.log('-'.repeat(95))

        data.list.forEach((item, index) => {
          const statusStr =
            item.status === 'published' ? '\x1b[32m已发布\x1b[0m' : '\x1b[33m未发布\x1b[0m'
          const typeStr = `\x1b[34m${item.type}\x1b[0m`
          const num = `${index + 1}`.padEnd(4)
          const uuid = item.nodeUuid.padEnd(34)
          const children = `${item.directChildCount}`.padEnd(14)
          console.log(num, uuid, typeStr.padEnd(19), statusStr.padEnd(19), children, item.title)
        })
        console.log('')
      } catch (err: any) {
        console.error('\n\x1b[31m[Error]\x1b[0m 查询根节点列表失败:', err.message || err)
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
