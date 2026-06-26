import { describe, expect, it } from 'vitest'
import { sanitizeImagePromptForApi } from './promptSanitizer'

describe('prompt sanitizer', () => {
  it('removes face privacy artifacts from generated reference descriptions', () => {
    const prompt = '构图中心为一名年轻男性，他的脸部被一个矩形模糊块遮挡。他身穿黑色短袖，手里拿着苹果。背景是山姆超市。'

    expect(sanitizeImagePromptForApi(prompt)).toBe('构图中心为一名年轻男性，他身穿黑色短袖，手里拿着苹果。背景是山姆超市。')
  })

  it('keeps ordinary visual details', () => {
    const prompt = '雨夜街道，电影级镜头，主体清晰，背景自然虚化。'

    expect(sanitizeImagePromptForApi(prompt)).toBe(prompt)
  })
})
