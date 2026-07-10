export const CHAT_STORE_STORAGE_KEY = 'yy-text-chat-store'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getChatImageIdsFromPersistedState(value: unknown): Set<string> {
  const root = isRecord(value) && isRecord(value.state) ? value.state : value
  if (!isRecord(root) || !Array.isArray(root.conversations)) return new Set()

  const ids = new Set<string>()
  for (const conversation of root.conversations) {
    if (!isRecord(conversation) || !Array.isArray(conversation.messages)) continue
    for (const message of conversation.messages) {
      if (!isRecord(message) || !Array.isArray(message.imageIds)) continue
      for (const id of message.imageIds) {
        if (typeof id === 'string' && id) ids.add(id)
      }
    }
  }
  return ids
}

export function getStoredChatImageIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const value = localStorage.getItem(CHAT_STORE_STORAGE_KEY)
    return value ? getChatImageIdsFromPersistedState(JSON.parse(value)) : new Set()
  } catch {
    return new Set()
  }
}
