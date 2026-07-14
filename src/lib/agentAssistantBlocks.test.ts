import { describe, expect, it } from 'vitest'
import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import {
  getAgentAssistantBlocks,
  getAgentAssistantCopyContent,
  getConversationSearchText,
  getRoundTasks,
  getRoundTaskSlots,
  type AgentAssistantBlock,
} from './agentAssistantBlocks'

const round = (patch: Partial<AgentRound> = {}): AgentRound => ({
  id: patch.id ?? 'round-1',
  index: patch.index ?? 1,
  parentRoundId: patch.parentRoundId ?? null,
  userMessageId: patch.userMessageId ?? 'user-1',
  prompt: patch.prompt ?? 'prompt',
  inputImageIds: patch.inputImageIds ?? [],
  outputTaskIds: patch.outputTaskIds ?? [],
  status: patch.status ?? 'done',
  error: patch.error ?? null,
  createdAt: patch.createdAt ?? 1,
  finishedAt: patch.finishedAt ?? 2,
  ...(patch.responseOutput ? { responseOutput: patch.responseOutput } : {}),
})

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  prompt: patch.prompt ?? 'prompt',
  params: patch.params ?? { ...DEFAULT_PARAMS },
  inputImageIds: patch.inputImageIds ?? [],
  maskTargetImageId: patch.maskTargetImageId ?? null,
  maskImageId: patch.maskImageId ?? null,
  outputImages: patch.outputImages ?? [],
  status: patch.status ?? 'done',
  error: patch.error ?? null,
  createdAt: patch.createdAt ?? 1,
  finishedAt: patch.finishedAt ?? 2,
  elapsed: patch.elapsed ?? 1,
  ...(patch.agentToolCallId ? { agentToolCallId: patch.agentToolCallId } : {}),
  ...(patch.agentBatchCallId ? { agentBatchCallId: patch.agentBatchCallId } : {}),
})

describe('agent assistant blocks', () => {
  it('preserves response output order', () => {
    const imageTask = task('task-1', { agentToolCallId: 'image-1' })
    const currentRound = round({
      outputTaskIds: [imageTask.id],
      responseOutput: [
        { type: 'web_search_call', id: 'search-1', status: 'completed', action: { type: 'search' } },
        { type: 'message', id: 'message-1', content: [{ text: '搜索结果' }] },
        { type: 'image_generation_call', id: 'image-1' },
        { type: 'message', id: 'message-2', content: [{ text: '生成完成' }] },
      ],
    })

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, [imageTask]), [imageTask], true)

    expect(blocks.map((block) => block.type)).toEqual(['web-search', 'text', 'image-task', 'text'])
    expect(blocks.filter((block) => block.type === 'text').map((block) => block.content)).toEqual(['搜索结果', '生成完成'])
  })

  it('keeps deleted task placeholders in round slot order', () => {
    const liveTask = task('task-live')
    const currentRound = round({ outputTaskIds: ['task-deleted', liveTask.id] })
    const slots = getRoundTaskSlots(currentRound, [liveTask])

    expect(slots).toEqual([
      { taskId: 'task-deleted', task: null },
      { taskId: liveTask.id, task: liveTask },
    ])
    expect(getRoundTasks(currentRound, [liveTask])).toEqual([null, liveTask])
    expect(getAgentAssistantBlocks(currentRound, slots, [liveTask], true).map((block) => block.key)).toEqual([
      'text:fallback',
      'deleted-image:task-deleted',
      'image:task-live',
    ])
  })

  it('projects batch tasks in round slot order', () => {
    const firstTask = task('task-first', { agentBatchCallId: 'batch-1' })
    const secondTask = task('task-second', { agentBatchCallId: 'batch-1' })
    const currentRound = round({
      outputTaskIds: [secondTask.id, firstTask.id],
      responseOutput: [{ type: 'function_call', name: 'generate_image_batch', call_id: 'batch-1' }],
    })
    const tasks = [firstTask, secondTask]

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, tasks), tasks, false)

    expect(blocks.map((block) => block.type === 'image-task' ? block.task.id : block.type)).toEqual([
      secondTask.id,
      firstTask.id,
    ])
  })

  it('marks running web searches as stopped when the round is interrupted', () => {
    const output = [{ type: 'web_search_call', id: 'search-1', status: 'in_progress', action: { type: 'search' } }]
    const runningBlocks = getAgentAssistantBlocks(round({ status: 'running', finishedAt: null, responseOutput: output }), [], [], false)
    const stoppedBlocks = getAgentAssistantBlocks(round({ status: 'error', error: '已停止生成。', responseOutput: output }), [], [], false)

    expect(runningBlocks[0]).toMatchObject({ type: 'web-search', status: { text: '正在搜索网页', completed: false } })
    expect(stoppedBlocks[0]).toMatchObject({ type: 'web-search', status: { text: '已停止搜索网页', completed: true } })
  })

  it('shows interrupted batch parameter collection as stopped', () => {
    const currentRound = round({
      status: 'error',
      error: '已停止生成。',
      responseOutput: [{ type: 'function_call', name: 'generate_image_batch', call_id: 'batch-1' }],
    })

    expect(getAgentAssistantBlocks(currentRound, [], [], false)[0]).toMatchObject({
      type: 'batch-params',
      status: { text: '已停止填写并发图像生成参数', completed: true },
    })
  })

  it('copies ordered block text while retaining the fallback for text-only output', () => {
    const mixedBlocks: AgentAssistantBlock[] = [
      { type: 'text', key: 'text:1', content: ' 第一段 ' },
      { type: 'image-task', key: 'image:1', task: task('task-1') },
      { type: 'text', key: 'text:2', content: '第二段' },
    ]

    expect(getAgentAssistantCopyContent('回退文本', mixedBlocks)).toBe('第一段\n\n第二段')
    expect(getAgentAssistantCopyContent('保留原始格式', [{ type: 'text', key: 'text:fallback' }])).toBe('保留原始格式')
  })

  it('builds case-insensitive conversation search text from title, messages, and prompts', () => {
    const conversation: AgentConversation = {
      id: 'conversation-1',
      title: 'Project ALPHA',
      createdAt: 1,
      updatedAt: 2,
      rounds: [round({ prompt: 'Round Prompt' })],
      messages: [{ id: 'user-1', role: 'user', content: 'Message Body', roundId: 'round-1', createdAt: 1 }],
    }

    expect(getConversationSearchText(conversation)).toBe('project alpha\nmessage body\nround prompt')
  })
})
