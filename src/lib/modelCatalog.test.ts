import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY } from './playgroundChannels'
import { extractModelIds, getChannelModels, getSelectedModels, setSelectedModels } from './modelCatalog'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
    location: { pathname: '/' },
    dispatchEvent: vi.fn(),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('model catalog', () => {
  it('extracts model ids from common relay response shapes', () => {
    const ids = extractModelIds({
      models: ['sora-2'],
      data: {
        models: [{ id: 'veo-3.0-generate-preview' }],
      },
      result: {
        data: [{ model: 'jimeng-vgfm' }],
      },
    })
    expect(ids).toEqual(expect.arrayContaining(['sora-2', 'veo-3.0-generate-preview', 'jimeng-vgfm']))
    expect(ids).toHaveLength(3)
  })

  it('ignores provider and endpoint names returned beside real models', () => {
    const ids = extractModelIds({
      data: [
        { name: 'openai' },
        { name: 'gemini' },
        { name: 'openai_edit' },
        { id: 'gpt-image-2' },
      ],
      result: {
        openai_generations: { enabled: true },
        'flux-pro-2': { enabled: true },
      },
    })

    expect(ids).toEqual(expect.arrayContaining(['gpt-image-2', 'flux-pro-2']))
    expect(ids).not.toEqual(expect.arrayContaining(['openai', 'gemini', 'openai_edit', 'openai_generations']))
  })

  it('fetches the real channel model list once without purpose routing and filters locally', async () => {
    stubLocalStorage({
      [PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'newapi',
          name: 'YY NewAPI',
          apiFormat: 'openai',
          baseUrl: 'https://yynewapi.yangyangnj.top/v1',
          apiKey: 'channel-key',
          models: [],
        },
      ]),
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'flux-pro-2' },
          { id: 'sora-2' },
          { id: 'gpt-4.1' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const models = await getChannelModels('newapi', 'video', true)

    expect(models).toEqual(['sora-2'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer channel-key',
      'X-YY-API-Target': 'https://yynewapi.yangyangnj.top/v1',
    })
    expect(init.headers).not.toHaveProperty('X-YY-API-Purpose')
  })

  it('sanitizes stale selected model settings', () => {
    stubLocalStorage()

    setSelectedModels('newapi', 'image', ['openai', 'gpt-image-2', 'gemini', 'openai_generations'])

    expect(getSelectedModels('newapi', 'image')).toEqual(['gpt-image-2'])
  })
})
