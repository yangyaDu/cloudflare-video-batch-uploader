import { Command } from 'commander'
import { requestAdmin, printTree, type LearnNodeTreeResponse } from './client'

interface CliOptions {
  color: boolean
  raw: boolean
}

async function withoutConsoleOutput<T>(callback: () => Promise<T>): Promise<T> {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    debug: console.debug,
  }

  console.log = () => undefined
  console.info = () => undefined
  console.warn = () => undefined
  console.debug = () => undefined

  try {
    return await callback()
  } finally {
    Object.assign(console, originalConsole)
  }
}

async function main() {
  const program = new Command()

  program
    .name('bun src/learn-node/tree.ts')
    .description('查询指定节点为根的完整教学子树结构')
    .argument('<rootNodeUuid>', '根节点或子树根节点的 UUID (32 位十六进制小写)')
    .option('--no-color', '禁用 ANSI 颜色输出')
    .option('--raw', '仅输出接口返回的纯 JSON')
    .showHelpAfterError()
    .helpOption('-h, --help', '显示帮助说明信息')
    .addHelpText(
      'after',
      `
示例 (Examples):
  bun src/learn-node/tree.ts 01951234567890abcdef1234567890ab
  bun src/learn-node/tree.ts --no-color 01951234567890abcdef1234567890ab
  bun src/learn-node/tree.ts --raw 01951234567890abcdef1234567890ab | jq
  bun src/learn-node/tree.ts -h`
    )
    .action(async (rootNodeUuid: string, options: CliOptions) => {
      try {
        const requestTree = () =>
          requestAdmin<LearnNodeTreeResponse>('GET', '/api/adminimda/learn/node/tree', {
            query: { rootNodeUuid: rootNodeUuid.trim() },
            color: options.color,
          })
        const data = options.raw ? await withoutConsoleOutput(requestTree) : await requestTree()

        if (options.raw) {
          console.log(JSON.stringify(data, null, 2))
          return
        }

        console.log('\n=== 教学节点子树结构 ===')
        if (!data || !data.root) {
          console.log('（未获取到子树数据）')
          return
        }

        printTree(data.root, '', true, { color: options.color })
        console.log('')
      } catch (err: any) {
        const errorLabel = options.color && !options.raw ? '\x1b[31m[Error]\x1b[0m' : '[Error]'
        console.error(`\n${errorLabel} 查询教学节点子树失败:`, err.message || err)
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
