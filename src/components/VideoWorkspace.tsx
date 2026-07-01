import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVideoStore, type VideoTask } from '../videoStore'
import { createVideo, fetchVideoContentObjectUrl, pollVideo, VIDEO_DURATIONS, VIDEO_ASPECTS, VIDEO_SIZES, type VideoMode } from '../lib/videoApi'
import { getPlaygroundApiChannelTarget, setPlaygroundApiChannelTarget } from '../lib/devProxy'
import { savePlaygroundPurposeConfig } from '../lib/playgroundPurposeConfig'
import { fileToDataUrl } from '../lib/dataUrl'
import { getAtImageQuery, getImageMentionLabel, getPromptMentionParts, getSelectedImageMentionLabel, insertImageMentionAtVisibleRange, replaceImageMentionsForApi, stripImageMentionMarkers } from '../lib/promptImageMentions'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import type { InputImage } from '../types'
import ModelSelect from './ModelSelect'
import { CloseIcon, CodeIcon, CopyIcon, DownloadIcon, RefreshIcon, TrashIcon } from './icons'

function genLocalId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getMentionTagTextLength(el: Element) {
  return el.textContent?.length ?? 0
}

function getNodeVisibleTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node instanceof HTMLElement && node.classList.contains('mention-tag')) return getMentionTagTextLength(node)
  return Array.from(node.childNodes).reduce((sum, child) => sum + getNodeVisibleTextLength(child), 0)
}

function getVisibleOffsetBeforeNode(root: HTMLElement, target: Node): number {
  let offset = 0
  let found = false
  const walk = (node: Node) => {
    if (found) return
    if (node === target) {
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      offset += getMentionTagTextLength(node)
      return
    }
    node.childNodes.forEach(walk)
  }
  root.childNodes.forEach(walk)
  return offset
}

function getMentionTagForBoundary(root: HTMLElement, container: Node) {
  const el = container.nodeType === Node.ELEMENT_NODE
    ? container as Element
    : container.parentElement
  const tag = el?.closest('.mention-tag')
  return tag && root.contains(tag) ? tag : null
}

function getBoundaryOffsetInMention(tag: Element, container: Node, offset: number) {
  try {
    const range = document.createRange()
    range.selectNodeContents(tag)
    range.setEnd(container, offset)
    return range.toString().length
  } catch {
    return getMentionTagTextLength(tag)
  }
}

function getContentEditableBoundaryOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
  edge: 'start' | 'end',
  collapsed: boolean,
) {
  if (container === root) {
    let visibleOffset = 0
    for (const child of Array.from(root.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  if (!root.contains(container)) {
    const position = root.compareDocumentPosition(container)
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 0
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return root.textContent?.length ?? 0
    if (container.contains(root)) {
      const children = Array.from(container.childNodes)
      const rootIndex = children.indexOf(root as any)
      return offset <= rootIndex ? 0 : root.textContent?.length ?? 0
    }
    return edge === 'start' ? 0 : root.textContent?.length ?? 0
  }

  const mentionTag = getMentionTagForBoundary(root, container)
  if (mentionTag) {
    const mentionStart = getVisibleOffsetBeforeNode(root, mentionTag)
    const mentionLength = getMentionTagTextLength(mentionTag)
    if (!collapsed) return edge === 'start' ? mentionStart : mentionStart + mentionLength
    const mentionOffset = getBoundaryOffsetInMention(mentionTag, container, offset)
    return mentionStart + (mentionOffset < mentionLength / 2 ? 0 : mentionLength)
  }

  if (container.nodeType === Node.TEXT_NODE) {
    return getVisibleOffsetBeforeNode(root, container) + offset
  }

  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : null
  if (element) {
    let visibleOffset = element === root ? 0 : getVisibleOffsetBeforeNode(root, element)
    for (const child of Array.from(element.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  return root.textContent?.length ?? 0
}

function getContentEditableCursor(el: HTMLElement): number {
  const range = getContentEditableSelection(el)
  return range.start
}

function getContentEditableSelection(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
  try {
    const range = sel.getRangeAt(0)
    const start = getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, 'start', range.collapsed)
    const end = range.collapsed
      ? start
      : getContentEditableBoundaryOffset(el, range.endContainer, range.endOffset, 'end', false)
    return { start, end }
  } catch {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
}

function getContentEditablePlainText(el: HTMLElement): string {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      text += node.dataset.mentionText ?? node.textContent ?? ''
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '\n')
}

function syncMentionTagSelection(el: HTMLElement) {
  const tags = el.querySelectorAll<HTMLElement>('.mention-tag')
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  const range = sel.getRangeAt(0)
  if (range.collapsed) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  tags.forEach((tag) => {
    let isSelected = false
    try {
      isSelected = range.intersectsNode(tag)
    } catch {
      isSelected = false
    }
    tag.classList.toggle('selected', isSelected)
  })
}

function setContentEditableCursor(el: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node: Text | null = null
  while (walker.nextNode()) {
    node = walker.currentNode as Text
    const mentionTag = node.parentElement?.closest('.mention-tag')
    if (mentionTag) {
      if (remaining <= node.length) {
        const range = document.createRange()
        if (remaining < node.length / 2) {
          range.setStartBefore(mentionTag)
        } else {
          range.setStartAfter(mentionTag)
        }
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        return
      }
      remaining -= node.length
      continue
    }
    if (remaining <= node.length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= node.length
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getVideoPromptHtml(prompt: string, inputImages: InputImage[]) {
  if (!prompt) return ''
  return getPromptMentionParts(prompt, inputImages)
    .map((part) =>
      part.type === 'mention'
        ? `<span contenteditable="false" class="mention-tag" data-mention-text="${part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)}">${escapeHtml(part.text)}</span>`
        : escapeHtml(part.text),
    )
    .join('')
}

function normalizeVideoReferenceMentions(prompt: string, hasReference: boolean) {
  if (!hasReference) return prompt
  const selectedMention = getSelectedImageMentionLabel(0)
  return prompt.replace(/\u2063[^\u2064]*\u2064|@图1(?!\d)/g, (match) =>
    match.startsWith('\u2063') ? match : selectedMention,
  )
}

function markRemovedVideoReferenceMentions(prompt: string) {
  return prompt
    .replace(/\u2063@图1\u2064|@图1(?!\d)/g, '@已移除图片')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
}

const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'running', label: '生成中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
] as const

type VideoStatusFilter = (typeof STATUS_FILTERS)[number]['value']

function formatVideoPromptForApi(prompt: string, hasReference: boolean): string {
  const normalizedPrompt = normalizeVideoReferenceMentions(prompt, hasReference)
  const withSelectedMentions = replaceImageMentionsForApi(normalizedPrompt, hasReference ? 1 : 0, (index) => `[reference image ${index + 1}]`)
  const withTypedMention = hasReference ? withSelectedMentions.replace(/@图1(?!\d)/g, '[reference image 1]') : withSelectedMentions
  return stripImageMentionMarkers(withTypedMention)
}

function getVideoModeLabel(mode: VideoMode) {
  if (mode === 'text') return '文生视频'
  if (mode === 'image') return '图生视频'
  return '图文生视频'
}

function getVideoModeForInput(prompt: string, hasReference: boolean): VideoMode {
  if (!hasReference) return 'text'
  const semanticPrompt = stripImageMentionMarkers(normalizeVideoReferenceMentions(prompt, hasReference))
    .replace(/@图\d+/g, '')
    .trim()
  return semanticPrompt ? 'image_text' : 'image'
}

function getVideoStatusFilter(task: VideoTask): VideoStatusFilter {
  if (task.status === 'queued' || task.status === 'processing') return 'running'
  return task.status
}

function getVideoAspectLabel(task: VideoTask) {
  if (task.aspect && task.aspect !== 'auto') return task.aspect
  if (task.size === '1280x720' || task.size === '1920x1080') return '16:9'
  return '9:16'
}

function getVideoDisplaySize(task: VideoTask) {
  return task.size && task.size !== '自动' ? task.size : '自动'
}

function getVideoPreviewClass(task: VideoTask) {
  const aspect = getVideoAspectLabel(task)
  if (aspect === '16:9') return 'aspect-video w-full max-w-[860px]'
  if (aspect === '1:1') return 'aspect-square h-[min(70vh,680px)] max-h-full max-w-full'
  return 'aspect-[9/16] h-[min(76vh,720px)] max-h-full max-w-full'
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function summarizeVideoError(error?: string) {
  const message = (error || '').trim()
  if (!message) return '视频生成失败'
  if (/524|timeout|timed?\s*out|proxy\s+read\s+timeout/i.test(message)) {
    return '视频接口响应超时，已停止本次任务。可复用配置后重试。'
  }
  if (/invalid api platform:\s*48/i.test(message)) return '当前视频模型通道不支持 /v1/videos，请切到 grok2api 兼容通道。'
  try {
    const parsed = JSON.parse(message)
    const nested = parsed?.message || parsed?.error?.message || parsed?.error || parsed?.detail
    if (typeof nested === 'string' && nested.trim()) return summarizeVideoError(nested)
  } catch {
    // Plain text error.
  }
  return message.length > 160 ? `${message.slice(0, 160)}...` : message
}

export default function VideoWorkspace() {
  const prompt = useVideoStore((s) => s.prompt)
  const setPrompt = useVideoStore((s) => s.setPrompt)
  const params = useVideoStore((s) => s.params)
  const setParams = useVideoStore((s) => s.setParams)
  const tasks = useVideoStore((s) => s.tasks)
  const addTask = useVideoStore((s) => s.addTask)
  const updateTask = useVideoStore((s) => s.updateTask)
  const removeTask = useVideoStore((s) => s.removeTask)
  const showToast = useStore((s) => s.showToast)
  const setShowPromptLibrary = useStore((s) => s.setShowPromptLibrary)
  const abortRef = useRef<Record<string, AbortController>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const promptInputRef = useRef<HTMLDivElement>(null)
  const isUserInputRef = useRef(false)
  const pendingPromptCursorRef = useRef<number | null>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [atMenuDismissed, setAtMenuDismissed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>('all')
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [videoLoadErrors, setVideoLoadErrors] = useState<Record<string, string>>({})

  const visiblePrompt = useMemo(() => stripImageMentionMarkers(prompt), [prompt])
  const videoPromptImages = useMemo<InputImage[]>(
    () => params.referenceImageDataUrl ? [{ id: 'video-reference-1', dataUrl: params.referenceImageDataUrl }] : [],
    [params.referenceImageDataUrl],
  )
  const atImageQuery = params.referenceImageDataUrl && !atMenuDismissed
    ? getAtImageQuery(visiblePrompt, cursorPos, { length: 1 })
    : null
  const showAtImageMenu = Boolean(atImageQuery)
  const selectedPrompt = useMemo(
    () => formatVideoPromptForApi(prompt, Boolean(params.referenceImageDataUrl)),
    [params.referenceImageDataUrl, prompt],
  )
  const draftMode = useMemo(
    () => getVideoModeForInput(prompt, Boolean(params.referenceImageDataUrl)),
    [params.referenceImageDataUrl, prompt],
  )
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return [...tasks]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((task) => {
        if (statusFilter !== 'all' && getVideoStatusFilter(task) !== statusFilter) return false
        if (!q) return true
        return [
          task.prompt,
          task.model,
          task.id,
          task.mode,
          task.aspect,
          task.size,
          task.status,
        ].some((value) => String(value || '').toLowerCase().includes(q))
      })
  }, [searchQuery, statusFilter, tasks])
  const detailTask = detailTaskId
    ? tasks.find((task) => task.localId === detailTaskId) ?? null
    : null

  useEffect(() => {
    if (detailTaskId && !detailTask) setDetailTaskId(null)
  }, [detailTask, detailTaskId])

  useEffect(() => {
    const el = promptInputRef.current
    if (!el) return
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    const normalizedPrompt = normalizeVideoReferenceMentions(prompt, Boolean(params.referenceImageDataUrl))
    const html = getVideoPromptHtml(normalizedPrompt, videoPromptImages)
    if (el.innerHTML !== html) el.innerHTML = html
    if (pendingPromptCursorRef.current != null) {
      setContentEditableCursor(el, pendingPromptCursorRef.current)
      pendingPromptCursorRef.current = null
    }
  }, [params.referenceImageDataUrl, prompt, videoPromptImages])

  const runTask = useCallback(
    async (task: VideoTask) => {
      const controller = new AbortController()
      abortRef.current[task.localId] = controller
      try {
        const { id } = await createVideo(
          {
            model: task.model,
            mode: task.mode,
            prompt: formatVideoPromptForApi(task.prompt, Boolean(task.referenceImageDataUrl)),
            seconds: task.seconds,
            aspect: task.aspect,
            size: task.size,
            referenceImageDataUrl: task.referenceImageDataUrl,
          },
          controller.signal,
        )
        updateTask(task.localId, { id, status: 'queued' })
        const videoUrl = await pollVideo(id, {
          signal: controller.signal,
          onStatus: (status) => updateTask(task.localId, { status }),
        })
        updateTask(task.localId, { status: 'completed', videoUrl })
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        const message = err instanceof Error ? err.message : '视频生成失败'
        updateTask(task.localId, { status: 'failed', error: message })
        showToast(summarizeVideoError(message), 'error')
      } finally {
        delete abortRef.current[task.localId]
      }
    },
    [updateTask, showToast],
  )

  const submit = useCallback(() => {
    const text = normalizeVideoReferenceMentions(prompt.trim(), Boolean(params.referenceImageDataUrl))
    if (!text && !params.referenceImageDataUrl) {
      showToast('请先输入描述或上传参考图', 'info')
      return
    }
    const mode = getVideoModeForInput(text, Boolean(params.referenceImageDataUrl))
    const taskPrompt = text || '请根据参考图生成自然动态视频'
    const task: VideoTask = {
      id: '',
      localId: genLocalId(),
      prompt: stripImageMentionMarkers(taskPrompt),
      model: params.model,
      mode,
      seconds: params.seconds,
      aspect: params.aspect,
      size: params.size,
      referenceImageDataUrl: params.referenceImageDataUrl,
      status: 'queued',
      createdAt: Date.now(),
    }
    addTask(task)
    void runTask(task)
  }, [prompt, params, addTask, runTask, showToast])

  const handleReferenceFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('只能上传图片参考图', 'error')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    setParams({ referenceImageDataUrl: dataUrl })
  }, [setParams, showToast])

  const cancel = useCallback(
    (task: VideoTask) => {
      abortRef.current[task.localId]?.abort()
      removeTask(task.localId)
    },
    [removeTask],
  )

  const selectReferenceMention = useCallback(() => {
    const query = getAtImageQuery(visiblePrompt, cursorPos, { length: 1 })
    if (!query) return
    const inserted = insertImageMentionAtVisibleRange(prompt, query.start, cursorPos, 0)
    isUserInputRef.current = false
    pendingPromptCursorRef.current = inserted.cursor
    setPrompt(inserted.prompt)
    setAtMenuDismissed(true)
    window.setTimeout(() => {
      const el = promptInputRef.current
      if (!el) return
      el.focus()
      setContentEditableCursor(el, inserted.cursor)
      setCursorPos(inserted.cursor)
    }, 0)
  }, [cursorPos, prompt, setPrompt, visiblePrompt])

  const copyPrompt = useCallback(async (task: VideoTask) => {
    try {
      await copyTextToClipboard(stripImageMentionMarkers(task.prompt))
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }, [showToast])

  const copyError = useCallback(async (task: VideoTask) => {
    try {
      await copyTextToClipboard(task.error || '视频生成失败')
      showToast('完整报错已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }, [showToast])

  const reuseTask = useCallback((task: VideoTask) => {
    setPrompt(task.prompt || '')
    setParams({
      model: task.model,
      mode: task.mode,
      seconds: task.seconds,
      aspect: task.aspect,
      size: task.size,
      referenceImageDataUrl: task.referenceImageDataUrl,
    })
    setDetailTaskId(null)
    showToast('已复用配置到输入框', 'success')
  }, [setParams, setPrompt, showToast])

  const handleVideoPlaybackError = useCallback(async (task: VideoTask) => {
    if (!task.id || videoLoadErrors[task.localId]) return
    setVideoLoadErrors((prev) => ({ ...prev, [task.localId]: '正在重新拉取视频文件…' }))
    try {
      const videoUrl = await fetchVideoContentObjectUrl(task.id)
      updateTask(task.localId, { videoUrl })
      setVideoLoadErrors((prev) => {
        const next = { ...prev }
        delete next[task.localId]
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '视频加载失败'
      setVideoLoadErrors((prev) => ({ ...prev, [task.localId]: summarizeVideoError(message) }))
    }
  }, [updateTask, videoLoadErrors])

  return (
    <>
      <main data-home-main className="pb-64">
        <div className="safe-area-x max-w-7xl mx-auto px-3 sm:px-4 pt-4">
          <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.08] pb-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setShowPromptLibrary(true, 'video')}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-black transition hover:bg-gray-200"
            >
              <CodeIcon className="h-4 w-4" />
              提示词库
            </button>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as VideoStatusFilter)}
              className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-gray-200 outline-none transition hover:bg-white/[0.06]"
            >
              {STATUS_FILTERS.map((item) => (
                <option key={item.value} value={item.value} className="bg-[#171717] text-gray-100">{item.label}</option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索提示词、模型、参数..."
                className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-11 pr-4 text-sm text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-white/[0.18] focus:bg-white/[0.06]"
              />
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-gray-500">
              <svg className="mb-3 h-12 w-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p>输入提示词开始生成视频</p>
              <p className="mt-1 text-xs text-gray-600">文生视频；上传参考图可图生/图文生视频</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-gray-500">
              <svg className="mb-3 h-12 w-12 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414A1 1 0 0014 14.414V19l-4 2v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <p>没有匹配的视频任务</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task) => (
                <article
                  key={task.localId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailTaskId(task.localId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setDetailTaskId(task.localId)
                  }}
                  className="group flex h-40 cursor-pointer overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] transition hover:border-white/[0.18] hover:bg-white/[0.055]"
                >
                  <div className="relative flex h-full w-40 shrink-0 items-center justify-center overflow-hidden bg-black/35">
                    {task.status === 'completed' && task.videoUrl ? (
                      <video src={task.videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    ) : task.status === 'failed' ? (
                      <div className="flex flex-col items-center gap-2 px-4 text-center">
                        <svg className="h-8 w-8 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <span className="text-xs text-red-300">失败</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                        <span className="text-xs">{STATUS_LABEL[task.status] ?? '生成中'}…</span>
                      </div>
                    )}
                    <div className="absolute left-2 top-2 flex gap-1">
                      <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur">{getVideoAspectLabel(task)}</span>
                      <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur">{getVideoDisplaySize(task)}</span>
                    </div>
                    <span className={`absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      task.status === 'failed'
                        ? 'bg-red-500/20 text-red-200'
                        : task.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-blue-500/20 text-blue-200'
                    }`}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col p-3">
                    <p className="line-clamp-3 text-sm font-medium leading-relaxed text-gray-300">{stripImageMentionMarkers(task.prompt) || '(无提示词)'}</p>
                    <div className="mt-auto min-w-0">
                      <div className="mb-2 flex max-w-full gap-1.5 overflow-x-auto pr-2 hide-scrollbar mask-edge-r">
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-xs text-gray-400">
                          <CodeIcon className="h-3 w-3" />
                          {getVideoModeLabel(task.mode)}
                        </span>
                        <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-xs text-gray-400">{task.seconds}s</span>
                        <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-xs text-gray-400">{task.model}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        {task.status === 'completed' && task.videoUrl && (
                          <a
                            href={task.videoUrl}
                            download={`video-${task.id || task.localId}.mp4`}
                            className="rounded-md p-1.5 text-gray-400 transition hover:bg-blue-500/10 hover:text-blue-300"
                            title="下载视频"
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => reuseTask(task)}
                          className="rounded-md p-1.5 text-gray-400 transition hover:bg-blue-500/10 hover:text-blue-300"
                          title="复用配置"
                        >
                          <RefreshIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyPrompt(task)}
                          className="rounded-md p-1.5 text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
                          title="复制提示词"
                        >
                          <CopyIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cancel(task)}
                          className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-500/10 hover:text-red-300"
                          title={task.status === 'completed' || task.status === 'failed' ? '删除视频' : '取消生成'}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {detailTask && (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md sm:p-6"
          onClick={() => setDetailTaskId(null)}
        >
          <section
            className="grid max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/[0.1] bg-[#171717] shadow-2xl md:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative flex min-h-[46vh] items-center justify-center bg-black/35 p-4 md:min-h-[70vh]">
              <div className="absolute left-4 top-4 z-10 flex gap-1.5">
                <span className="rounded bg-black/70 px-2 py-1 font-mono text-xs font-semibold text-white backdrop-blur">{getVideoAspectLabel(detailTask)}</span>
                <span className="rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white/90 backdrop-blur">{getVideoDisplaySize(detailTask)}</span>
              </div>
              <button
                type="button"
                onClick={() => setDetailTaskId(null)}
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-gray-300 transition hover:bg-black/75 hover:text-white"
                aria-label="关闭详情"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              {detailTask.status === 'completed' && detailTask.videoUrl ? (
                <div className={`relative overflow-hidden rounded-xl bg-black shadow-2xl ${getVideoPreviewClass(detailTask)}`}>
                  <video
                    key={detailTask.videoUrl}
                    src={detailTask.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    onError={() => void handleVideoPlaybackError(detailTask)}
                  />
                  {videoLoadErrors[detailTask.localId] && (
                    <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-white/85 backdrop-blur">
                      {videoLoadErrors[detailTask.localId]}
                    </div>
                  )}
                </div>
              ) : detailTask.status === 'failed' ? (
                <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
                  <svg className="h-10 w-10 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-sm font-semibold text-red-200">{summarizeVideoError(detailTask.error)}</p>
                  {detailTask.error && (
                    <button
                      type="button"
                      onClick={() => copyError(detailTask)}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/18"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      复制完整报错
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-gray-400">
                  <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                  <span className="text-sm">{STATUS_LABEL[detailTask.status] ?? '生成中'}…</span>
                </div>
              )}
            </div>

            <aside className="flex max-h-[42vh] min-h-0 flex-col overflow-hidden border-t border-white/[0.08] md:max-h-none md:border-l md:border-t-0">
              <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    detailTask.status === 'failed'
                      ? 'bg-red-500/12 text-red-300'
                      : detailTask.status === 'completed'
                      ? 'bg-emerald-500/12 text-emerald-300'
                      : 'bg-blue-500/12 text-blue-300'
                  }`}>
                    {STATUS_LABEL[detailTask.status] ?? detailTask.status}
                  </span>
                  {detailTask.id && (
                    <span className="min-w-0 truncate text-[11px] text-gray-600" title={detailTask.id}>ID {detailTask.id}</span>
                  )}
                </div>

                <p className="mb-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {stripImageMentionMarkers(detailTask.prompt) || '(无提示词)'}
                </p>

                {detailTask.referenceImageDataUrl && (
                  <div className="mb-5">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                      参考图
                      <CopyIcon className="h-3.5 w-3.5" />
                    </div>
                    <img
                      src={detailTask.referenceImageDataUrl}
                      alt="参考图"
                      className="h-16 w-16 rounded-lg border border-white/[0.08] object-cover"
                    />
                  </div>
                )}

                {detailTask.status === 'failed' && (
                  <div className="mb-5 rounded-xl border border-red-500/10 bg-red-500/[0.06] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-medium uppercase tracking-wider text-red-300">错误信息</h3>
                      {detailTask.error && (
                        <button
                          type="button"
                          onClick={() => copyError(detailTask)}
                          className="rounded-md p-1 text-red-200/80 transition hover:bg-red-500/10 hover:text-red-100"
                          title="复制完整报错"
                        >
                          <CopyIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="break-words text-xs leading-relaxed text-red-100/80">
                      {summarizeVideoError(detailTask.error)}
                    </p>
                  </div>
                )}

                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">参数配置</h3>
                <div className="mb-5 grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">来源</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">Videos · {detailTask.model}</div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">模式</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">{getVideoModeLabel(detailTask.mode)}</div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">比例</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">{getVideoAspectLabel(detailTask)}</div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">尺寸</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">{getVideoDisplaySize(detailTask)}</div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">时长</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">{detailTask.seconds} 秒</div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] px-3 py-2">
                    <span className="text-gray-500">状态</span>
                    <div className="mt-0.5 truncate font-medium text-gray-300">{STATUS_LABEL[detailTask.status] ?? detailTask.status}</div>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  创建于 {formatTime(detailTask.createdAt)}
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-white/[0.08] p-4">
                <button
                  type="button"
                  onClick={() => reuseTask(detailTask)}
                  className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-500/10 text-sm font-semibold text-blue-300 transition hover:bg-blue-500/18"
                >
                  <RefreshIcon className="h-4 w-4" />
                  复用配置
                </button>
                {detailTask.status === 'completed' && detailTask.videoUrl ? (
                  <a
                    href={detailTask.videoUrl}
                    download={`video-${detailTask.id || detailTask.localId}.mp4`}
                    className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-500/10 text-sm font-semibold text-blue-300 transition hover:bg-blue-500/18"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    下载视频
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="col-span-2 flex h-11 cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] text-sm font-semibold text-gray-600"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    下载视频
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyPrompt(detailTask)}
                  className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] text-sm font-semibold text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
                  title="复制提示词"
                >
                  <CopyIcon className="h-4 w-4" />
                  复制提示词
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancel(detailTask)
                    setDetailTaskId(null)
                  }}
                  className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-500/10 text-sm font-semibold text-red-300 transition hover:bg-red-500/18"
                  title={detailTask.status === 'completed' || detailTask.status === 'failed' ? '删除视频' : '取消生成'}
                >
                  <TrashIcon className="h-4 w-4" />
                  {detailTask.status === 'completed' || detailTask.status === 'failed' ? '删除任务' : '取消生成'}
                </button>
              </div>
            </aside>
          </section>
        </div>
      )}

      {/* Bottom input bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-4 sm:px-4">
        <div className="safe-area-x mx-auto max-w-4xl rounded-[1.75rem] border border-white/[0.08] bg-[#0d0d0d]/95 p-3 shadow-2xl backdrop-blur">
          {/* 隐藏的文件选择器，由下方 📎 按钮触发（与图生图一致） */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleReferenceFile(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
          {params.referenceImageDataUrl && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/[0.12]">
                <img src={params.referenceImageDataUrl} alt="参考图" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setParams({ referenceImageDataUrl: undefined })
                    setPrompt(markRemovedVideoReferenceMentions(prompt))
                    setAtMenuDismissed(true)
                  }}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                  aria-label="移除参考图"
                >
                  ×
                </button>
              </div>
              <span className="text-[11px] text-gray-400">已添加参考图 · 将按「{getVideoModeLabel(draftMode)}」生成</span>
            </div>
          )}
          <div className="relative">
            {showAtImageMenu && (
              <div className="absolute bottom-full left-4 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171717]/95 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur-xl">
                <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-500">选择图片引用</div>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectReferenceMention()
                  }}
                  className="flex w-full items-center gap-2 rounded-xl bg-blue-500/10 px-2 py-1.5 text-left text-xs text-blue-200 transition-colors hover:bg-blue-500/15"
                >
                  <span className="h-9 w-9 overflow-hidden rounded-lg border border-white/[0.08] bg-black">
                    {params.referenceImageDataUrl && <img src={params.referenceImageDataUrl} alt="" className="h-full w-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{getImageMentionLabel(0)}</span>
                </button>
              </div>
            )}
            <div
              ref={promptInputRef}
              role="textbox"
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              data-placeholder={params.referenceImageDataUrl ? '可选：描述参考图如何动起来，输入 @ 可引用参考图…' : '描述你想生成的视频，Ctrl + Enter 发送…'}
              onInput={(e) => {
                const el = e.currentTarget
                const cursor = getContentEditableCursor(el)
                const rawPrompt = getContentEditablePlainText(el)
                const normalizedPrompt = normalizeVideoReferenceMentions(rawPrompt, Boolean(params.referenceImageDataUrl))
                const shouldRenderMention = normalizedPrompt !== rawPrompt
                isUserInputRef.current = !shouldRenderMention
                if (shouldRenderMention) pendingPromptCursorRef.current = cursor
                setPrompt(normalizedPrompt)
                setCursorPos(cursor)
                setAtMenuDismissed(false)
              }}
              onMouseUp={(e) => {
                setCursorPos(getContentEditableCursor(e.currentTarget))
                setAtMenuDismissed(false)
              }}
              onKeyUp={(e) => {
                setCursorPos(getContentEditableCursor(e.currentTarget))
                setAtMenuDismissed(false)
              }}
              onBlur={(e) => setCursorPos(getContentEditableCursor(e.currentTarget))}
              onPaste={(e) => {
                e.preventDefault()
                document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
              }}
              onKeyDown={(e) => {
                if (showAtImageMenu && (e.key === 'Enter' || e.key === 'Tab')) {
                  e.preventDefault()
                  selectReferenceMention()
                  return
                }
                if (e.key === 'Escape') {
                  setAtMenuDismissed(true)
                  return
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit()
              }}
              className="video-prompt-editor min-h-[104px] max-h-[220px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-2 py-1.5 text-sm leading-relaxed text-gray-100 outline-none custom-scrollbar"
            />
          </div>
          {params.referenceImageDataUrl && selectedPrompt !== prompt && (
            <div className="px-2 text-[10px] text-gray-600">发送时会把 @图1 转成参考图说明，原提示词保留在输入框。</div>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-3 px-1">
            <button
              type="button"
              onClick={() => setShowPromptLibrary(true, 'video')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-semibold text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
              title="打开提示词库"
            >
              <CodeIcon className="h-3.5 w-3.5" />
              提示词库
            </button>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">模型</span>
              <ModelSelect
                purpose="video"
                value={params.model}
                target={getPlaygroundApiChannelTarget('video')}
                onSelect={(target, model) => {
                  setPlaygroundApiChannelTarget(target, 'video')
                  savePlaygroundPurposeConfig(target, 'video', { model })
                  setParams({ model })
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">时长</span>
              <select
                value={params.seconds}
                onChange={(e) => setParams({ seconds: Number(e.target.value) })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none"
              >
                {VIDEO_DURATIONS.map((d) => (
                  <option key={d} value={d}>{d} 秒</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">比例</span>
              <select
                value={params.aspect}
                onChange={(e) => {
                  const aspect = e.target.value
                  setParams({ aspect, size: params.size === '自动' ? '自动' : VIDEO_ASPECTS.find((a) => a.value === aspect)?.size ?? params.size })
                }}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none"
              >
                <option value="auto">自动</option>
                {VIDEO_ASPECTS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">尺寸</span>
              <select
                value={params.size}
                onChange={(e) => setParams({ size: e.target.value })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none"
              >
                {VIDEO_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="上传参考图（图生/图文生视频）"
              aria-label="上传参考图"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!prompt.trim() && !params.referenceImageDataUrl}
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              生成视频
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
