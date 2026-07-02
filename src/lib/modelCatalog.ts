// Reads the actually-available models from each configured channel (厂商)
// via the relay's /v1/models endpoint, grouped by channel and filtered by
// purpose (image / video / text). Falls back to a static list when the
// relay can't be reached.
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  buildApiUrl,
  readClientDevProxyConfig,
  shouldUseApiProxy,
  type PlaygroundApiPurpose,
} from './devProxy'
import {
  findPlaygroundModelChannelByTarget,
  getPlaygroundModelChannelRef,
  getPlaygroundModelChannelTarget,
  getPlaygroundModelChannels,
  resolvePlaygroundModelChannelTarget,
} from './playgroundChannels'
import { getStoredPlaygroundPurposeConfig } from './playgroundPurposeConfig'
import { getTokenVaultItems } from './tokenVault'

export interface ModelGroup {
  id: string
  label: string
  target: string
  models: string[]
}

type SelectedModelsState = Record<string, Partial<Record<PlaygroundApiPurpose, string[]>>>

const SIMPLIFIED_PROFILE_IDS: Record<PlaygroundApiPurpose, string> = {
  text: 'yy-text-profile',
  image: 'yy-image-profile',
  video: 'yy-video-profile',
}

const VIDEO_RE = /video|sora|kling|veo|seedance|runway|pika|hailuo|vidu|wan2|minimax-video/i
const IMAGE_RE = /image|flux|dall[-_ ]?e|imagen|nano[-_ ]?banana|banana|qwen.*image|stable|\bsd\d|midjourney|\bmj\b|recraft|ideogram|seedream|kolors|hunyuan.*image|grok.*image/i
const AUDIO_RE = /audio|tts|speech|voice|music|sound/i
const SELECTED_MODELS_STORAGE_KEY = 'yy-image-pro.selected-models'
const CHANNEL_MODELS_STORAGE_KEY = 'yy-image-pro.channel-model-cache'
const CHANNEL_MODELS_CACHE_TTL_MS = 5 * 60 * 1000
export const MODEL_CATALOG_UPDATED_EVENT = 'yy-model-catalog-updated'

interface StoredChannelModelCache {
  updatedAt: number
  models: string[]
}

function selectedModelsKey(target: string, purpose: PlaygroundApiPurpose) {
  return `${purpose}:${target}`
}

const channelModelCache = new Map<string, string[]>()
const channelModelInflight = new Map<string, Promise<string[]>>()

function readStoredChannelModels(key: string): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHANNEL_MODELS_STORAGE_KEY) || '{}') as Record<string, StoredChannelModelCache>
    const item = parsed?.[key]
    if (!item || Date.now() - item.updatedAt > CHANNEL_MODELS_CACHE_TTL_MS) return null
    return Array.isArray(item.models) ? item.models.filter(Boolean) : null
  } catch {
    return null
  }
}

function writeStoredChannelModels(key: string, models: string[]) {
  if (typeof window === 'undefined') return
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHANNEL_MODELS_STORAGE_KEY) || '{}') as Record<string, StoredChannelModelCache>
    parsed[key] = { updatedAt: Date.now(), models }
    window.localStorage.setItem(CHANNEL_MODELS_STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // localStorage 满或禁用时保留内存缓存即可。
  }
}

function readSelectedModelsState(): SelectedModelsState {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SELECTED_MODELS_STORAGE_KEY) || '{}') as SelectedModelsState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function getSelectedModels(target: string, purpose: PlaygroundApiPurpose): string[] {
  return readSelectedModelsState()[target]?.[purpose]?.filter((model) => Boolean(model) && isModelForPurpose(model, purpose)) ?? []
}

export function hasSelectedModelsConfig(target: string, purpose: PlaygroundApiPurpose): boolean {
  return Array.isArray(readSelectedModelsState()[target]?.[purpose])
}

export function setSelectedModels(target: string, purpose: PlaygroundApiPurpose, models: string[]) {
  if (typeof window === 'undefined') return
  const state = readSelectedModelsState()
  state[target] = {
    ...(state[target] ?? {}),
    [purpose]: Array.from(new Set(models.filter((model) => Boolean(model) && isModelForPurpose(model, purpose)))),
  }
  window.localStorage.setItem(SELECTED_MODELS_STORAGE_KEY, JSON.stringify(state))
  invalidateModelCatalogCache(purpose)
}

export function isModelForPurpose(id: string, purpose: PlaygroundApiPurpose): boolean {
  const lower = id.toLowerCase()
  if (purpose === 'video') return VIDEO_RE.test(lower)
  if (purpose === 'image') return !VIDEO_RE.test(lower) && !AUDIO_RE.test(lower) && IMAGE_RE.test(lower)
  // text: anything that isn't clearly an image or video model
  return !VIDEO_RE.test(lower) && !IMAGE_RE.test(lower) && !AUDIO_RE.test(lower)
}

export function getDefaultSelectedModels(models: string[], purpose: PlaygroundApiPurpose): string[] {
  return models.filter((model) => isModelForPurpose(model, purpose))
}

function authHeader(apiKey: string): string {
  const key = apiKey.trim().replace(/^bearer\s+/i, '').trim()
  return key ? `Bearer ${key}` : ''
}

function profileForPurpose(purpose: PlaygroundApiPurpose) {
  const { settings } = useStore.getState()
  return (
    settings.profiles.find((p) => p.id === SIMPLIFIED_PROFILE_IDS[purpose]) ??
    settings.profiles.find((p) => p.id === settings.activeProfileId)
  )
}

function tokenForTargetPurpose(target: string, purpose: PlaygroundApiPurpose): string {
  const stored = getStoredPlaygroundPurposeConfig(target, purpose)
  if (stored.apiKey?.trim()) return stored.apiKey
  const items = getTokenVaultItems(target)
  const matcher = purpose === 'text'
    ? /chat|对话|文本/i
    : purpose === 'image'
      ? /生图|图片|image|images/i
      : /视频|video/i
  const matchedToken = items.find((item) => matcher.test(item.name))?.token
  if (matchedToken) return matchedToken
  if (items.length === 1) return items[0].token
  const channel = findPlaygroundModelChannelByTarget(target)
  return channel?.apiKey.trim() ?? ''
}

async function fetchChannelModels(target: string, purpose: PlaygroundApiPurpose): Promise<string[]> {
  const profile = profileForPurpose(purpose)
  const apiTarget = resolvePlaygroundModelChannelTarget(target)
  const auth = authHeader(tokenForTargetPurpose(target, purpose) || profile?.apiKey || '')
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile?.apiProxy ?? true, proxyConfig)
  const url = buildApiUrl(apiTarget, 'models', proxyConfig, useApiProxy)
  const headers: Record<string, string> = {
    'X-YY-API-Target': apiTarget,
    'X-YY-API-Purpose': purpose,
  }
  if (auth) headers.Authorization = auth
  try {
    const resp = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = await resp.json()
    const list: unknown[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
    const ids = list
      .map((item) => (typeof item === 'string' ? item : typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : ''))
      .filter(Boolean)
    const models = Array.from(new Set(ids))
    if (models.length) return models
  } catch {
    // Hosted Flask helper below understands NewAPI/SubAPI routing and is kept as a fallback.
  }
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+/g, '/').startsWith('/playground/')) {
    try {
      const resp = await fetch('/api/playground/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          connection_mode: 'custom',
          model_kind: purpose,
          api_url: apiTarget,
          api_key: auth.replace(/^Bearer\s+/i, ''),
        }),
      })
      if (resp.ok) {
        const json = await resp.json()
        const keyed = purpose === 'image'
          ? json?.image_models
          : purpose === 'text'
            ? json?.text_models
            : json?.video_models
        const list = Array.isArray(keyed) && keyed.length ? keyed : json?.models
        if (Array.isArray(list)) {
          return Array.from(new Set(list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
        }
      }
    } catch {
      // Fall back to the OpenAI-compatible /models endpoint below.
    }
  }
  return []
}

export async function getChannelModels(target: string, purpose: PlaygroundApiPurpose, force = false): Promise<string[]> {
  const key = selectedModelsKey(target, purpose)
  const channel = findPlaygroundModelChannelByTarget(target)
  if (!force && channel?.models.length) return channel.models
  if (!force && channelModelCache.has(key)) return channelModelCache.get(key)!
  if (!force) {
    const stored = readStoredChannelModels(key)
    if (stored) {
      channelModelCache.set(key, stored)
      return stored
    }
  }
  if (!force && channelModelInflight.has(key)) return channelModelInflight.get(key)!
  const task = (async () => {
    try {
      const all = await fetchChannelModels(target, purpose)
      channelModelCache.set(key, all)
      writeStoredChannelModels(key, all)
      return all
    } finally {
      channelModelInflight.delete(key)
    }
  })()
  channelModelInflight.set(key, task)
  return task
}

const cache = new Map<PlaygroundApiPurpose, ModelGroup[]>()
const inflight = new Map<PlaygroundApiPurpose, Promise<ModelGroup[]>>()

export function invalidateModelCatalogCache(purpose?: PlaygroundApiPurpose) {
  if (purpose) {
    cache.delete(purpose)
    inflight.delete(purpose)
  } else {
    cache.clear()
    inflight.clear()
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MODEL_CATALOG_UPDATED_EVENT, { detail: { purpose } }))
  }
}

export async function getModelGroups(purpose: PlaygroundApiPurpose, force = false): Promise<ModelGroup[]> {
  if (!force && cache.has(purpose)) return cache.get(purpose)!
  if (!force && inflight.has(purpose)) return inflight.get(purpose)!
  const task = (async () => {
    const channels = getPlaygroundModelChannels()
    const results = await Promise.all(
      channels.map(async (channel) => {
        const target = getPlaygroundModelChannelRef(channel)
        try {
          const allModels = await getChannelModels(target, purpose, force)
          const selected = getSelectedModels(target, purpose)
          const allowed = hasSelectedModelsConfig(target, purpose)
            ? allModels.filter((id) => selected.includes(id) && isModelForPurpose(id, purpose))
            : allModels.filter((id) => isModelForPurpose(id, purpose))
          return { id: channel.id, label: channel.name, target, models: allowed }
        } catch {
          return { id: channel.id, label: channel.name, target, models: [] }
        }
      }),
    )
    const groups = results.map((group) => ({
      ...group,
      models: group.models,
    }))
    cache.set(purpose, groups)
    inflight.delete(purpose)
    return groups
  })()
  inflight.set(purpose, task)
  return task
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Dev-only handle so the grouping/classify pipeline can be exercised in tests.
  ;(window as unknown as { __getModelGroups?: typeof getModelGroups }).__getModelGroups = getModelGroups
}

// React hook: returns grouped models for a purpose, loading lazily on mount.
export function useModelGroups(purpose: PlaygroundApiPurpose, enabled = true) {
  const [groups, setGroups] = useState<ModelGroup[]>(() => cache.get(purpose) ?? [])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = (force = false) => {
      if (!force && cache.has(purpose)) {
        setGroups(cache.get(purpose)!)
        return
      }
      setLoading(true)
      getModelGroups(purpose, force)
        .then((g) => { if (!cancelled) setGroups(g) })
        .catch(() => { if (!cancelled) setGroups([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    const onCatalogUpdated = (event: Event) => {
      const detailPurpose = (event as CustomEvent<{ purpose?: PlaygroundApiPurpose }>).detail?.purpose
      if (!detailPurpose || detailPurpose === purpose) load(true)
    }
    window.addEventListener(MODEL_CATALOG_UPDATED_EVENT, onCatalogUpdated)
    load()
    return () => {
      cancelled = true
      window.removeEventListener(MODEL_CATALOG_UPDATED_EVENT, onCatalogUpdated)
    }
  }, [purpose, enabled])

  const refresh = () => {
    setLoading(true)
    getModelGroups(purpose, true)
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }

  return { groups, loading, refresh }
}
