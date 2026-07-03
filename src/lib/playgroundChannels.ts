import { uniqueModelIds } from './modelIds'

export type PlaygroundApiFormat = 'openai' | 'gemini'

export interface PlaygroundModelChannelKey {
  id: string
  name: string
  apiKey: string
  models: string[]
}

export interface PlaygroundModelChannel {
  id: string
  name: string
  apiFormat: PlaygroundApiFormat
  baseUrl: string
  apiKey: string
  models: string[]
  apiKeys: PlaygroundModelChannelKey[]
}

export const PLAYGROUND_MODEL_CHANNELS_STORAGE_KEY = 'yy-image-pro.model-channels.v1'
export const PLAYGROUND_MODEL_CHANNEL_KEY_SEPARATOR = '::yy-key::'

export const DEFAULT_PLAYGROUND_MODEL_CHANNELS: PlaygroundModelChannel[] = [
  {
    id: 'newapi',
    name: 'YY NewAPI',
    apiFormat: 'openai',
    baseUrl: 'https://yynewapi.yangyangnj.top/v1',
    apiKey: '',
    models: [],
    apiKeys: [{ id: 'default', name: '默认令牌', apiKey: '', models: [] }],
  },
  {
    id: 'subapi',
    name: 'YY SubAPI',
    apiFormat: 'openai',
    baseUrl: 'https://yysubapi.yangyangnj.top/v1',
    apiKey: '',
    models: [],
    apiKeys: [{ id: 'default', name: '默认令牌', apiKey: '', models: [] }],
  },
]

export const PROTECTED_PLAYGROUND_MODEL_CHANNEL_IDS = new Set(
  DEFAULT_PLAYGROUND_MODEL_CHANNELS.map((channel) => channel.id),
)

export function isProtectedPlaygroundModelChannel(channelOrId: PlaygroundModelChannel | string): boolean {
  const id = typeof channelOrId === 'string' ? channelOrId : channelOrId.id
  return PROTECTED_PLAYGROUND_MODEL_CHANNEL_IDS.has(id)
}

function getProtectedPlaygroundModelChannel(channelOrId: PlaygroundModelChannel | string): PlaygroundModelChannel | null {
  const id = typeof channelOrId === 'string' ? channelOrId : channelOrId.id
  return DEFAULT_PLAYGROUND_MODEL_CHANNELS.find((channel) => channel.id === id) ?? null
}

export function getProtectedPlaygroundModelChannelBaseUrl(channelOrId: PlaygroundModelChannel | string): string | null {
  return getProtectedPlaygroundModelChannel(channelOrId)?.baseUrl ?? null
}

function newChannelId() {
  return `channel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function newChannelKeyId() {
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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
  return uniqueModelIds(models)
}

function normalizeApiFormat(value: unknown): PlaygroundApiFormat {
  return value === 'gemini' ? 'gemini' : 'openai'
}

function normalizeChannelKey(input: unknown, index: number, fallback?: Partial<PlaygroundModelChannelKey>): PlaygroundModelChannelKey | null {
  if (!input || typeof input !== 'object') return fallback ? {
    id: fallback.id || (index === 0 ? 'default' : newChannelKeyId()),
    name: fallback.name || (index === 0 ? '默认令牌' : `令牌 ${index + 1}`),
    apiKey: fallback.apiKey ?? '',
    models: uniqueModels(fallback.models ?? []),
  } : null
  const record = input as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : fallback?.id || (index === 0 ? 'default' : newChannelKeyId())
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : fallback?.name || (index === 0 ? '默认令牌' : `令牌 ${index + 1}`)
  return {
    id,
    name,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : fallback?.apiKey ?? '',
    models: uniqueModels(record.models ?? fallback?.models ?? []),
  }
}

function normalizeChannelKeys(record: Record<string, unknown>, fallback?: PlaygroundModelChannel): PlaygroundModelChannelKey[] {
  const legacyApiKey = typeof record.apiKey === 'string' ? record.apiKey : fallback?.apiKey ?? ''
  const legacyModels = uniqueModels(record.models ?? fallback?.models ?? [])
  const rawKeys = Array.isArray(record.apiKeys)
    ? record.apiKeys
    : Array.isArray(record.keys)
      ? record.keys
      : []
  const sourceKeys = rawKeys.length
    ? rawKeys
    : [{ id: 'default', name: '默认令牌', apiKey: legacyApiKey, models: legacyModels }]
  const seen = new Set<string>()
  return sourceKeys
    .map((item, index) => normalizeChannelKey(item, index))
    .filter((item): item is PlaygroundModelChannelKey => Boolean(item))
    .map((item, index) => {
      let id = item.id || (index === 0 ? 'default' : newChannelKeyId())
      while (seen.has(id)) id = newChannelKeyId()
      seen.add(id)
      return { ...item, id }
    })
}

function normalizeChannel(input: unknown, fallback?: PlaygroundModelChannel): PlaygroundModelChannel | null {
  if (!input || typeof input !== 'object') return fallback ?? null
  const record = input as Record<string, unknown>
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim().replace(/\/+$/, '') : fallback?.baseUrl ?? ''
  if (!baseUrl && !fallback?.baseUrl) return null
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallback?.id ?? newChannelId()
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallback?.name ?? '未命名渠道'
  const apiKeys = normalizeChannelKeys(record, fallback)
  const primaryKey = apiKeys[0] ?? { id: 'default', name: '默认令牌', apiKey: '', models: [] }
  return {
    id,
    name,
    apiFormat: normalizeApiFormat(record.apiFormat ?? fallback?.apiFormat),
    baseUrl,
    apiKey: primaryKey.apiKey,
    models: primaryKey.models,
    apiKeys: apiKeys.length ? apiKeys : [primaryKey],
  }
}

function mergeProtectedChannel(defaultChannel: PlaygroundModelChannel, channels: PlaygroundModelChannel[]): PlaygroundModelChannel {
  const saved = channels.find((channel) => channel.id === defaultChannel.id)
  return {
    ...defaultChannel,
    name: saved?.name?.trim() || defaultChannel.name,
    apiFormat: saved?.apiFormat ?? defaultChannel.apiFormat,
    apiKey: saved?.apiKey ?? defaultChannel.apiKey,
    models: uniqueModels(saved?.models ?? defaultChannel.models),
    apiKeys: saved?.apiKeys?.length ? saved.apiKeys : defaultChannel.apiKeys,
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
  const protectedChannels = DEFAULT_PLAYGROUND_MODEL_CHANNELS.map((defaultChannel) => mergeProtectedChannel(defaultChannel, channels))
  const customChannels = channels.filter((channel) => !isProtectedPlaygroundModelChannel(channel))
  return [...protectedChannels, ...customChannels]
}

export function createPlaygroundModelChannel(patch: Partial<PlaygroundModelChannel> = {}): PlaygroundModelChannel {
  return normalizeChannel({
    id: newChannelId(),
    name: patch.name ?? '新渠道',
    apiFormat: patch.apiFormat ?? 'openai',
    baseUrl: patch.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: patch.apiKey ?? '',
    models: patch.models ?? [],
    apiKeys: patch.apiKeys,
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

export function getPrimaryPlaygroundModelChannelKey(channel: PlaygroundModelChannel): PlaygroundModelChannelKey {
  return channel.apiKeys[0] ?? { id: 'default', name: '默认令牌', apiKey: channel.apiKey, models: channel.models }
}

export function createPlaygroundModelChannelKey(index = 0, patch: Partial<PlaygroundModelChannelKey> = {}): PlaygroundModelChannelKey {
  return normalizeChannelKey({
    id: patch.id ?? (index === 0 ? 'default' : newChannelKeyId()),
    name: patch.name ?? (index === 0 ? '默认令牌' : `令牌 ${index + 1}`),
    apiKey: patch.apiKey ?? '',
    models: patch.models ?? [],
  }, index)!
}

export function getPlaygroundModelChannelKeyRef(channel: PlaygroundModelChannel, key: PlaygroundModelChannelKey): string {
  return key.id === getPrimaryPlaygroundModelChannelKey(channel).id
    ? channel.id
    : `${channel.id}${PLAYGROUND_MODEL_CHANNEL_KEY_SEPARATOR}${key.id}`
}

function parsePlaygroundModelChannelKeyRef(target: string): { channelId: string; keyId: string } | null {
  const separatorIndex = target.indexOf(PLAYGROUND_MODEL_CHANNEL_KEY_SEPARATOR)
  if (separatorIndex < 0) return null
  const channelId = target.slice(0, separatorIndex)
  const keyId = target.slice(separatorIndex + PLAYGROUND_MODEL_CHANNEL_KEY_SEPARATOR.length)
  return channelId && keyId ? { channelId, keyId } : null
}

export interface PlaygroundModelChannelBinding {
  id: string
  label: string
  target: string
  channel: PlaygroundModelChannel
  key: PlaygroundModelChannelKey
  apiKey: string
  models: string[]
  isPrimary: boolean
}

export function getPlaygroundModelChannelBindings(channels: PlaygroundModelChannel[] = getPlaygroundModelChannels()): PlaygroundModelChannelBinding[] {
  return channels.flatMap((channel) => {
    const primaryKey = getPrimaryPlaygroundModelChannelKey(channel)
    const multiple = channel.apiKeys.length > 1
    return channel.apiKeys.map((key) => {
      const isPrimary = key.id === primaryKey.id
      const target = getPlaygroundModelChannelKeyRef(channel, key)
      return {
        id: target,
        label: multiple ? `${channel.name} / ${key.name}` : channel.name,
        target,
        channel,
        key,
        apiKey: key.apiKey,
        models: key.models,
        isPrimary,
      }
    })
  })
}

export function findPlaygroundModelChannelBindingByTarget(target: string): PlaygroundModelChannelBinding | null {
  const requested = String(target || '').trim()
  const normalizedTarget = normalizePlaygroundBaseUrl(requested)
  const bindings = getPlaygroundModelChannelBindings()
  const parsed = parsePlaygroundModelChannelKeyRef(requested)
  if (parsed) {
    const exact = bindings.find((binding) => binding.channel.id === parsed.channelId && binding.key.id === parsed.keyId)
    if (exact) return exact
  }
  return bindings.find((binding) => {
    return binding.target === requested ||
      binding.channel.id === requested ||
      binding.channel.baseUrl === requested ||
      normalizePlaygroundBaseUrl(binding.channel.baseUrl) === normalizedTarget
  }) ?? null
}

export function findPlaygroundModelChannelByTarget(target: string): PlaygroundModelChannel | null {
  return findPlaygroundModelChannelBindingByTarget(target)?.channel ?? null
}

export function getPlaygroundModelChannelApiKey(target: string): string {
  return findPlaygroundModelChannelBindingByTarget(target)?.apiKey.trim() ?? ''
}

export function getPlaygroundModelChannelModels(target: string): string[] {
  return findPlaygroundModelChannelBindingByTarget(target)?.models ?? []
}

export function normalizePlaygroundModelChannelTargetRef(target: string): string {
  return findPlaygroundModelChannelBindingByTarget(target)?.target ?? normalizePlaygroundBaseUrl(target)
}

export function resolvePlaygroundModelChannelTarget(target: string): string {
  const binding = findPlaygroundModelChannelBindingByTarget(target)
  return binding ? getPlaygroundModelChannelTarget(binding.channel) : normalizePlaygroundBaseUrl(target)
}

export function getDefaultPlaygroundModelChannelTarget(): string {
  return getPlaygroundModelChannelBindings()[0]?.target ?? getPlaygroundModelChannelRef(getPlaygroundModelChannels()[0] ?? DEFAULT_PLAYGROUND_MODEL_CHANNELS[0])
}

export function getPlaygroundModelChannelLabel(target: string): string {
  return findPlaygroundModelChannelBindingByTarget(target)?.label ?? target
}
