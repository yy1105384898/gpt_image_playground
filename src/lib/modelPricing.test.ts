import { describe, expect, it } from 'vitest'
import { modelPricingLabel } from './modelPricing'

describe('model pricing label', () => {
  it('uses 张 for image billing units', () => {
    expect(modelPricingLabel({ model_name: 'gpt-image-2', model_price: 0.05, request_unit: 'image' })).toBe('¥0.05/张')
  })

  it('keeps request billing units as 次', () => {
    expect(modelPricingLabel({ model_name: 'text-model', model_price: 0.01, request_unit: 'request' })).toBe('¥0.01/次')
  })
})
