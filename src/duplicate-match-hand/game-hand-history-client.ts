import type { DataServicesHandsClientConfig } from './data-services-client'

export interface GameHandHistoryApiResponse {
  code: number
  message: string
  data: {
    tableId: string
    handHistory: unknown
  } | null
}

export class GameHandHistoryClient {
  constructor(private readonly config: DataServicesHandsClientConfig) {}

  async fetchGameHandHistory(tableId: string): Promise<GameHandHistoryApiResponse> {
    const url = new URL('/api/game_client/get_hand_history', this.config.baseUrl)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${this.config.webToken}`,
      },
      body: JSON.stringify({ tableId }),
    })
    const text = await response.text()
    let payload: GameHandHistoryApiResponse | null = null
    try {
      payload = JSON.parse(text) as GameHandHistoryApiResponse
    } catch {
      // 由下方统一返回包含 HTTP 状态和原始正文的错误。
    }
    if (
      !response.ok ||
      !payload ||
      payload.code !== 0 ||
      !payload.data?.handHistory ||
      payload.data.tableId !== tableId
    ) {
      const detail = payload?.message || text || `${response.status} ${response.statusText}`
      throw new Error(`get_hand_history 查询失败: ${detail}`)
    }
    return payload
  }
}
