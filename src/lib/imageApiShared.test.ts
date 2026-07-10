import { describe, expect, it } from 'vitest'
import { translateImageErrorMessage } from './imageApiShared'

describe('translateImageErrorMessage', () => {
  it('translates common API key and quota errors', () => {
    expect(translateImageErrorMessage('Incorrect API key provided')).toBe('API 密钥无效或已过期')
    expect(translateImageErrorMessage('insufficient_quota')).toBe('账户额度不足，请充值或更换 API 密钥')
  })

  it('translates model, safety and request errors with HTTP status', () => {
    expect(translateImageErrorMessage('Error code: 404 - model_not_found')).toBe('当前渠道不支持该生图模型，或模型已不存在（HTTP 404）')
    expect(translateImageErrorMessage('HTTP 400: content policy violation')).toBe('提示词或图片触发了内容安全策略，请调整后重试（HTTP 400）')
    expect(translateImageErrorMessage('HTTP 429: Too many requests')).toBe('请求过于频繁，请稍后再试；如持续出现请检查额度（HTTP 429）')
  })

  it('translates network and timeout errors', () => {
    expect(translateImageErrorMessage('Failed to fetch')).toBe('无法连接上游生图服务，请检查渠道地址、网络或稍后重试')
    expect(translateImageErrorMessage('Request timed out')).toBe('图片生成请求超时，请稍后重试或降低图片尺寸/质量')
  })

  it('keeps existing Chinese messages and retains unknown errors', () => {
    expect(translateImageErrorMessage('接口返回的图片格式不支持')).toBe('接口返回的图片格式不支持')
    expect(translateImageErrorMessage('unexpected upstream error')).toBe('图片生成失败：unexpected upstream error')
  })
})
