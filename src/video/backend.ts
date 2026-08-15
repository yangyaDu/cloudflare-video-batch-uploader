import { basename } from 'node:path'

import { BackendApiError, BackendClient } from '../backend'
import type {
  CreatedVideo,
  ImageUploadInfo,
  ResumableUploadInfo,
  VideoBackendConfig,
  VideoCreatePayload,
} from './types'

const TUS_RESUMABLE_VERSION = '1.0.0'
const TUS_CHUNK_SIZE = 50 * 1024 * 1024
const VIDEO_UPLOAD_LIMIT = 500 * 1024 * 1024
const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024
const VIDEO_NOT_READY_CODES = new Set([1107, 1108])

function toTusMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) =>
      value ? `${key} ${Buffer.from(value, 'utf8').toString('base64')}` : key
    )
    .join(',')
}

function imageContentType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  return (
    {
      '.gif': 'image/gif',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    }[extension] || 'application/octet-stream'
  )
}

export class VideoBackendClient extends BackendClient {
  declare protected readonly config: VideoBackendConfig

  constructor(config: VideoBackendConfig) {
    super(config)
  }

  async createResumableVideoUpload(path: string): Promise<ResumableUploadInfo> {
    const file = Bun.file(path)
    if (file.size > VIDEO_UPLOAD_LIMIT) {
      throw new Error(`后端分片上传仅支持不超过 500MB 的视频: ${path}`)
    }

    const info = await this.request<ResumableUploadInfo>('/video/resumableUpload', {
      uploadLength: file.size,
      uploadMetadata: toTusMetadata({
        filename: basename(path),
        requiresignedurls: '',
        filetype: file.type || 'video/mp4',
      }),
    })
    if (!info.uid || !info.uploadUrl) throw new Error('后端视频直传响应缺少 uid 或 uploadUrl')
    return info
  }

  async uploadVideoToTus(path: string, uploadUrl: string): Promise<void> {
    const file = Bun.file(path)
    const head = await fetch(uploadUrl, {
      method: 'HEAD',
      headers: { 'Tus-Resumable': TUS_RESUMABLE_VERSION },
    })
    const rawOffset = head.headers.get('Upload-Offset')
    const offset = rawOffset === null ? Number.NaN : Number(rawOffset)
    if (!head.ok || !Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
      throw new Error(`无法恢复 TUS 视频上传 (${head.status}): ${path}`)
    }

    let uploaded = offset
    while (uploaded < file.size) {
      const end = Math.min(uploaded + TUS_CHUNK_SIZE, file.size)
      const chunk = await file.slice(uploaded, end).arrayBuffer()
      const response = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Tus-Resumable': TUS_RESUMABLE_VERSION,
          'Upload-Offset': String(uploaded),
        },
        body: chunk,
      })
      const nextOffset = Number(response.headers.get('Upload-Offset'))
      if (
        !response.ok ||
        !Number.isSafeInteger(nextOffset) ||
        nextOffset <= uploaded ||
        nextOffset > file.size
      ) {
        throw new Error(`TUS 视频分片上传失败 (${response.status}): ${path}`)
      }
      uploaded = nextOffset
      console.log(`  视频上传进度: ${Math.round((uploaded / file.size) * 100)}%`)
    }
  }

  async createImageUpload(): Promise<ImageUploadInfo> {
    const info = await this.request<ImageUploadInfo>('/image/upload', {})
    if (!info.id || !info.uploadUrl || !info.visitUrl) {
      throw new Error('后端图片直传响应缺少 id、uploadUrl 或 visitUrl')
    }
    return info
  }

  async uploadImageToDirectUrl(path: string, uploadUrl: string): Promise<void> {
    const file = Bun.file(path)
    if (file.size > IMAGE_UPLOAD_LIMIT) {
      throw new Error(`封面图片不能超过 10MB: ${path}`)
    }
    const form = new FormData()
    form.append(
      'file',
      new Blob([await file.arrayBuffer()], { type: imageContentType(path) }),
      basename(path)
    )
    const response = await fetch(uploadUrl, { method: 'POST', body: form })
    if (!response.ok) throw new Error(`封面直传失败 (${response.status}): ${path}`)
  }

  async addVideoWhenReady(payload: VideoCreatePayload): Promise<CreatedVideo> {
    const deadline = Date.now() + this.config.readyTimeoutMs
    while (true) {
      try {
        return await this.request<CreatedVideo>('/video/add', payload)
      } catch (error) {
        if (!(error instanceof BackendApiError) || !VIDEO_NOT_READY_CODES.has(error.code ?? -1)) {
          throw error
        }
        if (Date.now() >= deadline) {
          throw new Error(`等待 Cloudflare Stream 转码超时: ${payload.videoUid}`)
        }
        console.log(`  视频转码中，${this.config.pollIntervalMs}ms 后重试`)
        await Bun.sleep(this.config.pollIntervalMs)
      }
    }
  }

  async publishVideo(id: number): Promise<void> {
    try {
      await this.request<{ id: number; status: number }>('/video/publish', { id })
    } catch (error) {
      // 发布接口对已经发布的记录返回 1106；对断点恢复来说这是幂等成功。
      if (error instanceof BackendApiError && error.code === 1106) return
      throw error
    }
  }
}
