const HAN_CHARACTER = /\p{Script=Han}/u

/** 文件名中只要含汉字就识别为中文，否则按英文处理。 */
export function detectLanguage(title: string): 'zh' | 'en' {
  return HAN_CHARACTER.test(title) ? 'zh' : 'en'
}
