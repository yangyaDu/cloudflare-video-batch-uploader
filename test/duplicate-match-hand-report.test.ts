import { describe, expect, test } from 'bun:test'

import { buildCases } from '../scripts/generate-duplicate-match-hand-report'

describe('牌谱维度参数验证报告', () => {
  test('villain_position 返回 Hero 面对的主要进攻者，而不是全部存活对手', async () => {
    const cases = await buildCases()
    const target = cases.find((item) => item.caseId === 'spot-flop-vs-bet')

    expect(target?.actual.villain_position).toBe('UTG')
    expect(target?.expected.villain_position).toBe('UTG')
    expect(target?.fields).not.toContain('villain_position')
  })

  test('无下注或加注时 villain_position 按 null 处理', async () => {
    const cases = await buildCases()
    const rfi = cases.find((item) => item.caseId === 'spot-preflop-rfi-first-to-act')
    const fta = cases.find((item) => item.caseId === 'spot-flop-fta')

    expect(rfi?.actual.villain_position).toBeNull()
    expect(rfi?.expected.villain_position).toBeNull()
    expect(fta?.actual.villain_position).toBeNull()
    expect(fta?.expected.villain_position).toBeNull()
  })

  test('active_players 使用街道开始时人数，不按 Hero 决策点重新计数', async () => {
    const cases = await buildCases()
    const target = cases.find((item) => item.caseId === 'spot-preflop-vs-limp-single')

    expect(target?.actual.active_players).toBe(6)
    expect(target?.expected.active_players).toBe(6)
    expect(target?.fields).not.toContain('active_players')
  })

  test('翻前结束 Case 不展示不适用的 pot_family', async () => {
    const cases = await buildCases()
    const rfi = cases.find((item) => item.caseId === 'spot-preflop-rfi-first-to-act')
    const postflop = cases.find((item) => item.caseId === 'spot-flop-vs-bet')

    expect(rfi?.actual).not.toHaveProperty('pot_family')
    expect(rfi?.expected).not.toHaveProperty('pot_family')
    expect(postflop?.actual.pot_family).toBe('srp')
    expect(postflop?.expected.pot_family).toBe('srp')
  })

  test('进入翻后的 turn 决策展示已完成的翻牌圈和当前转牌圈', async () => {
    const cases = await buildCases()
    const target = cases.find((item) => item.caseId === 'spot-turn-vs-check')

    expect(target?.postflopLines).toEqual([
      {
        street: 'preflop',
        actions: ['UTG raise', 'HJ fold', 'CO fold', '【Hero】BTN call', 'SB fold', 'BB call'],
      },
      {
        street: 'flop',
        actions: ['BB check', 'UTG check', '【Hero】BTN check'],
      },
      {
        street: 'turn',
        actions: ['BB check', 'UTG check', '【Hero】BTN check'],
      },
    ])
  })

  test('flop Case 先展示完整翻前行动线，再展示当前翻牌决策', async () => {
    const cases = await buildCases()
    const target = cases.find((item) => item.caseId === 'spot-flop-vs-raise')

    expect(target?.postflopLines).toEqual([
      {
        street: 'preflop',
        actions: ['UTG raise', 'HJ fold', 'CO fold', '【Hero】BTN call', 'SB fold', 'BB call'],
      },
      {
        street: 'flop',
        actions: ['BB bet', 'UTG raise', '【Hero】BTN call'],
      },
    ])
  })
})
