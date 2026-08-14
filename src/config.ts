import 'dotenv/config'

import type { BackendConfig } from './types'

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请复制 .env.example 为 .env 后填写`)
  }
  return value
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 必须是正整数，当前值: ${raw}`)
  }
  return value
}

export function loadBackendConfig(): BackendConfig {
  const baseUrl = requireEnvironment('BACKEND_BASE_URL').replace(/\/$/, '')
  try {
    new URL(baseUrl)
  } catch {
    throw new Error(`环境变量 BACKEND_BASE_URL 必须是完整 URL，当前值: ${baseUrl}`)
  }

  return {
    baseUrl,
    adminToken: requireEnvironment('BACKEND_ADMIN_TOKEN'),
    pollIntervalMs: positiveInteger('VIDEO_READY_POLL_INTERVAL_MS', 5000),
    readyTimeoutMs: positiveInteger('VIDEO_READY_TIMEOUT_MS', 30 * 60 * 1000),
  }
}
