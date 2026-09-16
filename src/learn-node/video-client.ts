import { requestAdmin } from './client'

export interface AdminVideoItem {
  id?: number
  crossId: string
  videoUid: string
  title: string
}

/** 遍历全部分页，避免课程引用仅匹配到前 100 个视频。 */
export async function getVideoList({ pageSize = 100 } = {}) {
  const data: AdminVideoItem[] = []
  for (let page = 1; ; page++) {
    const result = await requestAdmin<{ data: AdminVideoItem[]; count: number }>(
      'GET',
      '/api/adminimda/video/list',
      { query: { page, pageSize, needCount: 1 } }
    )
    data.push(...result.data)
    if (result.data.length < pageSize || data.length >= result.count) break
  }
  return { data, count: data.length }
}
