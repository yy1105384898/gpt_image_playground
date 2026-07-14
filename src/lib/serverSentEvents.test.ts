import { describe, expect, it, vi } from 'vitest'
import { isEventStreamResponse, parseServerSentEventBlock, readJsonServerSentEvents } from './serverSentEvents'

describe('serverSentEvents', () => {
  it('detects event-stream content types', () => {
    expect(isEventStreamResponse(new Response('', {
      headers: { 'Content-Type': 'Text/Event-Stream; Charset=UTF-8' },
    }))).toBe(true)
    expect(isEventStreamResponse(new Response('', {
      headers: { 'Content-Type': 'application/json' },
    }))).toBe(false)
  })

  it('parses CRLF and joins multiple data lines', () => {
    expect(parseServerSentEventBlock(': comment\r\ndata: {"message":\r\ndata: "hello"}\r\n')).toBe('{"message":\n"hello"}')
  })

  it('ignores DONE and blocks without data', () => {
    expect(parseServerSentEventBlock('data: [DONE]\r\n')).toBeNull()
    expect(parseServerSentEventBlock('event: ping\n: comment')).toBeNull()
  })

  it('reads JSON events and ignores DONE', async () => {
    const events: Array<Record<string, unknown>> = []
    const response = new Response('data: {"type":"first",\r\ndata: "value":1}\r\n\r\ndata: [DONE]\r\n\r\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })

    await readJsonServerSentEvents(response, (event) => {
      events.push(event)
    })

    expect(events).toEqual([{ type: 'first', value: 1 }])
  })

  it('formats invalid JSON errors at the caller boundary', async () => {
    const response = new Response('data: invalid json\n\n')

    await expect(readJsonServerSentEvents(response, vi.fn(), {
      formatErrorMessage: (message) => `格式错误：${message}`,
    })).rejects.toThrow('格式错误：invalid json')
  })

  it('rejects streams without data blocks', async () => {
    const response = new Response('event: ping\r\n\r\n')

    await expect(readJsonServerSentEvents(response, vi.fn())).rejects.toThrow('未从流式响应中解析到有效的 data 事件')
  })

  it('cancels the reader when any signal aborts', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"first"}\n\n'))
      },
      cancel,
    }))
    const firstController = new AbortController()
    const secondController = new AbortController()

    await expect(readJsonServerSentEvents(response, () => {
      secondController.abort()
    }, {
      signals: [firstController.signal, secondController.signal],
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
