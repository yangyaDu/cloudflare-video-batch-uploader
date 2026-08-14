import { describe, expect, test } from 'bun:test'

import { detectLanguage } from '../src/language'

describe('detectLanguage', () => {
  test('包含中文时返回 zh', () => {
    expect(detectLanguage('基础策略 Lesson 01')).toBe('zh')
  })

  test('纯英文、数字和符号时返回 en', () => {
    expect(detectLanguage('Preflop Strategy - Lesson 01')).toBe('en')
  })

  test('繁体汉字也识别为中文', () => {
    expect(detectLanguage('撲克基礎')).toBe('zh')
  })
})
