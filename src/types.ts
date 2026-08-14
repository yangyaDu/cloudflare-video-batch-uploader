export type UploadStage = 'pending' | 'cover-created' | 'video-uploaded' | 'completed' | 'failed'

export interface UploadItemState {
  key: string
  rowIndex: number
  relativeVideoPath: string
  videoPath: string
  coverPath: string
  stage: UploadStage
  /** 后端创建的 Stream TUS 会话地址；上传中断时可用来续传。 */
  videoUploadUrl?: string
  /** 后端创建的 Images 直传会话；封面上传中断时可继续使用。 */
  imageUploadUrl?: string
  imageId?: string
  imageVisitUrl?: string
  /** /video/add 已成功，视频及封面已写入 tb_video。 */
  videoRegistered?: boolean
  lastError: string | null
  updatedAt: string
}

export interface UploadState {
  version: 1 | 2
  sourceDir: string
  workDir: string
  createdAt: string
  updatedAt: string
  items: UploadItemState[]
}

export interface BackendConfig {
  baseUrl: string
  adminToken: string
  pollIntervalMs: number
  readyTimeoutMs: number
}

export interface ResumableUploadInfo {
  uid: string
  uploadUrl: string
}

export interface ImageUploadInfo {
  id: string
  uploadUrl: string
  visitUrl: string
}

export interface VideoCreatePayload {
  language: 'zh' | 'en'
  difficulty: 10 | 20 | 30
  title: string
  titleDescription: string
  coverId: string
  coverUrl: string
  primaryTags: string[]
  secondaryTags: string[]
  videoUid: string
}

export interface CreatedVideo {
  id?: number
  videoDuration?: number
  videoSize?: number
}
