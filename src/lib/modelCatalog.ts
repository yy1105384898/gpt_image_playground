// Reads the actually-available models from each configured channel (厂商)
// via the relay's /v1/models endpoint, grouped by channel and filtered by
// purpose (image / video / text). Falls back to a static list when the
// relay can't be reached.
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  buildApiUrl,
  PLAYGROUND_API_CHANNELS,
  readClientDevProxyConfig,
  shouldUseApiProxy,
  type PlaygroundApiPurpose,
} from './devProxy'

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
const FALLBACK_MODELS: Record<PlaygroundApiPurpose, string[]> = {
  text: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1-mini'],
  image: ['gpt-image-2', 'gpt-image-1', 'dall-e-3', 'flux-kontext-pro'],
  video: ['grok-video-1.0', 'grok-video-1.5', 'veo-3', 'kling-v2.1'],
}
const SELECTED_MODELS_STORAGE_KEY = 'yy-image-pro.selected-models'

function selectedModelsKey(target: string, purpose: PlaygroundApiPurpose) {
  return `${purpose}:${target}`
}

const channelModelCache = new Map<string, string[]>()
const channelModelInflight = new Map<string, Promise<string[]>>()

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

export function setSelectedModels(target: string, purpose: PlaygroundApiPurpose, models: string[]) {
  if (typeof window === 'undefined') return
  const state = readSelectedModelsState()
  state[target] = {
    ...(state[target] ?? {}),
    [purpose]: Array.from(new Set(models.filter(Boolean))),
  }
  window.localStorage.setItem(SELECTED_MODELS_STORAGE_KEY, JSON.stringify(state))
}

function classify(id: string, purpose: PlaygroundApiPurpose): boolean {
  const lower = id.toLowerCase()
  if (purpose === 'video') return VIDEO_RE.test(lower)
  if (purpose === 'image') return !VIDEO_RE.test(lower) && IMAGE_RE.test(lower)
  // text: anything that isn't clearly an image or video model
  return !VIDEO_RE.test(lower) && !IMAGE_RE.test(lower)
}

export function getDefaultSelectedModels(models: string[], purpose: PlaygroundApiPurpose): string[] {
  const selected = models.filter((model) => {
    const lower = model.toLowerCase()
    if (purpose === 'image') return lower.includes('image')
    if (purpose === 'video') return lower.includes('video')
    return !lower.includes('image') && !lower.includes('video')
  })
  return selected.length ? selected : fallbackModels(purpose, []).filter((model) => models.includes(model))
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

async function fetchChannelModels(target: string, purpose: PlaygroundApiPurpose): Promise<string[]> {
  const profile = profileForPurpose(purpose)
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile?.apiProxy ?? true, proxyConfig)
  const url = buildApiUrl(target, 'models', proxyConfig, useApiProxy)
  const headers: Record<string, string> = {
    'X-YY-API-Target': target,
    'X-YY-API-Purpose': purpose,
  }
  const auth = authHeader(profile?.apiKey ?? '')
  if (auth) headers.Authorization = auth
  const resp = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const json = await resp.json()
  const list: unknown[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
  const ids = list
    .map((item) => (typeof item === 'string' ? item : typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : ''))
    .filter(Boolean)
  return Array.from(new Set(ids))
}

export async function getChannelModels(target: string, purpose: PlaygroundApiPurpose, force = false): Promise<string[]> {
  const key = selectedModelsKey(target, purpose)
  if (!force && channelModelCache.has(key)) return channelModelCache.get(key)!
  if (!force && channelModelInflight.has(key)) return channelModelInflight.get(key)!
  const task = (async () => {
    try {
      const all = await fetchChannelModels(target, purpose)
      const models = fallbackModels(purpose, all)
      channelModelCache.set(key, models)
      return models
    } finally {
      channelModelInflight.delete(key)
    }
  })()
  channelModelInflight.set(key, task)
  return task
}

function fallbackModels(purpose: PlaygroundApiPurpose, models: string[]): string[] {
  return Array.from(new Set([
    ...models.filter(Boolean),
    ...FALLBACK_MODELS[purpose],
  ]))
}

const cache = new Map<PlaygroundApiPurpose, ModelGroup[]>()
const inflight = new Map<PlaygroundApiPurpose, Promise<ModelGroup[]>>()

export async function getModelGroups(purpose: PlaygroundApiPurpose, force = false): Promise<ModelGroup[]> {
  if (!force && cache.has(purpose)) return cache.get(purpose)!
  if (!force && inflight.has(purpose)) return inflight.get(purpose)!
  const task = (async () => {
    const results = await Promise.all(
      PLAYGROUND_API_CHANNELS.map(async (channel) => {
        try {
          const allModels = await getChannelModels(channel.target, purpose, force)
          const selected = getSelectedModels(channel.target, purpose)
          const allowed = selected.length ? allModels.filter((id) => selected.includes(id)) : allModels.filter((id) => classify(id, purpose))
          return { id: channel.id, label: channel.label, target: channel.target, models: allowed }
        } catch {
          return { id: channel.id, label: channel.label, target: channel.target, models: fallbackModels(purpose, []) }
        }
      }),
    )
    const groups = results.map((group) => ({
      ...group,
      models: fallbackModels(purpose, group.models),
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
    if (cache.has(purpose)) {
      setGroups(cache.get(purpose)!)
      return
    }
    let cancelled = false
    setLoading(true)
    getModelGroups(purpose)
      .then((g) => { if (!cancelled) setGroups(g) })
      .catch(() => { if (!cancelled) setGroups([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
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
