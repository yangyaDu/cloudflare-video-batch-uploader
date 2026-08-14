import { BOARD_ACTIONS, createDefaultDrillInfo } from './defaults'
import type { DuplicateMatchAction, GeneratedHandCase, PokerStreet } from './types'

const action = (name: string, seatNo: number, amount = 0): DuplicateMatchAction => ({
  action: name,
  seat_no: seatNo,
  amount,
})

function createCase(
  caseId: string,
  title: string,
  heroSeat: number,
  actions: DuplicateMatchAction[],
  street: PokerStreet,
  spotType: string,
  expected: Record<string, unknown> = {}
): GeneratedHandCase {
  return {
    caseId,
    title,
    expected: { street, spot_type: spotType, ...expected },
    request: {
      title,
      drillInfo: createDefaultDrillInfo(heroSeat, actions),
    },
  }
}

function preflopCases(): GeneratedHandCase[] {
  return [
    createCase(
      'spot-preflop-rfi-first-to-act',
      'DS-SPOT-PREFLOP-RFI-FIRST-TO-ACT',
      3,
      [],
      'preflop',
      'preflop_rfi',
      { active_opponent_count: 0, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-rfi-after-folds',
      'DS-SPOT-PREFLOP-RFI-AFTER-FOLDS',
      0,
      [action('fold', 3), action('fold', 4), action('fold', 5)],
      'preflop',
      'preflop_rfi',
      { active_opponent_count: 0, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-limp-single',
      'DS-SPOT-PREFLOP-VS-LIMP-SINGLE',
      0,
      [action('call', 3, 2), action('fold', 4), action('fold', 5)],
      'preflop',
      'preflop_vs_limp',
      { active_opponent_count: 1, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-limp-multi',
      'DS-SPOT-PREFLOP-VS-LIMP-MULTI',
      0,
      [action('call', 3, 2), action('call', 4, 2), action('call', 5, 2)],
      'preflop',
      'preflop_vs_limp',
      { active_opponent_count: 3, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-raise-after-limp',
      'DS-SPOT-PREFLOP-VS-RAISE-AFTER-LIMP',
      0,
      [action('call', 3, 2), action('raise', 4, 6), action('fold', 5)],
      'preflop',
      'preflop_vs_raise',
      { active_opponent_count: 2, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-raise-after-call',
      'DS-SPOT-PREFLOP-VS-RAISE-AFTER-CALL',
      0,
      [action('raise', 3, 6), action('call', 4, 6), action('fold', 5)],
      'preflop',
      'preflop_vs_raise',
      { active_opponent_count: 2, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-threebet-cold',
      'DS-SPOT-PREFLOP-VS-THREEBET-COLD',
      0,
      [action('raise', 3, 6), action('raise', 4, 18), action('fold', 5)],
      'preflop',
      'preflop_vs_threebet',
      { active_opponent_count: 2, hero_acted_before: false }
    ),
    createCase(
      'spot-preflop-vs-threebet-opener-heads-up',
      'DS-SPOT-PREFLOP-VS-THREEBET-OPENER-HEADS-UP',
      3,
      [
        action('raise', 3, 6),
        action('fold', 4),
        action('fold', 5),
        action('fold', 0),
        action('fold', 1),
        action('raise', 2, 18),
      ],
      'preflop',
      'preflop_vs_threebet',
      { active_opponent_count: 1, hero_acted_before: true }
    ),
    createCase(
      'spot-preflop-vs-threebet-opener-multiway',
      'DS-SPOT-PREFLOP-VS-THREEBET-OPENER-MULTIWAY',
      3,
      [
        action('raise', 3, 6),
        action('call', 4, 6),
        action('raise', 5, 18),
        action('fold', 0),
        action('fold', 1),
        action('fold', 2),
      ],
      'preflop',
      'preflop_vs_threebet',
      { active_opponent_count: 2, hero_acted_before: true }
    ),
    createCase(
      'spot-preflop-vs-fourbet-3',
      'DS-SPOT-PREFLOP-VS-FOURBET-3-RAISES',
      0,
      [action('raise', 3, 6), action('raise', 4, 18), action('raise', 5, 42)],
      'preflop',
      'preflop_vs_fourbet',
      { aggressive_action_count: 3 }
    ),
    createCase(
      'spot-preflop-vs-fourbet-4',
      'DS-SPOT-PREFLOP-VS-FOURBET-4-RAISES',
      1,
      [
        action('raise', 3, 6),
        action('raise', 4, 18),
        action('raise', 5, 42),
        action('raise', 0, 90),
      ],
      'preflop',
      'preflop_vs_fourbet',
      { aggressive_action_count: 4 }
    ),
    createCase(
      'spot-preflop-vs-fourbet-5',
      'DS-SPOT-PREFLOP-VS-FOURBET-5-RAISES',
      2,
      [
        action('raise', 3, 6),
        action('raise', 4, 18),
        action('raise', 5, 42),
        action('raise', 0, 90),
        action('raise', 1, 180),
      ],
      'preflop',
      'preflop_vs_fourbet',
      { aggressive_action_count: 5 }
    ),
  ]
}

function preflopToFlop(): DuplicateMatchAction[] {
  return [
    action('raise', 3, 6),
    action('fold', 4),
    action('fold', 5),
    action('call', 0, 6),
    action('fold', 1),
    action('call', 2, 4),
    { ...BOARD_ACTIONS.flop },
  ]
}

function completeCheckedStreet(): DuplicateMatchAction[] {
  return [action('check', 2), action('check', 3), action('check', 0)]
}

function actionsBeforeTargetStreet(street: Exclude<PokerStreet, 'preflop'>) {
  const actions = preflopToFlop()
  if (street === 'flop') return actions

  actions.push(...completeCheckedStreet(), { ...BOARD_ACTIONS.turn })
  if (street === 'turn') return actions

  actions.push(...completeCheckedStreet(), { ...BOARD_ACTIONS.river })
  return actions
}

function postflopCases(): GeneratedHandCase[] {
  return (['flop', 'turn', 'river'] as const).flatMap((street) => {
    const commonExpected = {
      players_in_pot: 3,
      pot_family: 'srp',
      hero_initiative: 'caller_or_checker',
    }
    return [
      createCase(
        `spot-${street}-fta`,
        `DS-SPOT-${street.toUpperCase()}-FTA`,
        2,
        actionsBeforeTargetStreet(street),
        street,
        'postflop_fta',
        { ...commonExpected, position_relation: 'oop' }
      ),
      createCase(
        `spot-${street}-vs-check`,
        `DS-SPOT-${street.toUpperCase()}-VS-CHECK`,
        0,
        [...actionsBeforeTargetStreet(street), action('check', 2), action('check', 3)],
        street,
        'postflop_vs_check',
        { ...commonExpected, position_relation: 'ip' }
      ),
      createCase(
        `spot-${street}-vs-bet`,
        `DS-SPOT-${street.toUpperCase()}-VS-BET`,
        0,
        [...actionsBeforeTargetStreet(street), action('check', 2), action('bet', 3, 8)],
        street,
        'postflop_vs_bet',
        { ...commonExpected, position_relation: 'ip' }
      ),
      createCase(
        `spot-${street}-vs-raise`,
        `DS-SPOT-${street.toUpperCase()}-VS-RAISE`,
        0,
        [...actionsBeforeTargetStreet(street), action('bet', 2, 8), action('raise', 3, 24)],
        street,
        'postflop_vs_raise',
        { ...commonExpected, position_relation: 'ip' }
      ),
    ]
  })
}

function heroPositionCases(): GeneratedHandCase[] {
  return [
    createCase('position-utg', 'DS-POSITION-UTG', 3, [], 'preflop', 'preflop_rfi'),
    createCase('position-hj', 'DS-POSITION-HJ', 4, [action('fold', 3)], 'preflop', 'preflop_rfi'),
    createCase(
      'position-co',
      'DS-POSITION-CO',
      5,
      [action('fold', 3), action('fold', 4)],
      'preflop',
      'preflop_rfi'
    ),
  ]
}

function playersInPotCase(playerCount: 2 | 3 | 4 | 5 | 6): GeneratedHandCase {
  const activeSeats = new Set([2, ...[0, 3, 4, 5, 1].slice(0, playerCount - 1)])
  const actions = [3, 4, 5, 0, 1].map((seatNo) =>
    activeSeats.has(seatNo) ? action('call', seatNo, seatNo === 1 ? 1 : 2) : action('fold', seatNo)
  )
  actions.push(action('check', 2), { ...BOARD_ACTIONS.flop })
  if (activeSeats.has(1)) actions.push(action('check', 1))

  return createCase(
    `players-in-pot-${playerCount}`,
    `DS-PLAYERS-IN-POT-${playerCount}`,
    2,
    actions,
    'flop',
    activeSeats.has(1) ? 'postflop_vs_check' : 'postflop_fta',
    {
      players_in_pot: playerCount,
      pot_family: 'limped',
      hero_initiative: 'caller_or_checker',
      position_relation: activeSeats.has(1) ? 'sandwiched' : 'oop',
    }
  )
}

function dimensionCases(): GeneratedHandCase[] {
  const sandwichedAggressor = createCase(
    'relation-sandwiched-aggressor',
    'DS-RELATION-SANDWICHED-AGGRESSOR',
    3,
    [
      action('raise', 3, 6),
      action('fold', 4),
      action('fold', 5),
      action('call', 0, 6),
      action('fold', 1),
      action('call', 2, 4),
      { ...BOARD_ACTIONS.flop },
      action('check', 2),
    ],
    'flop',
    'postflop_vs_check',
    {
      players_in_pot: 3,
      pot_family: 'srp',
      hero_initiative: 'aggressor',
      position_relation: 'sandwiched',
      opponent_position: ['BB'],
    }
  )

  const threeBetPot = createCase(
    'pot-family-3bp',
    'DS-POT-FAMILY-3BP',
    0,
    [
      action('raise', 3, 6),
      action('raise', 4, 18),
      action('fold', 5),
      action('call', 0, 18),
      action('fold', 1),
      action('fold', 2),
      action('call', 3, 12),
      { ...BOARD_ACTIONS.flop },
      action('check', 3),
      action('check', 4),
    ],
    'flop',
    'postflop_vs_check',
    {
      players_in_pot: 3,
      pot_family: '3bp',
      hero_initiative: 'caller_or_checker',
      position_relation: 'ip',
      opponent_position: ['UTG', 'HJ'],
    }
  )

  const fourBetPot = createCase(
    'pot-family-4bp-plus',
    'DS-POT-FAMILY-4BP-PLUS',
    0,
    [
      action('raise', 3, 6),
      action('raise', 4, 18),
      action('raise', 5, 42),
      action('call', 0, 42),
      action('fold', 1),
      action('fold', 2),
      action('call', 3, 36),
      action('call', 4, 24),
      { ...BOARD_ACTIONS.flop },
      action('check', 3),
      action('check', 4),
      action('check', 5),
    ],
    'flop',
    'postflop_vs_check',
    {
      players_in_pot: 4,
      pot_family: '4bp+',
      hero_initiative: 'caller_or_checker',
      position_relation: 'ip',
      opponent_position: ['UTG', 'HJ', 'CO'],
    }
  )

  return [
    ...Array.from({ length: 5 }, (_, index) => playersInPotCase((index + 2) as 2 | 3 | 4 | 5 | 6)),
    sandwichedAggressor,
    threeBetPot,
    fourBetPot,
  ]
}

/** 生成固定、可追踪的 Data Services 场景枚举；expected 仅落本地，不发送给后端。 */
export function generateDuplicateMatchHandCases(): GeneratedHandCase[] {
  return [...preflopCases(), ...postflopCases(), ...heroPositionCases(), ...dimensionCases()]
}
