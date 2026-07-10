import { describe, expect, it } from 'vitest'
import { getChatImageIdsFromPersistedState } from './chatImages'

describe('getChatImageIdsFromPersistedState', () => {
  it('collects unique image ids from persisted text conversations', () => {
    expect(Array.from(getChatImageIdsFromPersistedState({
      state: {
        conversations: [
          { messages: [{ imageIds: ['image-a', 'image-b'] }, { imageIds: ['image-a'] }] },
          { messages: [{ content: 'text only' }] },
        ],
      },
    }))).toEqual(['image-a', 'image-b'])
  })

  it('ignores malformed persisted data', () => {
    expect(getChatImageIdsFromPersistedState({ state: { conversations: 'invalid' } }).size).toBe(0)
  })
})
