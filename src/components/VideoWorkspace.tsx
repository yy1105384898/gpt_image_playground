import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVideoStore, type VideoTask } from '../videoStore'
import { createVideo, pollVideo, VIDEO_DURATIONS, VIDEO_ASPECTS, VIDEO_SIZES, type VideoMode } from '../lib/videoApi'
import { getPlaygroundApiChannelTarget, setPlaygroundApiChannelTarget } from '../lib/devProxy'
import { fileToDataUrl } from '../lib/dataUrl'
import { getAtImageQuery, getImageMentionLabel, replaceImageMentionsForApi, stripImageMentionMarkers } from '../lib/promptImageMentions'
import ModelSelect from './ModelSelect'
import { CodeIcon } from './icons'

function genLocalId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
}

function formatVideoPromptForApi(prompt: string, hasReference: boolean): string {
  const withSelectedMentions = replaceImageMentionsForApi(prompt, hasReference ? 1 : 0, (index) => `[reference image ${index + 1}]`)
  const withTypedMention = hasReference ? withSelectedMentions.replace(/@图1(?!\d)/g, '[reference image 1]') : withSelectedMentions
  return stripImageMentionMarkers(withTypedMention)
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
  const promptInputRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [atMenuDismissed, setAtMenuDismissed] = useState(false)

  const atImageQuery = params.referenceImageDataUrl && !atMenuDismissed
    ? getAtImageQuery(prompt, cursorPos, { length: 1 })
    : null
  const showAtImageMenu = Boolean(atImageQuery)
  const selectedPrompt = useMemo(
    () => formatVideoPromptForApi(prompt, Boolean(params.referenceImageDataUrl)),
    [params.referenceImageDataUrl, prompt],
  )

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
        showToast(message, 'error')
      } finally {
        delete abortRef.current[task.localId]
      }
    },
    [updateTask, showToast],
  )

  const submit = useCallback(() => {
    const text = prompt.trim()
    if (!text && !params.referenceImageDataUrl) {
      showToast('请先输入描述或上传参考图', 'info')
      return
    }
    // 模式按是否有参考图自动判定（与图生图一致）：有图=图文生，无图=文生。
    const mode: VideoMode = params.referenceImageDataUrl ? 'image_text' : 'text'
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
    const query = getAtImageQuery(prompt, cursorPos, { length: 1 })
    if (!query) return
    const mention = getImageMentionLabel(0)
    const nextPrompt = `${prompt.slice(0, query.start)}${mention}${prompt.slice(cursorPos)}`
    const nextCursor = query.start + mention.length
    setPrompt(nextPrompt)
    setAtMenuDismissed(true)
    window.setTimeout(() => {
      const el = promptInputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
      setCursorPos(nextCursor)
    }, 0)
  }, [cursorPos, prompt, setPrompt])

  return (
    <>
      <main data-home-main className="pb-64">
        <div className="safe-area-x max-w-7xl mx-auto px-3 sm:px-4 pt-4">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-gray-500">
              <svg className="mb-3 h-12 w-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p>输入提示词开始生成视频</p>
              <p className="mt-1 text-xs text-gray-600">文生视频；上传参考图即图生视频</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tasks.map((task) => (
                <div key={task.localId} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                  <div className="relative flex aspect-[9/16] w-full items-center justify-center bg-black/40">
                    {task.status === 'completed' && task.videoUrl ? (
                      <video src={task.videoUrl} controls playsInline className="h-full w-full object-contain" />
                    ) : task.status === 'failed' ? (
                      <div className="px-4 text-center text-xs text-red-300">{task.error || '视频生成失败'}</div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                        <span className="text-xs">{STATUS_LABEL[task.status] ?? '生成中'}…</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs text-gray-300">{stripImageMentionMarkers(task.prompt)}</p>
                      <p className="mt-1 text-[10px] text-gray-500">
                        {task.model} · {task.mode === 'text' ? '文生' : task.mode === 'image' ? '图生' : '图文生'} · {task.seconds}s · {task.aspect} · {task.size}
                      </p>
                      {task.id && (
                        <p className="mt-0.5 truncate text-[10px] text-gray-600" title={task.id}>
                          ID {task.id}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {task.status === 'completed' && task.videoUrl && (
                        <a
                          href={task.videoUrl}
                          download={`video-${task.id || task.localId}.mp4`}
                          className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/[0.14]"
                        >
                          下载
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => cancel(task)}
                        className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/[0.14]"
                      >
                        {task.status === 'completed' || task.status === 'failed' ? '删除' : '取消'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

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
                  onClick={() => setParams({ referenceImageDataUrl: undefined })}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                  aria-label="移除参考图"
                >
                  ×
                </button>
              </div>
              <span className="text-[11px] text-gray-400">已添加参考图 · 将按「图生视频」生成</span>
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
            <textarea
              ref={promptInputRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setCursorPos(e.target.selectionStart)
                setAtMenuDismissed(false)
              }}
              onSelect={(e) => {
                setCursorPos(e.currentTarget.selectionStart)
                setAtMenuDismissed(false)
              }}
              onBlur={(e) => setCursorPos(e.currentTarget.selectionStart)}
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
              rows={4}
              placeholder={params.referenceImageDataUrl ? '可选：描述参考图如何动起来，输入 @ 可引用参考图…' : '描述你想生成的视频，Ctrl + Enter 发送…'}
              className="min-h-[104px] w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-relaxed text-gray-100 outline-none placeholder:text-gray-500"
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
              title="上传参考图（图生视频）"
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
