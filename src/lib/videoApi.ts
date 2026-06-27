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
import { dataUrlToBlob } from './canvasImage'
import type { ApiProfile } from '../types'

export const VIDEO_MODELS = ['grok-video-1.0', 'grok-video-1.5'] as const
export const VIDEO_DURATIONS = [6, 8, 10, 12, 15] as const
export const VIDEO_ASPECTS = [
  { value: '9:16', label: '9:16 竖屏', size: '720x1280' },
  { value: '16:9', label: '16:9 横屏', size: '1280x720' },
  { value: '1:1', label: '1:1 方形', size: '720x720' },
] as const
export const VIDEO_SIZES = ['自动', '720x1280', '1280x720', '720x720', '1080x1920', '1920x1080', '1024x1024'] as const

export type VideoModel = (typeof VIDEO_MODELS)[number]
export type VideoStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type VideoMode = 'text' | 'image' | 'image_text'

export interface VideoGenParams {
  model: string
  mode: VideoMode
  prompt: string
  seconds: number
  aspect: string
  size: string
  referenceImageDataUrl?: string
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

function resolveAspectRatio(params: Pick<VideoGenParams, 'aspect' | 'size'>): string {
  if (params.aspect === '16:9' || params.aspect === '9:16') return params.aspect
  if (params.size === '1280x720' || params.size === '1920x1080') return '16:9'
  return '9:16'
}

function resolveRequestSize(params: Pick<VideoGenParams, 'aspect' | 'size'>): string {
  return params.size && params.size !== '自动' ? params.size : resolveSize(params.aspect)
}

function readPathString(payload: unknown, paths: string[]): string {
  for (const path of paths) {
    let current: unknown = payload
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    if (typeof current === 'string' && current.trim()) return current.trim()
  }
  return ''
}

function walkStrings(payload: unknown, visit: (value: string, key: string) => string | null, key = ''): string | null {
  if (typeof payload === 'string') return visit(payload, key)
  if (!payload || typeof payload !== 'object') return null
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = walkStrings(item, visit, key)
      if (found) return found
    }
    return null
  }
  for (const [childKey, value] of Object.entries(payload as Record<string, unknown>)) {
    const found = walkStrings(value, visit, childKey)
    if (found) return found
  }
  return null
}

// Read a status string from common NewAPI/grok2api response shapes.
function readStatus(payload: unknown): string {
  const obj = payload as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return ''
  const direct = readPathString(payload, [
    'status',
    'state',
    'task_status',
    'taskStatus',
    'data.status',
    'data.state',
    'data.task_status',
    'data.taskStatus',
    'data.status_code',
    'data.statusCode',
    'result.status',
    'result.state',
    'result.task_status',
    'result.taskStatus',
    'output.status',
    'output.state',
    'output.task_status',
    'output.taskStatus',
  ])
  if (direct) return direct.toLowerCase()
  return walkStrings(payload, (value, key) => {
    if (!/status|state/i.test(key)) return null
    return value.toLowerCase()
  }) ?? ''
}

// Try to pull a directly-playable video URL out of a completed response.
function readVideoUrl(payload: unknown): string | null {
  const obj = payload as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return null
  const candidates = [
    obj.url,
    obj.video_url,
    obj.videoUrl,
    obj.video,
    obj.output,
    obj.content_url,
    obj.contentUrl,
    obj.download_url,
    obj.downloadUrl,
    obj.file_url,
    obj.fileUrl,
    (obj.data as Record<string, unknown> | undefined)?.url,
    (obj.data as Record<string, unknown> | undefined)?.video_url,
    (obj.data as Record<string, unknown> | undefined)?.videoUrl,
    (obj.data as Record<string, unknown> | undefined)?.video,
    (obj.data as Record<string, unknown> | undefined)?.output,
    (obj.data as Record<string, unknown> | undefined)?.content_url,
    (obj.data as Record<string, unknown> | undefined)?.contentUrl,
    (obj.data as Record<string, unknown> | undefined)?.download_url,
    (obj.data as Record<string, unknown> | undefined)?.downloadUrl,
    ((obj.data as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined)?.url,
    ((obj.data as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined)?.video_url,
    ((obj.data as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined)?.videoUrl,
    ((obj.data as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined)?.video,
    ((obj.data as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined)?.url,
    ((obj.data as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined)?.video_url,
    ((obj.data as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined)?.videoUrl,
    ((obj.data as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined)?.video,
    Array.isArray(obj.urls) ? obj.urls[0] : undefined,
    Array.isArray(obj.data) ? (obj.data[0] as Record<string, unknown> | undefined)?.url : undefined,
    Array.isArray(obj.data) ? (obj.data[0] as Record<string, unknown> | undefined)?.video_url : undefined,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c
  }
  return walkStrings(payload, (value, key) => {
    if (!/^https?:\/\//.test(value)) return null
    if (/video|url|output|content/i.test(key) || /\.(mp4|webm|mov)(\?|$)/i.test(value)) return value
    return null
  })
}

function normalizeStatus(raw: string): VideoStatus {
  const normalized = raw.replace(/[\s_-]+/g, '').toLowerCase()
  if (['completed', 'complete', 'succeeded', 'success', 'successful', 'done', 'finished', 'finish', 'generated'].includes(normalized)) return 'completed'
  if (['failed', 'fail', 'error', 'cancelled', 'canceled', 'rejected', 'timeout', 'expired'].includes(normalized)) return 'failed'
  if (['queued', 'queueing', 'pending', 'created', 'submitted', 'waiting', 'wait', 'starting', 'notstarted'].includes(normalized)) return 'queued'
  return 'processing'
}

function isRetryablePollError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '')
  return /(?:\b(?:408|409|425|429|500|502|503|504|524)\b|timeout|timed?\s*out|temporarily|overloaded|rate\s*limit|try\s*again|retry)/i.test(message)
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
  form.append('duration', String(params.seconds))
  form.append('mode', params.mode)
  form.append('size', resolveRequestSize(params))
  form.append('aspect_ratio', resolveAspectRatio(params))
  form.append('resolution', '720p')
  form.append('preset', 'normal')
  if (params.referenceImageDataUrl && params.mode !== 'text') {
    const blob = await dataUrlToBlob(params.referenceImageDataUrl, 'image/png')
    const file = new File([blob], 'reference.png', { type: blob.type || 'image/png' })
    form.append('image', file)
    form.append('image[]', file)
    form.append('input_image', file)
  }

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
  const id = [
    json.id,
    json.video_id,
    json.videoId,
    json.task_id,
    json.taskId,
    json.data?.id,
    json.data?.video_id,
    json.data?.videoId,
    json.data?.task_id,
    json.data?.taskId,
  ].find((value) => typeof value === 'string' && value.trim()) as string | undefined
  if (!id?.trim()) throw new Error('视频接口未返回 video_id，请确认服务商支持 /v1/videos')
  return { id: id.trim() }
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
export async function fetchVideoContentObjectUrl(id: string, signal?: AbortSignal): Promise<string> {
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
  let attempts = 0
  while (true) {
    if (cb.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (Date.now() - started > POLL_TIMEOUT_MS) throw new Error('视频生成超时')

    let payload: unknown
    try {
      payload = await fetchStatusOnce(id, cb.signal)
    } catch (err) {
      if (!isRetryablePollError(err)) throw err
      cb.onStatus?.('processing')
      await delay(POLL_INTERVAL_MS, cb.signal)
      continue
    }
    attempts += 1
    const status = normalizeStatus(readStatus(payload))
    if (status !== lastStatus) {
      lastStatus = status
      cb.onStatus?.(status)
    }
    if (status === 'failed') throw new Error('视频生成失败')
    if (status === 'completed') {
      try {
        return await fetchVideoContentObjectUrl(id, cb.signal)
      } catch (err) {
        const direct = readVideoUrl(payload)
        if (direct) return direct
        throw err
      }
    }
    if (attempts >= 3) {
      try {
        return await fetchVideoContentObjectUrl(id, cb.signal)
      } catch {
        // The content endpoint often returns 404/409 before completion; keep polling.
      }
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
        if (resp.status === 524 || /524|timeout|timed?\s*out|proxy\s+read\s+timeout/i.test(msg)) {
          return `HTTP ${resp.status}: 视频接口响应超时，正在等待服务商生成结果`
        }
        return msg
      }
    } catch {
      // not JSON
    }
    if (resp.status === 524 || /524|timeout|timed?\s*out|proxy\s+read\s+timeout/i.test(text)) {
      return `HTTP ${resp.status}: 视频接口响应超时，正在等待服务商生成结果`
    }
    return text ? `HTTP ${resp.status}: ${text}` : `HTTP ${resp.status}`
  } catch {
    return `HTTP ${resp.status}`
  }
}
