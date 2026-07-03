import { describe, expect, it } from 'vitest'
import { isModelForPurpose } from './modelPurpose'

describe('model purpose classification', () => {
  it('recognizes common video model names without hiding them from video settings', () => {
    expect(isModelForPurpose('sora-2', 'video')).toBe(true)
    expect(isModelForPurpose('veo-3.0-generate-preview', 'video')).toBe(true)
    expect(isModelForPurpose('runway-gen-4-turbo', 'video')).toBe(true)
    expect(isModelForPurpose('jimeng-vgfm', 'video')).toBe(true)
    expect(isModelForPurpose('doubao-seedance-1-0-pro', 'video')).toBe(true)
  })

  it('does not classify image-only model names as video', () => {
    expect(isModelForPurpose('gpt-image-2', 'image')).toBe(true)
    expect(isModelForPurpose('gpt-image-2', 'text')).toBe(false)
    expect(isModelForPurpose('imagen-4', 'video')).toBe(false)
    expect(isModelForPurpose('imagen-4', 'image')).toBe(true)
    expect(isModelForPurpose('jimeng-image-3.0', 'video')).toBe(false)
    expect(isModelForPurpose('jimeng-image-3.0', 'image')).toBe(true)
  })
})
