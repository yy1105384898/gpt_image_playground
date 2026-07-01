export type PlaygroundApiFormat = 'openai' | 'gemini'

export interface PlaygroundModelChannel {
  id: string
  name: string
  apiFormat: PlaygroundApiFormat
  baseUrl: string
  apiKey: string
  models: string[]
}

export const PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY = 'yy-image-pro.model-channels.v1'

export const DEFAULT_PLAYGROUND_MODEL_CHANNELS: PlaygroundModelChannel[] = [
  {
    id: 'newapi',
    name: 'NewAPI',
    apiFormat: 'openai',
    baseUrl: 'https://yynewapi.yangyangnj.top/v1',
    apiKey: '',
    models: [],
  },
  {
    id: 'subapi',
    name: 'SubAPI',
    apiFormat: 'openai',
    baseUrl: 'https://yysubapi.yangyangnj.top/v1',
    apiKey: '',
    models: [],
  },
]

function newChannelId() {
  return `channel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizePlaygroundBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || '').trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? pathSegments
        : ['v1']
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`.replace(/\/+$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

function uniqueModels(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  return Array.from(new Set(
    models
      .map((model) => (typeof model === 'string' ? model.trim() : ''))
      .filter(Boolean),
  ))
}

function normalizeApiFormat(value: unknown): PlaygroundApiFormat {
  return value === 'gemini' ? 'gemini' : 'openai'
}

function normalizeChannel(input: unknown, fallback?: PlaygroundModelChannel): PlaygroundModelChannel | null {
  if (!input || typeof input !== 'object') return fallback ?? null
  const record = input as Record<string, unknown>
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim().replace(/\/+$/, '') : fallback?.baseUrl ?? ''
  if (!baseUrl && !fallback?.baseUrl) return null
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallback?.id ?? newChannelId()
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallback?.name ?? '未命名渠道'
  return {
    id,
    name,
    apiFormat: normalizeApiFormat(record.apiFormat ?? fallback?.apiFormat),
    baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : fallback?.apiKey ?? '',
    models: uniqueModels(record.models ?? fallback?.models ?? []),
  }
}

function normalizeChannels(input: unknown): PlaygroundModelChannel[] {
  if (!Array.isArray(input)) return DEFAULT_PLAYGROUND_MODEL_CHANNELS
  const seen = new Set<string>()
  const channels = input
    .map((item) => normalizeChannel(item))
    .filter((channel): channel is PlaygroundModelChannel => Boolean(channel))
    .map((channel) => {
      let id = channel.id
      while (seen.has(id)) id = newChannelId()
      seen.add(id)
      return { ...channel, id }
    })
  return channels.length ? channels : DEFAULT_PLAYGROUND_MODEL_CHANNELS
}

export function createPlaygroundModelChannel(patch: Partial<PlaygroundModelChannel> = {}): PlaygroundModelChannel {
  return normalizeChannel({
    id: newChannelId(),
    name: patch.name ?? '新渠道',
    apiFormat: patch.apiFormat ?? 'openai',
    baseUrl: patch.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: patch.apiKey ?? '',
    models: patch.models ?? [],
  })!
}

export function getPlaygroundModelChannels(): PlaygroundModelChannel[] {
  if (typeof window === 'undefined') return DEFAULT_PLAYGROUND_MODEL_CHANNELS
  try {
    const saved = window.localStorage.getItem(PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY)
    if (!saved) return DEFAULT_PLAYGROUND_MODEL_CHANNELS
    return normalizeChannels(JSON.parse(saved))
  } catch {
    return DEFAULT_PLAYGROUND_MODEL_CHANNELS
  }
}

export function savePlaygroundModelChannels(channels: PlaygroundModelChannel[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY, JSON.stringify(normalizeChannels(channels)))
}

export function getPlaygroundModelChannelTarget(channel: PlaygroundModelChannel): string {
  return normalizePlaygroundBaseUrl(channel.baseUrl)
}

export function getPlaygroundModelChannelRef(channel: PlaygroundModelChannel): string {
  return channel.id
}

export function findPlaygroundModelChannelByTarget(target: string): PlaygroundModelChannel | null {
  const normalizedTarget = normalizePlaygroundBaseUrl(target)
  return getPlaygroundModelChannels().find((channel) => {
    return channel.id === target ||
      channel.baseUrl === target ||
      normalizePlaygroundBaseUrl(channel.baseUrl) === normalizedTarget
  }) ?? null
}

export function resolvePlaygroundModelChannelTarget(target: string): string {
  const channel = findPlaygroundModelChannelByTarget(target)
  return channel ? getPlaygroundModelChannelTarget(channel) : normalizePlaygroundBaseUrl(target)
}

export function getDefaultPlaygroundModelChannelTarget(): string {
  return getPlaygroundModelChannelRef(getPlaygroundModelChannels()[0] ?? DEFAULT_PLAYGROUND_MODEL_CHANNELS[0])
}

export function getPlaygroundModelChannelLabel(target: string): string {
  return findPlaygroundModelChannelByTarget(target)?.name ?? target
}
