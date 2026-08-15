export interface DataServicesHandsClientConfig {
  baseUrl: string
  webToken: string
}

export interface DataServicesHandsApiResponse {
  code: number
  message: string
  data: {
    metadata: unknown
    data: unknown[]
  } | null
}

export class DataServicesHandsClient {
  constructor(private readonly config: DataServicesHandsClientConfig) {}

  async fetchHandsByTableId(tableId: string): Promise<DataServicesHandsApiResponse> {
    const url = new URL('/api/hands-review/data-services/hands', this.config.baseUrl)
    url.searchParams.set('page', '1')
    url.searchParams.set('pageSize', '1')
    url.searchParams.set('filter', `table_id:eq:${tableId}`)
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.webToken}` },
    })
    const text = await response.text()
    let payload: DataServicesHandsApiResponse | null = null
    try {
      payload = JSON.parse(text) as DataServicesHandsApiResponse
    } catch {
      // 由下方统一返回包含 HTTP 状态和原始正文的错误。
    }
    if (!response.ok || !payload || payload.code !== 0) {
      const detail = payload?.message || text || `${response.status} ${response.statusText}`
      throw new Error(`Data Services 手牌查询失败: ${detail}`)
    }
    if (!Array.isArray(payload.data?.data) || payload.data.data.length === 0) {
      throw new Error(`Data Services 没有查到对应牌谱: ${tableId}`)
    }
    return payload
  }
}
