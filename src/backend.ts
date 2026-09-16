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

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('x-adminimda-token', `Bearer ${this.config.adminToken}`)
    const response = await fetch(url, { ...init, headers })
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

  protected async request<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(this.endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  protected async query<T>(path: string, query: Record<string, string | number>): Promise<T> {
    const url = new URL(this.endpoint(path))
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
    return this.send<T>(url.toString(), { method: 'GET' })
  }

  async addDuplicateMatchHand(payload: DuplicateMatchHandAddPayload): Promise<{ id: number }> {
    return this.request<{ id: number }>('/duplicate-match/hand/add', payload)
  }

  async publishDuplicateMatchHand(id: number): Promise<void> {
    await this.request<{ id: number; status: number }>('/duplicate-match/hand/publish', { id })
  }

  async addDuplicateMatchActivity(
    payload: DuplicateMatchActivityAddPayload
  ): Promise<{ activityUuid: string }> {
    const activity = await this.request<{ activityUuid: string }>(
      '/duplicate-match/activity/add',
      payload
    )
    if (!/^[a-f0-9]{32}$/i.test(activity.activityUuid)) {
      throw new Error('新增活动响应缺少 32 位 activityUuid')
    }
    return activity
  }

  async publishDuplicateMatchActivity(activityUuid: string): Promise<void> {
    await this.request('/duplicate-match/activity/publish', { activityUuid })
  }

  async unpublishDuplicateMatchActivity(activityUuid: string): Promise<void> {
    await this.request('/duplicate-match/activity/unpublish', { activityUuid })
  }

  async deleteDuplicateMatchActivity(activityUuid: string): Promise<void> {
    await this.request('/duplicate-match/activity/delete', { activityUuid })
  }
}
