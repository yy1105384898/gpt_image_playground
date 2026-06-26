import type { ApiProfile } from '../types'
import type { ChatMessage } from '../chatStore'
import { buildApiUrl, getProxyRequestHeaders, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'

function createHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getTextFromOutput(payload: unknown): string {
  if (!isRecord(payload)) return ''
  if (typeof payload.output_text === 'string') return payload.output_text.trim()

  const output = Array.isArray(payload.output) ? payload.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part)) continue
      if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('\n').trim()
}

function parseSseBlock(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim()
  return data && data !== '[DONE]' ? data : null
}

function getDeltaFromEvent(event: Record<string, unknown>): string {
  if (typeof event.delta === 'string') return event.delta
  if (event.type === 'response.output_text.delta' && typeof event.text === 'string') return event.text
  if (event.type === 'response.completed') return ''
  return ''
}

async function readSseText(response: Response, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('接口未返回可读取的流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  const processBlock = (block: string) => {
    const data = parseSseBlock(block)
    if (!data) return
    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(event)) return
    const delta = getDeltaFromEvent(event)
    if (delta) {
      text += delta
      onDelta(delta)
    }
    if (event.type === 'response.completed' && isRecord(event.response)) {
      const completedText = getTextFromOutput(event.response)
      if (completedText && !text) text = completedText
    }
  }

  while (true) {
    if (signal?.aborted) throw new DOMException('请求已停止', 'AbortError')
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let match = buffer.match(/\r?\n\r?\n/)
    while (match?.index != null) {
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      processBlock(block)
      match = buffer.match(/\r?\n\r?\n/)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) processBlock(buffer)
  return text.trim()
}

export async function callTextChatApi(opts: {
  profile: ApiProfile
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}): Promise<string> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(opts.profile.apiProxy, proxyConfig)
  const input = opts.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const body = {
    model: opts.model || opts.profile.model,
    instructions: 'You are a concise, practical Chinese assistant. Answer directly and help the user finish the task.',
    input,
    stream: Boolean(opts.onDelta),
  }

  const response = await fetch(buildApiUrl(opts.profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
    method: 'POST',
    headers: {
      ...createHeaders(opts.profile),
      ...(useApiProxy ? getProxyRequestHeaders('text') : {}),
    },
    cache: 'no-store',
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (opts.onDelta && contentType.includes('text/event-stream')) {
    const streamed = await readSseText(response, opts.onDelta, opts.signal)
    if (streamed) return streamed
  }

  const payload = await response.json()
  const text = getTextFromOutput(payload)
  if (!text) throw new Error('文本接口未返回回复内容')
  return text
}
