import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PLAYGROUND_MODEL_CHANNELS,
  PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY,
  getPlaygroundModelChannels,
  isProtectedPlaygroundModelChannel,
} from './playgroundChannels'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('playground model channels', () => {
  it('keeps built-in relay channels at the front when saved settings are missing them', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'image-channel',
          name: '生图',
          apiFormat: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'custom-key',
          models: ['gpt-image-1'],
        },
      ]),
    })

    const channels = getPlaygroundModelChannels()

    expect(channels.slice(0, 2)).toEqual(DEFAULT_PLAYGROUND_MODEL_CHANNELS)
    expect(channels[2]).toMatchObject({ id: 'image-channel', baseUrl: 'https://example.com/v1' })
    expect(channels.slice(0, 2).every(isProtectedPlaygroundModelChannel)).toBe(true)
  })

  it('hardcodes protected relay urls without resetting other saved settings', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'subapi',
          name: '被改名',
          apiFormat: 'gemini',
          baseUrl: 'https://edited.example.com/v1',
          apiKey: 'sub-key',
          models: ['sora-2'],
        },
      ]),
    })

    const channels = getPlaygroundModelChannels()

    expect(channels[1]).toMatchObject({
      id: 'subapi',
      name: '被改名',
      apiFormat: 'gemini',
      baseUrl: 'https://yysubapi.yangyangnj.top/v1',
      apiKey: 'sub-key',
      models: ['sora-2'],
    })
  })
})
