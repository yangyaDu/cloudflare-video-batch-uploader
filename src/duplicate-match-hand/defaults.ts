import type { DuplicateMatchAction, DuplicateMatchDrillInfo, DuplicateMatchPlayer } from './types'

const POSITION_BY_SEAT_6MAX = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const
const POSITION_BY_SEAT_9MAX = ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO'] as const
const HOLD_CARDS_BY_SEAT_6MAX = ['QcKc', 'AhAd', 'KhQh', 'QdKd', 'JsJh', 'Tc9c'] as const
const HOLD_CARDS_BY_SEAT_9MAX = [
  'QcKc',
  'AhAd',
  'KhQh',
  'QdKd',
  'JsJh',
  'Tc9c',
  '8s7s',
  '6h6d',
  'AsKs',
] as const

export const BOARD_ACTIONS = {
  flop: { action: '8c2s4s', seat_no: -1, amount: 0 },
  turn: { action: '7d', seat_no: -1, amount: 0 },
  river: { action: '6h', seat_no: -1, amount: 0 },
} as const satisfies Record<string, DuplicateMatchAction>

function createPlayers(heroSeat: number, tableSize: 6 | 9): DuplicateMatchPlayer[] {
  const positions = tableSize === 9 ? POSITION_BY_SEAT_9MAX : POSITION_BY_SEAT_6MAX
  const holdCards = tableSize === 9 ? HOLD_CARDS_BY_SEAT_9MAX : HOLD_CARDS_BY_SEAT_6MAX
  if (!positions[heroSeat]) {
    throw new Error(`不支持的 Hero 座位: ${heroSeat}`)
  }

  const cards = [...holdCards]
  ;[cards[0], cards[heroSeat]] = [cards[heroSeat]!, cards[0]!]
  return cards.map((holdCards, seatNo) => ({
    id: seatNo,
    seat_no: seatNo,
    stack: 200,
    name: seatNo === heroSeat ? 'Hero' : `Player ${seatNo}`,
    hold_cards: holdCards,
  }))
}

/** 使用统一的六人桌或九人桌骨架，只开放当前 Case 必须变化的 Hero 座位与行动线。 */
export function createDefaultDrillInfo(
  heroSeat: number,
  actions: DuplicateMatchAction[],
  tableSize: 6 | 9 = 6
): DuplicateMatchDrillInfo {
  return {
    players: createPlayers(heroSeat, tableSize),
    big_blind: 2,
    ante: 1,
    dealer_seat: 0,
    sb_seat: 1,
    bb_seat: 2,
    straddle_seat: -1,
    heroPosition: (tableSize === 9 ? POSITION_BY_SEAT_9MAX : POSITION_BY_SEAT_6MAX)[heroSeat]!,
    actions,
    communityCards: {
      flop: '',
      turn: '',
      river: '',
    },
  }
}
