import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { callTextChatApi } from './chatApi'

describe('callTextChatApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends reference images as Responses API multimodal input', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: '图片里是一只猫',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callTextChatApi({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }),
      model: 'gpt-4.1-mini',
      messages: [{
        id: 'user-a',
        role: 'user',
        content: '这张图里有什么？',
        createdAt: 1,
        imageIds: ['image-a'],
        imageDataUrls: ['data:image/png;base64,aW1hZ2U='],
      }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: '这张图里有什么？' },
        { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
      ],
    })
    expect(result).toBe('图片里是一只猫')
  })

  it('keeps text-only messages in the existing string format', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: '你好' }), { status: 200 }))

    await callTextChatApi({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }),
      model: 'gpt-4.1-mini',
      messages: [{ id: 'user-a', role: 'user', content: '你好', createdAt: 1 }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input[0]).toEqual({ role: 'user', content: '你好' })
  })
})
