import { PLAYGROUND_API_CHANNELS } from './devProxy'

export interface TokenVaultItem {
  id: string
  name: string
  token: string
  createdAt: number
  updatedAt: number
}

export type TokenVaultState = Record<string, TokenVaultItem[]>

const TOKEN_VAULT_STORAGE_KEY = 'yy-image-pro.token-vault'

function newTokenVaultId() {
  return `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeVaultState(input: unknown): TokenVaultState {
  if (!input || typeof input !== 'object') return {}
  const record = input as Record<string, unknown>
  const state: TokenVaultState = {}
  for (const [target, rawItems] of Object.entries(record)) {
    if (!Array.isArray(rawItems)) continue
    state[target] = rawItems
      .filter((item): item is Partial<TokenVaultItem> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : newTokenVaultId(),
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名令牌',
        token: typeof item.token === 'string' ? item.token : '',
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
      }))
      .filter((item) => item.token.trim())
  }
  return state
}

export function readTokenVault(): TokenVaultState {
  if (typeof window === 'undefined') return {}
  try {
    return normalizeVaultState(JSON.parse(window.localStorage.getItem(TOKEN_VAULT_STORAGE_KEY) || '{}'))
  } catch {
    return {}
  }
}

export function writeTokenVault(state: TokenVaultState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_VAULT_STORAGE_KEY, JSON.stringify(state))
}

export function getTokenVaultItems(target: string): TokenVaultItem[] {
  return readTokenVault()[target] ?? []
}

export function saveTokenVaultItem(target: string, name: string, token: string): TokenVaultItem {
  const state = readTokenVault()
  const now = Date.now()
  const trimmedToken = token.trim()
  const trimmedName = name.trim() || '未命名令牌'
  const items = state[target] ?? []
  const existingIndex = items.findIndex((item) => item.token === trimmedToken)
  const item: TokenVaultItem = existingIndex >= 0
    ? { ...items[existingIndex], name: trimmedName, updatedAt: now }
    : { id: newTokenVaultId(), name: trimmedName, token: trimmedToken, createdAt: now, updatedAt: now }

  state[target] = existingIndex >= 0
    ? items.map((current, index) => index === existingIndex ? item : current)
    : [item, ...items]
  writeTokenVault(state)
  return item
}

export function deleteTokenVaultItem(target: string, id: string) {
  const state = readTokenVault()
  state[target] = (state[target] ?? []).filter((item) => item.id !== id)
  writeTokenVault(state)
}

export function maskToken(token: string) {
  const trimmed = token.trim()
  if (trimmed.length <= 12) return trimmed ? '••••••' : ''
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`
}

export function getTokenVaultChannelLabel(target: string) {
  return PLAYGROUND_API_CHANNELS.find((channel) => channel.target === target)?.label ?? target
}
