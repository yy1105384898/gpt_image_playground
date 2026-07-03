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
import { inferPurposeFromLabel, isModelForPurpose, isModelForPurposeWithHint } from './modelPurpose'

export { inferPurposeFromLabel, isModelForPurpose, isModelForPurposeWithHint } from './modelPurpose'

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

const SELECTED_MODELS_STORAGE_KEY = 'yy-image-pro.selected-models'
const CHANNEL_MODELS_STORAGE_KEY = 'yy-image-pro.channel-model-cache'
const CHANNEL_MODELS_CACHE_TTL_MS = 5 * 60 * 1000
export const MODEL_CATALOG_UPDATED_EVENT = 'yy-model-catalog-updated'

interface StoredChannelModelCache {
  updatedAt: number
  models: string[]
}

function modelIdFromItem(item: unknown): string {
  if (typeof item === 'string') return normalizeModelIdCandidate(item)
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  const record = item as Record<string, unknown>
  for (const key of ['id', 'name', 'model', 'model_id', 'modelId']) {
    const value = record[key]
    const normalized = typeof value === 'string' ? normalizeModelIdCandidate(value) : ''
    if (normalized) return normalized
  }
  return ''
}

const MODEL_CONTAINER_KEYS = new Set(['data', 'models', 'model_list', 'available_models', 'items', 'list', 'result', 'results'])
const NON_MODEL_OBJECT_KEYS = new Set([
  'object',
  'success',
  'message',
  'msg',
  'error',
  'code',
  'status',
  'total',
  'count',
  'page',
  'limit',
])
const MODEL_KEY_HINT_RE = /gpt|claude|gemini|deepseek|qwen|kimi|glm|llama|mistral|grok|doubao|hunyuan|ernie|nova|command|sora|veo|kling|可灵|video|seedance|runway|pika|hailuo|海螺|vidu|wan|t2v|i2v|flux|dall|image|img|imagen|seedream|stable|midjourney|mj|recraft|ideogram|jimeng|即梦|cogview|cogvideo|tts|whisper|embedding|rerank|[-_/.:]\d/i
const NON_MODEL_ID_KEYS = new Set([
  'openai',
  'openai_chat',
  'openai_edit',
  'openai_edits',
  'openai_generation',
  'openai_generations',
  'openai_image',
  'openai_images',
  'gemini',
  'google',
  'anthropic',
  'azure',
  'fal',
  'replicate',
  'chat',
  'chats',
  'text',
  'texts',
  'image',
  'images',
  'video',
  'videos',
  'edit',
  'edits',
  'generation',
  'generations',
  'completion',
  'completions',
  'response',
  'responses',
])

function normalizeModelIdCandidate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, '_')
  if (NON_MODEL_ID_KEYS.has(key)) return ''
  return trimmed
}

function modelIdFromObjectKey(key: string, value: unknown): string {
  const trimmed = key.trim()
  const normalized = trimmed.toLowerCase()
  if (!trimmed || MODEL_CONTAINER_KEYS.has(normalized) || NON_MODEL_OBJECT_KEYS.has(normalized)) return ''
  if (!MODEL_KEY_HINT_RE.test(trimmed)) return ''
  if (value == null) return ''
  return normalizeModelIdCandidate(trimmed)
}

function collectModelIdsFromList(list: unknown[]): string[] {
  return list.map(modelIdFromItem).filter(Boolean)
}

export function extractModelIds(payload: unknown): string[] {
  const ids: string[] = []
  const seenObjects = new Set<object>()
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || value == null) return
    if (Array.isArray(value)) {
      ids.push(...collectModelIdsFromList(value))
      value.forEach((item) => {
        if (item && typeof item === 'object') visit(item, depth + 1)
      })
      return
    }
    if (typeof value !== 'object') return
    if (seenObjects.has(value)) return
    seenObjects.add(value)
    const directId = modelIdFromItem(value)
    if (directId) ids.push(directId)
    const record = value as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase()
      const keyModel = modelIdFromObjectKey(key, child)
      if (keyModel) ids.push(keyModel)
      if (MODEL_CONTAINER_KEYS.has(normalizedKey) || child == null || typeof child === 'object') {
        visit(child, depth + 1)
      }
    }
  }
  visit(payload)
  return Array.from(new Set(ids))
}

function selectedModelsKey(target: string, purpose: PlaygroundApiPurpose) {
  return `${purpose}:${target}`
}

const channelModelCache = new Map<string, string[]>()
const channelModelInflight = new Map<string, Promise<string[]>>()

function channelModelsKey(target: string) {
  return `all:${target}`
}

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
  return readSelectedModelsState()[target]?.[purpose]?.filter(Boolean) ?? []
}

export function hasSelectedModelsConfig(target: string, purpose: PlaygroundApiPurpose): boolean {
  return Array.isArray(readSelectedModelsState()[target]?.[purpose])
}

export function setSelectedModels(target: string, purpose: PlaygroundApiPurpose, models: string[]) {
  if (typeof window === 'undefined') return
  const state = readSelectedModelsState()
  state[target] = {
    ...(state[target] ?? {}),
    [purpose]: Array.from(new Set(models.filter(Boolean))),
  }
  window.localStorage.setItem(SELECTED_MODELS_STORAGE_KEY, JSON.stringify(state))
  invalidateModelCatalogCache(purpose)
}

export function getDefaultSelectedModels(models: string[], purpose: PlaygroundApiPurpose): string[] {
  return Array.from(new Set(models.filter(Boolean)))
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

function tokenForTarget(target: string): string {
  const channel = findPlaygroundModelChannelByTarget(target)
  if (channel?.apiKey.trim()) return channel.apiKey.trim()
  for (const purpose of ['image', 'video', 'text'] as const) {
    const token = tokenForTargetPurpose(target, purpose)
    if (token.trim()) return token
  }
  return ''
}

async function fetchChannelModels(target: string): Promise<string[]> {
  const profile = profileForPurpose('image') ?? profileForPurpose('video') ?? profileForPurpose('text')
  const apiTarget = resolvePlaygroundModelChannelTarget(target)
  const auth = authHeader(tokenForTarget(target) || profile?.apiKey || '')
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile?.apiProxy ?? true, proxyConfig)
  const headers: Record<string, string> = {
    'X-YY-API-Target': apiTarget,
  }
  if (auth) headers.Authorization = auth
  const requestModels = async (url: string) => {
    const resp = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = await resp.json()
    return extractModelIds(json)
  }
  try {
    const models = await requestModels(buildApiUrl(apiTarget, 'models', proxyConfig, false))
    if (models.length) return models
  } catch {
    // Browser CORS or endpoint restrictions can block direct model reads; try the hosted proxy below.
  }
  if (useApiProxy) {
    try {
      const models = await requestModels(buildApiUrl(apiTarget, 'models', proxyConfig, true))
      if (models.length) return models
    } catch {
      // Hosted Flask helper below understands NewAPI/SubAPI routing and is kept as a fallback.
    }
  }
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+/g, '/').startsWith('/playground/')) {
    try {
      const resp = await fetch('/api/playground/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          connection_mode: 'custom',
          model_kind: 'all',
          api_url: apiTarget,
          api_key: auth.replace(/^Bearer\s+/i, ''),
        }),
      })
      if (resp.ok) {
        const json = await resp.json()
        const list = json?.models
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

export async function getChannelModelList(target: string, force = false): Promise<string[]> {
  const rawKey = channelModelsKey(target)
  const channel = findPlaygroundModelChannelByTarget(target)
  if (!force && channel?.models.length) return channel.models
  if (!force && channelModelCache.has(rawKey)) {
    return channelModelCache.get(rawKey)!
  }
  if (!force) {
    const stored = readStoredChannelModels(rawKey)
    if (stored) {
      channelModelCache.set(rawKey, stored)
      return stored
    }
  }
  if (!force && channelModelInflight.has(rawKey)) return channelModelInflight.get(rawKey)!
  const rawTask = (async () => {
    try {
      const all = await fetchChannelModels(target)
      channelModelCache.set(rawKey, all)
      writeStoredChannelModels(rawKey, all)
      return all
    } finally {
      channelModelInflight.delete(rawKey)
    }
  })()
  channelModelInflight.set(rawKey, rawTask)
  return rawTask
}

export async function getChannelModels(target: string, purpose: PlaygroundApiPurpose, force = false): Promise<string[]> {
  const key = selectedModelsKey(target, purpose)
  if (!force && channelModelCache.has(key)) return channelModelCache.get(key)!
  const all = await getChannelModelList(target, force)
  const hint = inferPurposeFromLabel(findPlaygroundModelChannelByTarget(target)?.name ?? '')
  const models = all.filter((model) => isModelForPurposeWithHint(model, purpose, hint))
  channelModelCache.set(key, models)
  return models
}

const cache = new Map<PlaygroundApiPurpose, ModelGroup[]>()
const inflight = new Map<PlaygroundApiPurpose, Promise<ModelGroup[]>>()

export function invalidateModelCatalogCache(purpose?: PlaygroundApiPurpose) {
  channelModelCache.clear()
  channelModelInflight.clear()
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
          const hint = inferPurposeFromLabel(channel.name)
          const selected = getSelectedModels(target, purpose)
          const allowed = hasSelectedModelsConfig(target, purpose)
            ? allModels.filter((id) => selected.includes(id) && isModelForPurposeWithHint(id, purpose, hint))
            : allModels.filter((id) => isModelForPurposeWithHint(id, purpose, hint))
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
