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
  spotType: string
): GeneratedHandCase {
  return {
    caseId,
    title,
    expected: { street, spot_type: spotType },
    request: {
      title,
      drillInfo: createDefaultDrillInfo(heroSeat, actions, 9),
    },
  }
}

/** 九人桌最小可验证场景集；每条行动线均停在 Hero 决策点。 */
export function generateNineMaxDuplicateMatchHandCases(): GeneratedHandCase[] {
  return [
    createCase('9max-preflop-rfi-utg', 'DS-9MAX-PREFLOP-RFI-UTG', 3, [], 'preflop', 'preflop_rfi'),
    createCase(
      '9max-preflop-vs-raise-lj',
      'DS-9MAX-PREFLOP-VS-RAISE-LJ',
      6,
      [action('raise', 3, 6), action('call', 4, 6), action('fold', 5)],
      'preflop',
      'preflop_vs_raise'
    ),
    createCase(
      '9max-flop-vs-bet-hj',
      'DS-9MAX-FLOP-VS-BET-HJ',
      7,
      [
        action('raise', 3, 6),
        action('call', 4, 6),
        action('fold', 5),
        action('fold', 6),
        action('call', 7, 6),
        action('fold', 8),
        action('call', 0, 6),
        action('fold', 1),
        action('call', 2, 4),
        { ...BOARD_ACTIONS.flop },
        action('check', 2),
        action('check', 3),
        action('bet', 4, 8),
      ],
      'flop',
      'postflop_vs_bet'
    ),
  ]
}
