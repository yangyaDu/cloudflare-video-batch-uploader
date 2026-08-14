export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river'

export interface DuplicateMatchPlayer {
  id: number
  seat_no: number
  stack: number
  name: string
  hold_cards: string
}

export interface DuplicateMatchAction {
  action: string
  seat_no: number
  amount: number
}

export interface DuplicateMatchDrillInfo {
  players: DuplicateMatchPlayer[]
  big_blind: number
  ante: number
  dealer_seat: number
  sb_seat: number
  bb_seat: number
  straddle_seat: number
  heroPosition: string
  actions: DuplicateMatchAction[]
  communityCards: {
    flop: string
    turn: string
    river: string
  }
}

export interface DuplicateMatchHandAddPayload {
  title: string
  drillInfo: DuplicateMatchDrillInfo
}

export interface DuplicateMatchActivityAddPayload {
  title: string
  description: string
  playHandCount: number
  playCount: number
  handList: Array<{
    handId: number
    itemType: 1 | 2
    sortNo: number
  }>
  startTime: number
  endTime: number
}

export interface GeneratedHandCase {
  caseId: string
  title: string
  expected: {
    street: PokerStreet
    spot_type: string
    [key: string]: unknown
  }
  request: DuplicateMatchHandAddPayload
}

export interface DuplicateMatchHandBackend {
  addDuplicateMatchHand(payload: DuplicateMatchHandAddPayload): Promise<{ id: number }>
  publishDuplicateMatchHand(id: number): Promise<void>
  addDuplicateMatchActivity(payload: DuplicateMatchActivityAddPayload): Promise<{ id: number }>
  publishDuplicateMatchActivity(id: number): Promise<void>
}

export type HandCaseUploadStage =
  'pending' | 'hand-created' | 'hand-published' | 'activity-created' | 'completed' | 'failed'

export interface HandCaseUploadItemState {
  caseId: string
  title: string
  requestHash: string
  stage: HandCaseUploadStage
  handId?: number
  handPublished?: boolean
  activityId?: number
  activityPublished?: boolean
  lastError: string | null
  updatedAt: string
}

export interface HandCaseUploadState {
  version: 1
  createdAt: string
  updatedAt: string
  items: HandCaseUploadItemState[]
}
