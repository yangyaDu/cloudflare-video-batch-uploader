import 'dotenv/config'

import type { BackendConfig } from './types'

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请复制 .env.example 为 .env 后填写`)
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
  }
}
