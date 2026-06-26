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

const SIMPLIFIED_PROFILE_IDS: Record<PlaygroundApiPurpose, string> = {
  text: 'yy-text-profile',
  image: 'yy-image-profile',
  video: 'yy-video-profile',
}

const VIDEO_RE = /video|sora|kling|veo|seedance|runway|pika|hailuo|vidu|wan2|minimax-video/i
const IMAGE_RE = /image|flux|dall[-_ ]?e|imagen|nano[-_ ]?banana|banana|qwen.*image|stable|\bsd\d|midjourney|\bmj\b|recraft|ideogram|seedream|kolors|hunyuan.*image|grok.*image/i

function classify(id: string, purpose: PlaygroundApiPurpose): boolean {
  const lower = id.toLowerCase()
  if (purpose === 'video') return VIDEO_RE.test(lower)
  if (purpose === 'image') return !VIDEO_RE.test(lower) && IMAGE_RE.test(lower)
  // text: anything that isn't clearly an image or video model
  return !VIDEO_RE.test(lower) && !IMAGE_RE.test(lower)
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

const cache = new Map<PlaygroundApiPurpose, ModelGroup[]>()
const inflight = new Map<PlaygroundApiPurpose, Promise<ModelGroup[]>>()

export async function getModelGroups(purpose: PlaygroundApiPurpose, force = false): Promise<ModelGroup[]> {
  if (!force && cache.has(purpose)) return cache.get(purpose)!
  if (!force && inflight.has(purpose)) return inflight.get(purpose)!
  const task = (async () => {
    const results = await Promise.all(
      PLAYGROUND_API_CHANNELS.map(async (channel) => {
        try {
          const all = await fetchChannelModels(channel.target, purpose)
          const filtered = all.filter((id) => classify(id, purpose))
          return { id: channel.id, label: channel.label, target: channel.target, models: filtered }
        } catch {
          return { id: channel.id, label: channel.label, target: channel.target, models: [] }
        }
      }),
    )
    const groups = results.filter((g) => g.models.length > 0)
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
