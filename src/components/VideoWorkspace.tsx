import { useCallback, useRef } from 'react'
import { useStore } from '../store'
import { useVideoStore, type VideoTask } from '../videoStore'
import { createVideo, pollVideo, VIDEO_MODELS, VIDEO_DURATIONS, VIDEO_ASPECTS } from '../lib/videoApi'
import { getPlaygroundApiChannelTarget, setPlaygroundApiChannelTarget } from '../lib/devProxy'
import ModelSelect from './ModelSelect'

function genLocalId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
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
  const abortRef = useRef<Record<string, AbortController>>({})

  const runTask = useCallback(
    async (task: VideoTask) => {
      const controller = new AbortController()
      abortRef.current[task.localId] = controller
      try {
        const { id } = await createVideo(
          { model: task.model, prompt: task.prompt, seconds: task.seconds, aspect: task.aspect },
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
    if (!text) {
      showToast('请先输入视频描述', 'info')
      return
    }
    const task: VideoTask = {
      id: '',
      localId: genLocalId(),
      prompt: text,
      model: params.model,
      seconds: params.seconds,
      aspect: params.aspect,
      status: 'queued',
      createdAt: Date.now(),
    }
    addTask(task)
    setPrompt('')
    void runTask(task)
  }, [prompt, params, addTask, setPrompt, runTask, showToast])

  const cancel = useCallback(
    (task: VideoTask) => {
      abortRef.current[task.localId]?.abort()
      removeTask(task.localId)
    },
    [removeTask],
  )

  return (
    <>
      <main data-home-main className="pb-48">
        <div className="safe-area-x max-w-7xl mx-auto px-3 sm:px-4 pt-4">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-gray-500">
              <svg className="mb-3 h-12 w-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p>输入提示词开始生成视频</p>
              <p className="mt-1 text-xs text-gray-600">使用 Grok 视频模型（grok-video-1.0 / 1.5）</p>
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
                      <p className="line-clamp-2 text-xs text-gray-300">{task.prompt}</p>
                      <p className="mt-1 text-[10px] text-gray-500">
                        {task.model} · {task.seconds}s · {task.aspect}
                      </p>
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
        <div className="safe-area-x mx-auto max-w-3xl rounded-[1.75rem] border border-white/[0.08] bg-[#0d0d0d]/95 p-3 shadow-2xl backdrop-blur">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit()
            }}
            rows={2}
            placeholder="描述你想生成的视频，Ctrl + Enter 发送…"
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-gray-100 outline-none placeholder:text-gray-500"
          />
          <div className="mt-2 flex flex-wrap items-end gap-3 px-1">
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
              <span className="text-[10px] text-gray-500">尺寸</span>
              <select
                value={params.aspect}
                onChange={(e) => setParams({ aspect: e.target.value })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none"
              >
                {VIDEO_ASPECTS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={!prompt.trim()}
              className="ml-auto rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              生成视频
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
