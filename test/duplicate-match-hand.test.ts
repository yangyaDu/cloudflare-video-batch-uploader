import { describe, expect, test } from 'bun:test'

import { generateDuplicateMatchHandCases } from '../src/duplicate-match-hand/case-catalog'

describe('generateDuplicateMatchHandCases', () => {
  test('生成覆盖翻前与三条翻后街道 spot_type 的合法请求目录', () => {
    const cases = generateDuplicateMatchHandCases()
    const ids = new Set(cases.map((item) => item.caseId))

    for (const expectedId of [
      'spot-preflop-rfi-first-to-act',
      'spot-preflop-rfi-after-folds',
      'spot-preflop-vs-limp-single',
      'spot-preflop-vs-limp-multi',
      'spot-preflop-vs-raise-after-limp',
      'spot-preflop-vs-raise-after-call',
      'spot-preflop-vs-threebet-cold',
      'spot-preflop-vs-threebet-opener-heads-up',
      'spot-preflop-vs-threebet-opener-multiway',
      'spot-preflop-vs-fourbet-3',
      'spot-preflop-vs-fourbet-4',
      'spot-preflop-vs-fourbet-5',
      ...(['flop', 'turn', 'river'] as const).flatMap((street) => [
        `spot-${street}-fta`,
        `spot-${street}-vs-check`,
        `spot-${street}-vs-bet`,
        `spot-${street}-vs-raise`,
      ]),
    ]) {
      expect(ids.has(expectedId)).toBe(true)
    }

    for (const item of cases) {
      expect(item.request.title).toBe(item.title)
      expect(item.request.drillInfo.players).toHaveLength(6)
      expect(
        item.request.drillInfo.players.filter((player) => player.name === 'Hero')
      ).toHaveLength(1)
      expect(item.request.drillInfo.big_blind).toBe(2)
      expect(item.request.drillInfo.ante).toBe(1)
      expect(item.request.drillInfo.straddle_seat).toBe(-1)
    }
  })

  test('翻前同一 spot_type 覆盖不同人数与行动角色组合', () => {
    const cases = new Map(generateDuplicateMatchHandCases().map((item) => [item.caseId, item]))
    const actionsOf = (caseId: string) =>
      cases
        .get(caseId)!
        .request.drillInfo.actions.map(({ action, seat_no }) => `${seat_no}:${action}`)

    expect(actionsOf('spot-preflop-rfi-first-to-act')).toEqual([])
    expect(actionsOf('spot-preflop-rfi-after-folds')).toEqual(['3:fold', '4:fold', '5:fold'])
    expect(actionsOf('spot-preflop-vs-limp-single')).toEqual(['3:call', '4:fold', '5:fold'])
    expect(actionsOf('spot-preflop-vs-limp-multi')).toEqual(['3:call', '4:call', '5:call'])
    expect(actionsOf('spot-preflop-vs-raise-after-limp')).toEqual(['3:call', '4:raise', '5:fold'])
    expect(actionsOf('spot-preflop-vs-raise-after-call')).toEqual(['3:raise', '4:call', '5:fold'])
    expect(actionsOf('spot-preflop-vs-threebet-cold')).toEqual(['3:raise', '4:raise', '5:fold'])
    expect(actionsOf('spot-preflop-vs-threebet-opener-heads-up')).toEqual([
      '3:raise',
      '4:fold',
      '5:fold',
      '0:fold',
      '1:fold',
      '2:raise',
    ])
    expect(actionsOf('spot-preflop-vs-threebet-opener-multiway')).toEqual([
      '3:raise',
      '4:call',
      '5:raise',
      '0:fold',
      '1:fold',
      '2:fold',
    ])

    expect(cases.get('spot-preflop-vs-limp-single')!.expected.active_opponent_count).toBe(1)
    expect(cases.get('spot-preflop-vs-limp-multi')!.expected.active_opponent_count).toBe(3)
    expect(cases.get('spot-preflop-vs-threebet-opener-heads-up')!.expected.hero_acted_before).toBe(
      true
    )
    expect(
      cases.get('spot-preflop-vs-threebet-opener-multiway')!.expected.active_opponent_count
    ).toBe(2)
  })

  test('附加 Case 覆盖其余位置、人数、相对位置、底池和主动权枚举', () => {
    const cases = generateDuplicateMatchHandCases()
    const values = (field: string) =>
      new Set(cases.map((item) => item.expected[field]).filter((value) => value !== undefined))

    expect(new Set(cases.map((item) => item.request.drillInfo.heroPosition))).toEqual(
      new Set(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'])
    )
    expect(values('players_in_pot')).toEqual(new Set([2, 3, 4, 5, 6]))
    expect(values('position_relation')).toEqual(new Set(['oop', 'ip', 'sandwiched']))
    expect(values('pot_family')).toEqual(new Set(['limped', 'srp', '3bp', '4bp+']))
    expect(values('hero_initiative')).toEqual(new Set(['aggressor', 'caller_or_checker']))
  })

  test('翻后 Case 使用公共牌 action 推进到目标街道', () => {
    const cases = generateDuplicateMatchHandCases()

    for (const item of cases.filter((candidate) => candidate.expected.street !== 'preflop')) {
      const boardActions = item.request.drillInfo.actions.filter((action) => action.seat_no === -1)
      const expectedBoardCount = { flop: 1, turn: 2, river: 3 }[
        item.expected.street as 'flop' | 'turn' | 'river'
      ]
      expect(boardActions).toHaveLength(expectedBoardCount)
    }
  })
})
