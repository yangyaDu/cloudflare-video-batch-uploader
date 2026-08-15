import type {
  DuplicateMatchActivityAddPayload,
  DuplicateMatchHandAddPayload,
  DuplicateMatchHandBackend,
} from './duplicate-match-hand/types'
import type { BackendConfig } from './types'

interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
}

export class BackendApiError extends Error {
  constructor(
    readonly code: number | null,
    message: string
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

export class BackendClient implements DuplicateMatchHandBackend {
  constructor(protected readonly config: BackendConfig) {}

  protected endpoint(path: string): string {
    return new URL(`/api/adminimda${path}`, this.config.baseUrl).toString()
  }

  protected async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(this.endpoint(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-adminimda-token': `Bearer ${this.config.adminToken}`,
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let payload: ApiResponse<T> | null = null
    try {
      payload = JSON.parse(text) as ApiResponse<T>
    } catch {
      // 在下面用响应正文创建带 HTTP 状态的错误。
    }

    if (!response.ok || !payload || payload.code !== 0 || payload.data === null) {
      const detail = payload?.message || text || `${response.status} ${response.statusText}`
      throw new BackendApiError(payload?.code ?? null, `后端 API 请求失败: ${detail}`)
    }
    return payload.data
  }

  async addDuplicateMatchHand(payload: DuplicateMatchHandAddPayload): Promise<{ id: number }> {
    return this.request<{ id: number }>('/duplicate-match/hand/add', payload)
  }

  async publishDuplicateMatchHand(id: number): Promise<void> {
    await this.request<{ id: number; status: number }>('/duplicate-match/hand/publish', { id })
  }

  async addDuplicateMatchActivity(
    payload: DuplicateMatchActivityAddPayload
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>('/duplicate-match/activity/add', payload)
  }

  async publishDuplicateMatchActivity(id: number): Promise<void> {
    await this.request<{ id: number; status: number }>('/duplicate-match/activity/publish', { id })
  }

  async unpublishDuplicateMatchActivity(id: number): Promise<void> {
    await this.request<{ id: number; status: number }>('/duplicate-match/activity/unpublish', {
      id,
    })
  }

  async deleteDuplicateMatchActivity(id: number): Promise<{ id: number; isDeleted: 0 | 1 }> {
    return this.request<{ id: number; isDeleted: 0 | 1 }>('/duplicate-match/activity/delete', {
      id,
    })
  }
}
