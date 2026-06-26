import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'
export const PLAYGROUND_API_CHANNELS = [
  { id: 'newapi', label: 'NewAPI', target: 'https://yynewapi.yangyangnj.top/v1' },
  { id: 'subapi', label: 'SubAPI', target: 'https://yysubapi.yangyangnj.top/v1' },
] as const

export type PlaygroundApiPurpose = 'text' | 'image' | 'video'
export const PLAYGROUND_API_CHANNEL_STORAGE_KEY = 'yy-image-pro.api-channel'
export const PLAYGROUND_API_CHANNEL_STORAGE_KEYS: Record<PlaygroundApiPurpose, string> = {
  text: 'yy-image-pro.text-api-channel',
  image: 'yy-image-pro.image-api-channel',
  video: 'yy-image-pro.video-api-channel',
}

function normalizeApiChannelTarget(target: string | null): string {
  return PLAYGROUND_API_CHANNELS.find((channel) => channel.target === target || channel.id === target)?.target ?? PLAYGROUND_API_CHANNELS[0].target
}

export function getPlaygroundApiChannelTarget(purpose: PlaygroundApiPurpose = 'image'): string {
  if (typeof window === 'undefined') return PLAYGROUND_API_CHANNELS[0].target
  const saved = window.localStorage.getItem(PLAYGROUND_API_CHANNEL_STORAGE_KEYS[purpose])
    ?? window.localStorage.getItem(PLAYGROUND_API_CHANNEL_STORAGE_KEY)
  return normalizeApiChannelTarget(saved)
}

export function setPlaygroundApiChannelTarget(target: string, purpose: PlaygroundApiPurpose = 'image') {
  if (typeof window === 'undefined') return
  const safeTarget = normalizeApiChannelTarget(target)
  window.localStorage.setItem(PLAYGROUND_API_CHANNEL_STORAGE_KEYS[purpose], safeTarget)
  if (purpose === 'image') {
    window.localStorage.setItem(PLAYGROUND_API_CHANNEL_STORAGE_KEY, safeTarget)
  }
}

export function getProxyRequestHeaders(purpose: PlaygroundApiPurpose = 'image'): Record<string, string> {
  return {
    'X-YY-API-Target': getPlaygroundApiChannelTarget(purpose),
    'X-YY-API-Purpose': purpose,
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
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
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')

  if (useApiProxy) {
    return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${endpointPath}`
  }

  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : ['v1', endpointPath].join('/')

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' || Boolean(proxyConfig?.enabled)
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(apiProxy: boolean, proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}
