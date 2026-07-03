export type PricingBillingMode = 'per_second' | 'per_request' | 'tiered_expr' | 'ratio'

export interface ModelPricingItem {
  model_name: string
  description?: string
  quota_type?: number
  model_ratio?: number
  completion_ratio?: number
  cache_ratio?: number
  create_cache_ratio?: number
  model_price?: number
  billing_mode?: string
  request_unit?: string
}

export interface ChannelPricingSnapshot {
  autoGroups: string[]
  items: Record<string, ModelPricingItem>
  loadedAt: number
}

const PRICING_CACHE_TTL_MS = 60 * 1000
const pricingCache = new Map<string, { fetchedAt: number; promise?: Promise<ChannelPricingSnapshot>; snapshot?: ChannelPricingSnapshot }>()

export async function fetchChannelPricingSnapshot(baseUrl: string): Promise<ChannelPricingSnapshot> {
  const pricingUrl = pricingApiUrl(baseUrl)
  if (!pricingUrl) return emptyPricingSnapshot()

  const cached = pricingCache.get(pricingUrl)
  if (cached?.snapshot && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) return cached.snapshot
  if (cached?.promise) return cached.promise

  const promise = fetch(pricingUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return normalizePricingPayload(await response.json())
    })
    .catch(() => emptyPricingSnapshot())
    .then((snapshot) => {
      pricingCache.set(pricingUrl, { fetchedAt: Date.now(), snapshot })
      return snapshot
    })
  pricingCache.set(pricingUrl, { fetchedAt: Date.now(), promise })
  return promise
}

export function findModelPricing(snapshot: ChannelPricingSnapshot | undefined, model: string): ModelPricingItem | null {
  if (!snapshot) return null
  return snapshot.items[normalizeModelName(model)] ?? null
}

export function modelPricingLabel(item: ModelPricingItem | null | undefined): string {
  if (!item) return ''
  const price = Number(item.model_price || 0)
  const mode = normalizeBillingMode(item)
  if (price > 0 && mode === 'per_second') return `¥${formatMoney(price)}/秒`
  if (price > 0 && mode === 'per_request') return `¥${formatMoney(price)}/${requestUnitLabel(item.request_unit)}`
  if (price > 0) return `¥${formatMoney(price)}`
  const ratio = Number(item.model_ratio || 0)
  const completion = Number(item.completion_ratio || 0)
  if (ratio > 0 && completion > 0 && completion !== ratio) return `倍率 ${formatRatio(ratio)} / ${formatRatio(completion)}`
  if (ratio > 0) return `倍率 ${formatRatio(ratio)}`
  return ''
}

export function emptyPricingSnapshot(): ChannelPricingSnapshot {
  return { autoGroups: [], items: {}, loadedAt: Date.now() }
}

function normalizeBillingMode(item: ModelPricingItem): PricingBillingMode {
  const mode = item.billing_mode?.trim()
  if (mode === 'per_second' || mode === 'per-second') return 'per_second'
  if (mode === 'per_request' || mode === 'per-request') return 'per_request'
  if (mode === 'tiered_expr') return 'tiered_expr'
  if (Number(item.model_price || 0) > 0 || item.quota_type === 1) return 'per_request'
  return 'ratio'
}

function normalizePricingPayload(payload: unknown): ChannelPricingSnapshot {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const data = Array.isArray(record.data) ? record.data : []
  const items: Record<string, ModelPricingItem> = {}
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const recordItem = item as Record<string, unknown>
    if (typeof recordItem.model_name !== 'string' || !recordItem.model_name.trim()) continue
    items[normalizeModelName(recordItem.model_name)] = recordItem as unknown as ModelPricingItem
  }
  return {
    autoGroups: Array.isArray(record.auto_groups) ? record.auto_groups.filter((item): item is string => typeof item === 'string') : [],
    items,
    loadedAt: Date.now(),
  }
}

function pricingApiUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.pathname = url.pathname
      .replace(/\/+$/, '')
      .replace(/\/v1$/i, '')
      .replace(/\/api\/v3$/i, '')
      .replace(/\/api\/plan\/v3$/i, '')
    url.search = ''
    url.hash = ''
    return `${url.toString().replace(/\/+$/, '')}/api/pricing`
  } catch {
    return ''
  }
}

function normalizeModelName(value: string): string {
  return value.trim().replace(/^models\//, '').toLowerCase()
}

function requestUnitLabel(value: string | undefined): string {
  if (value === 'task') return '任务'
  return '次'
}

function formatMoney(value: number): string {
  return value.toFixed(value >= 10 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '')
}

function formatRatio(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}
