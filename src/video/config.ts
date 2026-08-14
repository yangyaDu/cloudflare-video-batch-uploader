import { loadBackendConfig } from '../config'
import type { VideoBackendConfig } from './types'

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 必须是正整数，当前值: ${raw}`)
  }
  return value
}

export function loadVideoBackendConfig(): VideoBackendConfig {
  return {
    ...loadBackendConfig(),
    pollIntervalMs: positiveInteger('VIDEO_READY_POLL_INTERVAL_MS', 5000),
    readyTimeoutMs: positiveInteger('VIDEO_READY_TIMEOUT_MS', 30 * 60 * 1000),
  }
}
