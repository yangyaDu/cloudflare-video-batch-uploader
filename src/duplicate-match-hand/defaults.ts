import type { DuplicateMatchAction, DuplicateMatchDrillInfo, DuplicateMatchPlayer } from './types'

const POSITION_BY_SEAT = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const
const HOLD_CARDS_BY_SEAT = ['QcKc', 'AhAd', 'KhQh', 'QdKd', 'JsJh', 'Tc9c'] as const

export const BOARD_ACTIONS = {
  flop: { action: '8c2s4s', seat_no: -1, amount: 0 },
  turn: { action: '7d', seat_no: -1, amount: 0 },
  river: { action: '6h', seat_no: -1, amount: 0 },
} as const satisfies Record<string, DuplicateMatchAction>

function createPlayers(heroSeat: number): DuplicateMatchPlayer[] {
  if (!POSITION_BY_SEAT[heroSeat]) {
    throw new Error(`不支持的 Hero 座位: ${heroSeat}`)
  }

  const cards = [...HOLD_CARDS_BY_SEAT]
  ;[cards[0], cards[heroSeat]] = [cards[heroSeat]!, cards[0]!]
  return cards.map((holdCards, seatNo) => ({
    id: seatNo,
    seat_no: seatNo,
    stack: 200,
    name: seatNo === heroSeat ? 'Hero' : `Player ${seatNo}`,
    hold_cards: holdCards,
  }))
}

/** 使用统一的 6 人桌骨架，只开放当前 Case 必须变化的 Hero 座位与行动线。 */
export function createDefaultDrillInfo(
  heroSeat: number,
  actions: DuplicateMatchAction[]
): DuplicateMatchDrillInfo {
  return {
    players: createPlayers(heroSeat),
    big_blind: 2,
    ante: 1,
    dealer_seat: 0,
    sb_seat: 1,
    bb_seat: 2,
    straddle_seat: -1,
    heroPosition: POSITION_BY_SEAT[heroSeat]!,
    actions,
    communityCards: {
      flop: '',
      turn: '',
      river: '',
    },
  }
}
