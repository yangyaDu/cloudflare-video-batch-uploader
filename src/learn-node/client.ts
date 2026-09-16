import { loadBackendConfig } from '../config'

// ==================== 1. 核心类型定义 ====================

export type LearnNodeType = 'course' | 'chapter' | 'video' | 'drill' | 'article'
export type LearnNodeStatus = 'unpublished' | 'published'

export interface LearnNodeSummary {
  nodeUuid: string
  type: LearnNodeType
  title: string
  status: LearnNodeStatus
  directChildCount: number
  updatedAt: string
}

export interface LearnNodeListRootResponse {
  list: LearnNodeSummary[]
  page: number
  pageSize: number
  total: number
}

export interface LearnNodeTreeItem {
  nodeUuid: string
  parentNodeUuid: string | null
  type: LearnNodeType
  title: string
  status: LearnNodeStatus
  level: number
  children: LearnNodeTreeItem[]
}

export interface LearnNodeTreeResponse {
  root: LearnNodeTreeItem
}

export interface LearnNodeResource {
  status: 'available' | 'unpublished' | 'disabled' | 'deleted' | 'not_found'
  title: string
  resourceUuid: string
}

export interface LearnNodeDetailResponse {
  nodeUuid: string
  parentNodeUuid: string | null
  type: LearnNodeType
  title: string
  description: string
  refId: string | null
  passCondition: Record<string, any> | null
  status: LearnNodeStatus
  exploreEnabled: boolean
  level: number
  resource: LearnNodeResource | null
  createdByUuid: string
  updatedByUuid: string
  publishedByUuid: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export interface LearnNodeCreateResponse {
  nodeUuid: string
  parentNodeUuid: string | null
  status: LearnNodeStatus
  level: number
  createdAt: string
}

export interface LearnNodeUpdateResponse {
  nodeUuid: string
  updatedAt: string
}

export interface LearnNodeMoveResponse {
  nodeUuid: string
  parentNodeUuid: string | null
  previousNodeUuid: string | null
  level: number
  affectedNodeCount: number
  updatedAt: string
}

export interface LearnNodePublishResponse {
  rootNodeUuid: string
  status: 'published'
  totalNodeCount: number
  publishedNodeCount: number
  publishedAt: string
}

export interface LearnNodeUnpublishResponse {
  rootNodeUuid: string
  status: 'unpublished'
  totalNodeCount: number
  unpublishedNodeCount: number
  updatedAt: string
}

export interface LearnNodeDeleteResponse {
  nodeUuid: string
  deletedNodeCount: number
  deletedAt: string
}

export interface AdminApiResponse<T> {
  code: number
  message?: string
  errorCode?: string
  data: T
}

// ==================== 2. HTTP 请求客户端 ====================

export async function requestAdmin<T>(
  method: 'GET' | 'POST',
  path: string,
  options: {
    query?: Record<string, any>
    body?: any
    color?: boolean
  } = {}
): Promise<T> {
  const config = loadBackendConfig()
  const token = config.adminToken
  let url = new URL(path, config.baseUrl).toString()

  if (options.query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v))
      }
    }
    const queryString = params.toString()
    if (queryString) {
      url += `?${queryString}`
    }
  }

  const color = options.color !== false
  const adminApiLabel = color ? '\x1b[36m[Admin API]\x1b[0m' : '[Admin API]'
  const payloadLabel = color ? '\x1b[90mPayload:\x1b[0m' : 'Payload:'

  console.log(`\n${adminApiLabel} ${method} ${url}`)
  if (options.body && method === 'POST') {
    console.log(payloadLabel, JSON.stringify(options.body, null, 2))
  }

  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-adminimda-token': `Bearer ${token}`,
    },
    body: options.body && method === 'POST' ? JSON.stringify(options.body) : undefined,
  })

  const rawText = await resp.text()
  let json: AdminApiResponse<T>
  try {
    json = JSON.parse(rawText) as AdminApiResponse<T>
  } catch {
    throw new Error(`HTTP ${resp.status} 非 JSON 响应: ${rawText}`)
  }

  if (resp.status !== 200 || json.code !== 0) {
    const errCode = json.errorCode ? ` [${json.errorCode}]` : ''
    const msg = json.message || `HTTP ${resp.status}`
    const extraData = json.data ? `\n详细信息: ${JSON.stringify(json.data, null, 2)}` : ''
    throw new Error(`接口请求失败 [code=${json.code}]${errCode}: ${msg}${extraData}`)
  }

  return json.data
}

// ==================== 3. 树形结构格式化输出 ====================

export function printTree(
  item: LearnNodeTreeItem,
  prefix: string = '',
  isLast: boolean = true,
  options: { color?: boolean } = {}
) {
  const color = options.color !== false
  const branch = prefix ? (isLast ? '└── ' : '├── ') : ''
  const statusBadge =
    item.status === 'published'
      ? color
        ? '\x1b[32m[已发布]\x1b[0m'
        : '[已发布]'
      : color
        ? '\x1b[33m[未发布]\x1b[0m'
        : '[未发布]'
  const typeText = `[${item.type.toUpperCase()}]`
  const typeBadge = color ? `\x1b[34m${typeText}\x1b[0m` : typeText
  const levelText = `(L${item.level})`
  const levelBadge = color ? `\x1b[90m${levelText}\x1b[0m` : levelText
  const uuidText = `<${item.nodeUuid}>`
  const uuidBadge = color ? `\x1b[90m${uuidText}\x1b[0m` : uuidText

  console.log(
    `${prefix}${branch}${typeBadge} ${statusBadge} ${item.title} ${levelBadge} ${uuidBadge}`
  )

  const nextPrefix = prefix + (isLast ? '    ' : '│   ')
  const children = item.children || []
  for (const [i, child] of children.entries()) {
    printTree(child, nextPrefix, i === children.length - 1, options)
  }
}
