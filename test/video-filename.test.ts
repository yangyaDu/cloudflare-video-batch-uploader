import { describe, expect, test } from 'bun:test'

import { videoTitle } from '../src/video/fs-utils'

describe('videoTitle', () => {
  test('removes the numeric prefix and language or metadata suffixes from batch filenames', () => {
    expect(videoTitle('11-现金桌口袋二打法-翻前建议与六个翻后技巧-CN-.mp4')).toBe(
      '现金桌口袋二打法-翻前建议与六个翻后技巧'
    )
    expect(
      videoTitle(
        '11-How to Play Pocket Twos in Cash Games Preflop Advice and 6 Postflop Tips_EN.mp4'
      )
    ).toBe('How to Play Pocket Twos in Cash Games Preflop Advice and 6 Postflop Tips')
    expect(
      videoTitle(
        '92-潮湿转牌快速随后过牌后的河牌诈唬-[river]_[postflop_fta]_[SB]_[bet]_[KQo]_[CN].mp4'
      )
    ).toBe('潮湿转牌快速随后过牌后的河牌诈唬')
  })

  test('keeps ordinary video filenames unchanged except for their extension', () => {
    expect(videoTitle('中文基础 Lesson 01.mp4')).toBe('中文基础 Lesson 01')
  })
})
