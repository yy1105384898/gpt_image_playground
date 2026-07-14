import { describe, expect, it } from 'vitest'
import type { AgentConversation, AgentRound } from '../types'
import { getAgentBranchLeafId, getAgentRoundPath, normalizeAgentConversations } from './agentConversationState'

function round(id: string, parentRoundId: string | null, index: number): AgentRound {
  return {
    id,
    index,
    parentRoundId,
    userMessageId: `user-${id}`,
    prompt: id,
    inputImageIds: [],
    outputTaskIds: [],
    status: 'done',
    error: null,
    createdAt: index,
    finishedAt: index,
  }
}

function conversation(rounds: AgentRound[], activeRoundId: string | null): AgentConversation {
  return {
    id: 'conversation-a',
    title: '对话',
    activeRoundId,
    createdAt: 1,
    updatedAt: 1,
    rounds,
    messages: [],
  }
}

describe('agent conversation state', () => {
  it('stops traversing cyclic parent relationships', () => {
    const value = conversation([
      round('round-a', 'round-b', 1),
      round('round-b', 'round-a', 2),
    ], 'round-a')

    expect(getAgentRoundPath(value, 'round-a').map((item) => item.id)).toEqual(['round-b', 'round-a'])
    expect(getAgentBranchLeafId(value, 'round-a')).toBe('round-a')
  })

  it('normalizes legacy linear conversations without changing the stored shape', () => {
    const normalized = normalizeAgentConversations([{
      id: 'conversation-a',
      title: '',
      rounds: [
        { ...round('round-a', null, 1), parentRoundId: undefined },
        { ...round('round-b', null, 2), parentRoundId: undefined, status: 'running' },
      ],
      messages: [
        { id: 'user-round-a', role: 'user', content: '保留', roundId: 'round-a', createdAt: 1 },
        { id: 'orphan', role: 'assistant', content: '丢弃', roundId: 'missing', createdAt: 2 },
      ],
      createdAt: 1,
      updatedAt: 2,
    }])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      title: '新对话',
      activeRoundId: 'round-b',
      rounds: [
        { id: 'round-a', parentRoundId: null, status: 'done' },
        { id: 'round-b', parentRoundId: 'round-a', status: 'error', error: '上次请求已中断' },
      ],
    })
    expect(normalized[0].messages.map((message) => message.id)).toEqual(['user-round-a'])
  })
})
