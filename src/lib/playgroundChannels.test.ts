import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PLAYGROUND_MODEL_CHANNELS,
  PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY,
  findPlaygroundModelChannelBindingByTarget,
  getPlaygroundModelChannels,
  getPlaygroundModelChannelApiKey,
  getPlaygroundModelChannelBindings,
  getPlaygroundModelChannelKeyRef,
  getPlaygroundModelChannelModels,
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

  it('keeps custom channels that share a protected relay url', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'newapi',
          name: '生图',
          apiFormat: 'openai',
          baseUrl: 'https://yynewapi.yangyangnj.top/v1',
          apiKey: 'built-in-key',
          models: ['flux-pro-2'],
        },
        {
          id: 'channel-3',
          name: '渠道 3',
          apiFormat: 'openai',
          baseUrl: 'https://yynewapi.yangyangnj.top/v1',
          apiKey: 'custom-key',
          models: ['gpt-image-2'],
        },
      ]),
    })

    const channels = getPlaygroundModelChannels()

    expect(channels.slice(0, 2).every(isProtectedPlaygroundModelChannel)).toBe(true)
    expect(channels[0]).toMatchObject({
      id: 'newapi',
      baseUrl: 'https://yynewapi.yangyangnj.top/v1',
      apiKey: 'built-in-key',
      models: ['flux-pro-2'],
    })
    expect(channels[2]).toMatchObject({
      id: 'channel-3',
      baseUrl: 'https://yynewapi.yangyangnj.top/v1',
      apiKey: 'custom-key',
      models: ['gpt-image-2'],
    })
  })

  it('migrates a legacy channel api key into the default token', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'image-channel',
          name: '生图',
          apiFormat: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'legacy-key',
          models: ['gpt-image-2'],
        },
      ]),
    })

    const channel = getPlaygroundModelChannels()[2]
    const bindings = getPlaygroundModelChannelBindings([channel])

    expect(channel.apiKeys).toEqual([
      { id: 'default', name: '默认令牌', apiKey: 'legacy-key', models: ['gpt-image-2'] },
    ])
    expect(bindings[0]).toMatchObject({
      target: 'image-channel',
      apiKey: 'legacy-key',
      models: ['gpt-image-2'],
    })
  })

  it('keeps models and api keys isolated per channel token', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'image-channel',
          name: '中转',
          apiFormat: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKeys: [
            { id: 'default', name: '生图', apiKey: 'image-key', models: ['gpt-image-2'] },
            { id: 'video-key', name: '视频', apiKey: 'video-key', models: ['sora-2'] },
          ],
        },
      ]),
    })

    const channel = getPlaygroundModelChannels()[2]
    const videoTarget = getPlaygroundModelChannelKeyRef(channel, channel.apiKeys[1])

    expect(videoTarget).toBe('image-channel::yy-key::video-key')
    expect(getPlaygroundModelChannelApiKey('image-channel')).toBe('image-key')
    expect(getPlaygroundModelChannelModels('image-channel')).toEqual(['gpt-image-2'])
    expect(getPlaygroundModelChannelApiKey(videoTarget)).toBe('video-key')
    expect(getPlaygroundModelChannelModels(videoTarget)).toEqual(['sora-2'])
    expect(findPlaygroundModelChannelBindingByTarget(videoTarget)?.label).toBe('中转 / 视频')
  })

  it('removes provider and endpoint names from saved channel models', () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'image-channel',
          name: '生图',
          apiFormat: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'custom-key',
          models: ['openai', 'gemini', 'openai_edit', 'openai_generations', 'gpt-image-2', 'flux-pro-2'],
        },
      ]),
    })

    const channels = getPlaygroundModelChannels()

    expect(channels[2].models).toEqual(['gpt-image-2', 'flux-pro-2'])
  })
})
