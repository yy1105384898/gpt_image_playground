// Grok video generation API.
//
// Contract reverse-engineered from the upstream (manxiaobai) build:
//   POST   {base}/videos              (multipart/form-data) -> { id }
//   GET    {base}/videos/{id}         -> { status, ... }   (poll every 5s)
//   GET    {base}/videos/{id}/content -> the video file (auth required)
//
// NOTE: New API's official xAI/Grok channel does NOT support /v1/videos.
// The relay must route grok-video-* to a grok2api-backed OpenAI-compatible
// channel, otherwise the create call fails with "invalid api platform: 48".

import { useStore } from '../store'
import { buildApiUrl, getProxyRequestHeaders, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import type { ApiProfile } from '../types'

export const VIDEO_MODELS = ['grok-video-1.0', 'grok-video-1.5'] as const
export const VIDEO_DURATIONS = [6, 8, 10, 12, 15] as const
export const VIDEO_ASPECTS = [
  { value: '9:16', label: '9:16 竖屏', size: '720x1280' },
  { value: '16:9', label: '16:9 横屏', size: '1280x720' },
  { value: '1:1', label: '1:1 方形', size: '720x720' },
] as const

export type VideoModel = (typeof VIDEO_MODELS)[number]
export type VideoStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface VideoGenParams {
  model: string
  prompt: string
  seconds: number
  aspect: string
}

const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

const VIDEO_PROFILE_ID = 'yy-video-profile'

function getActiveProfile(): ApiProfile {
  const { settings } = useStore.getState()
  // Prefer the dedicated 视频 token/channel profile; fall back to the active one.
  const profile =
    settings.profiles.find((p) => p.id === VIDEO_PROFILE_ID) ??
    settings.profiles.find((p) => p.id === settings.activeProfileId)
  if (!profile) throw new Error('未找到可用的 API 配置')
  return profile
}

function authHeader(apiKey: string): string {
  return `Bearer ${apiKey.trim().replace(/^bearer\s+/i, '').trim()}`
}

function resolveSize(aspect: string): string {
  return VIDEO_ASPECTS.find((a) => a.value === aspect)?.size ?? '720x1280'
}

// Read a status string from either `status` or `data.status`.
function readStatus(payload: unknown): string {
  const obj = payload as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return ''
  if (typeof obj.status === 'string') return obj.status.toLowerCase()
  const data = obj.data as Record<string, unknown> | undefined
  if (data && typeof data.status === 'string') return data.status.toLowerCase()
  return ''
}

// Try to pull a directly-playable video URL out of a completed response.
function readVideoUrl(payload: unknown): string | null {
  const obj = payload as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return null
  const candidates = [
    obj.url,
    obj.video_url,
    obj.output,
    (obj.data as Record<string, unknown> | undefined)?.url,
    ((obj.data as Record<string, unknown> | undefined)?.video_url),
    Array.isArray(obj.urls) ? obj.urls[0] : undefined,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c
  }
  return null
}

function normalizeStatus(raw: string): VideoStatus {
  if (['completed', 'succeeded', 'success', 'done'].includes(raw)) return 'completed'
  if (['failed', 'error', 'cancelled', 'canceled'].includes(raw)) return 'failed'
  if (['queued', 'pending', 'created'].includes(raw)) return 'queued'
  return 'processing'
}

export interface CreateVideoResult {
  id: string
}

export async function createVideo(params: VideoGenParams, signal?: AbortSignal): Promise<CreateVideoResult> {
  const profile = getActiveProfile()
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)

  const form = new FormData()
  form.append('model', params.model)
  form.append('prompt', params.prompt)
  form.append('seconds', String(params.seconds))
  form.append('size', resolveSize(params.aspect))
  form.append('resolution', '720p')
  form.append('preset', 'normal')

  const url = buildApiUrl(profile.baseUrl, 'videos', proxyConfig, useApiProxy)
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(profile.apiKey), ...getProxyRequestHeaders('video') },
    cache: 'no-store',
    body: form,
    signal,
  })
  if (!resp.ok) throw new Error(await readError(resp))
  const json = await resp.json()
  const id = typeof json.id === 'string' ? json.id.trim() : ''
  if (!id) throw new Error('视频接口未返回 video_id，请确认服务商支持 /v1/videos')
  return { id }
}

async function fetchStatusOnce(id: string, signal?: AbortSignal): Promise<unknown> {
  const profile = getActiveProfile()
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const url = buildApiUrl(profile.baseUrl, `videos/${encodeURIComponent(id)}`, proxyConfig, useApiProxy)
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader(profile.apiKey), ...getProxyRequestHeaders('video') },
    cache: 'no-store',
    signal,
  })
  if (!resp.ok) throw new Error(await readError(resp))
  return resp.json()
}

// Fetch the video file via /content as a blob and return an object URL.
async function fetchContentObjectUrl(id: string, signal?: AbortSignal): Promise<string> {
  const profile = getActiveProfile()
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const url = buildApiUrl(profile.baseUrl, `videos/${encodeURIComponent(id)}/content`, proxyConfig, useApiProxy)
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader(profile.apiKey), ...getProxyRequestHeaders('video') },
    cache: 'no-store',
    signal,
  })
  if (!resp.ok) throw new Error(await readError(resp))
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}

export interface PollVideoCallbacks {
  onStatus?: (status: VideoStatus) => void
  signal?: AbortSignal
}

// Poll until the video completes or fails. Resolves with a playable URL.
export async function pollVideo(id: string, cb: PollVideoCallbacks = {}): Promise<string> {
  const started = Date.now()
  let lastStatus: VideoStatus | null = null
  while (true) {
    if (cb.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (Date.now() - started > POLL_TIMEOUT_MS) throw new Error('视频生成超时')

    const payload = await fetchStatusOnce(id, cb.signal)
    const status = normalizeStatus(readStatus(payload))
    if (status !== lastStatus) {
      lastStatus = status
      cb.onStatus?.(status)
    }
    if (status === 'failed') throw new Error('视频生成失败')
    if (status === 'completed') {
      const direct = readVideoUrl(payload)
      if (direct) return direct
      return fetchContentObjectUrl(id, cb.signal)
    }
    await delay(POLL_INTERVAL_MS, cb.signal)
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

async function readError(resp: Response): Promise<string> {
  try {
    const text = await resp.text()
    try {
      const json = JSON.parse(text)
      const msg = json?.error?.message || json?.error || json?.message || json?.detail
      if (typeof msg === 'string') {
        if (/invalid api platform:\s*48/i.test(msg)) {
          return 'New API 的 xAI/Grok 官方渠道暂不支持 /v1/videos。请在中转里把 grok-video 改为指向 grok2api 的 OpenAI 兼容渠道。'
        }
        return msg
      }
    } catch {
      // not JSON
    }
    return text || `HTTP ${resp.status}`
  } catch {
    return `HTTP ${resp.status}`
  }
}
