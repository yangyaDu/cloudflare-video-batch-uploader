import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readVideoTagConfig } from '../src/video/tag-config'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function writeConfig(rows: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'video-tag-config-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'config.csv')
  await writeFile(path, `\uFEFF${rows.join('\r\n')}`, 'utf8')
  return path
}

describe('video tag config', () => {
  test('同一行的介绍和漏洞英文视频映射到同一个介绍视频标签', async () => {
    const path = await writeConfig([
      '知识点配置表,,,,',
      '来源：配置清单,,,,',
      '展示序号,介绍视频标签,介绍视频EN,漏洞视频EN,备注',
      '1,BTN Steal,BTN Steal Intro.mp4,BTN Steal Leak.mov,新加',
    ])

    const config = await readVideoTagConfig(path)

    expect(config.get('BTN Steal Intro')).toMatchObject({ primaryTag: 'BTN Steal', rowNumber: 4 })
    expect(config.get('btn steal leak')).toMatchObject({ primaryTag: 'BTN Steal', rowNumber: 4 })
  })

  test('配置名称和本地文件名均沿用标题清洗，移除前序编号与末尾 EN 标记', async () => {
    const path = await writeConfig([
      '介绍视频标签,介绍视频EN,漏洞视频EN',
      'BTN Steal,5-BTN RFI Standard Decision Guide-[EN],',
    ])
    const config = await readVideoTagConfig(path)

    expect(config.get('5-BTN RFI Standard Decision Guide-[EN].mp4')).toMatchObject({
      primaryTag: 'BTN Steal',
    })
    expect(config.matchVideoTitles(['BTN RFI Standard Decision Guide'])).toEqual(
      new Map([['BTN RFI Standard Decision Guide', 'BTN Steal']])
    )
  })

  test('要求本地视频与配置中的两条英文视频完整且唯一地匹配', async () => {
    const path = await writeConfig([
      '介绍视频标签,介绍视频EN,漏洞视频EN',
      'BTN Steal,BTN Steal Intro,BTN Steal Leak',
    ])
    const config = await readVideoTagConfig(path)

    const tags = config.matchVideoTitles(['BTN Steal Intro', 'BTN Steal Leak'])

    expect(tags).toEqual(
      new Map([
        ['BTN Steal Intro', 'BTN Steal'],
        ['BTN Steal Leak', 'BTN Steal'],
      ])
    )
    expect(() => config.matchVideoTitles(['BTN Steal Intro'])).toThrow('视频文件不存在')
    expect(() => config.matchVideoTitles(['BTN Steal Intro', 'Other Video'])).toThrow(
      '未出现在配置 CSV'
    )
  })

  test('跳过两个英文视频都未填写的行，并映射已填写的英文视频', async () => {
    const validPath = await writeConfig([
      '介绍视频标签,介绍视频EN,漏洞视频EN',
      '已有知识点,,,',
      'BTN Steal,BTN Steal Intro,BTN Steal Leak',
    ])
    const config = await readVideoTagConfig(validPath)
    expect(config.size).toBe(2)

    const partialPath = await writeConfig([
      '介绍视频标签,介绍视频EN,漏洞视频EN',
      'BTN Steal,BTN Steal Intro,',
    ])
    const partialConfig = await readVideoTagConfig(partialPath)
    expect(partialConfig.size).toBe(1)
    expect(partialConfig.get('BTN Steal Intro')).toMatchObject({ primaryTag: 'BTN Steal' })
  })

  test('只填写介绍视频EN列时也可读取配置', async () => {
    const path = await writeConfig([
      '介绍视频标签,介绍视频EN,备注',
      'BTN Steal,BTN Steal Intro,新加',
    ])

    const config = await readVideoTagConfig(path)

    expect(config.get('BTN Steal Intro')).toMatchObject({ primaryTag: 'BTN Steal' })
  })

  test('填写英文视频时要求介绍视频标签', async () => {
    const path = await writeConfig(['介绍视频标签,介绍视频EN,漏洞视频EN', ',BTN Steal Intro,'])

    expect(readVideoTagConfig(path)).rejects.toThrow('必须填写介绍视频标签')
  })

  test('拒绝忽略大小写和视频扩展名后重复的名称', async () => {
    const path = await writeConfig([
      '介绍视频标签,介绍视频EN,漏洞视频EN',
      'BTN Steal,BTN Intro.mp4,BTN Leak',
      'Other,btn intro.mov,Other Leak',
    ])

    expect(readVideoTagConfig(path)).rejects.toThrow('视频名称重复')
  })
})
