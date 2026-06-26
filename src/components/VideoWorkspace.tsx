import { useCallback, useRef } from 'react'
import { useStore } from '../store'
import { useVideoStore, type VideoTask } from '../videoStore'
import { createVideo, pollVideo, VIDEO_DURATIONS, VIDEO_ASPECTS, VIDEO_SIZES, type VideoMode } from '../lib/videoApi'
import { getPlaygroundApiChannelTarget, setPlaygroundApiChannelTarget } from '../lib/devProxy'
import { fileToDataUrl } from '../lib/dataUrl'
import ModelSelect from './ModelSelect'
import { CloseIcon, PlusIcon } from './icons'

function genLocalId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
}

const MODE_OPTIONS: Array<{ value: VideoMode; label: string; hint: string }> = [
  { value: 'text', label: '文生视频', hint: '只使用提示词生成' },
  { value: 'image', label: '图生视频', hint: '用参考图生成动态视频' },
  { value: 'image_text', label: '图文生视频', hint: '参考图加提示词控制' },
]

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
          {
            model: task.model,
            mode: task.mode,
            prompt: task.prompt,
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
    if (!text) {
      showToast('请先输入视频描述', 'info')
      return
    }
    if (params.mode !== 'text' && !params.referenceImageDataUrl) {
      showToast('请先上传参考图', 'info')
      return
    }
    const task: VideoTask = {
      id: '',
      localId: genLocalId(),
      prompt: text,
      model: params.model,
      mode: params.mode,
      seconds: params.seconds,
      aspect: params.aspect,
      size: params.size,
      referenceImageDataUrl: params.referenceImageDataUrl,
      status: 'queued',
      createdAt: Date.now(),
    }
    addTask(task)
    setPrompt('')
    void runTask(task)
  }, [prompt, params, addTask, setPrompt, runTask, showToast])

  const handleReferenceFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('只能上传图片参考图', 'error')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    setParams({ referenceImageDataUrl: dataUrl, mode: params.mode === 'text' ? 'image_text' : params.mode })
  }, [params.mode, setParams, showToast])

  const cancel = useCallback(
    (task: VideoTask) => {
      abortRef.current[task.localId]?.abort()
      removeTask(task.localId)
    },
    [removeTask],
  )

  return (
    <>
      <main data-home-main className="pb-10">
        <div className="safe-area-x mx-auto grid max-w-7xl gap-4 px-3 pt-4 sm:px-4 lg:grid-cols-[480px_1fr]">
          <section className="rounded-2xl border border-white/[0.08] bg-[#111318] p-5 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-white">Grok 视频生成</h2>
                <p className="mt-1 text-sm text-gray-400">中转：{getPlaygroundApiChannelTarget('video')}</p>
              </div>
              <span className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">本站代理</span>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-300">模型</span>
                <ModelSelect
                  purpose="video"
                  value={params.model}
                  target={getPlaygroundApiChannelTarget('video')}
                  onSelect={(target, model) => {
                    setPlaygroundApiChannelTarget(target, 'video')
                    setParams({ model })
                  }}
                  className="yy-model-select w-full rounded-lg border border-white/[0.12] bg-black/20 px-3 py-3 text-sm text-white outline-none"
                />
              </label>

              <fieldset className="rounded-xl border border-white/[0.1] p-4">
                <legend className="px-2 text-sm text-gray-300">模式</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODE_OPTIONS.map((option) => (
                    <label key={option.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${params.mode === option.value ? 'border-blue-400 bg-blue-500/10 text-blue-100' : 'border-white/[0.08] bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]'}`}>
                      <input
                        type="radio"
                        name="video-mode"
                        checked={params.mode === option.value}
                        onChange={() => setParams({ mode: option.value })}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {params.mode !== 'text' && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-300">参考图</span>
                    {params.referenceImageDataUrl && (
                      <button
                        type="button"
                        onClick={() => setParams({ referenceImageDataUrl: undefined })}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-white/[0.06] hover:text-white"
                      >
                        <CloseIcon className="h-3.5 w-3.5" /> 移除
                      </button>
                    )}
                  </div>
                  <label className="flex min-h-36 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/[0.14] bg-black/20 text-sm text-gray-400 transition hover:border-blue-400/70 hover:text-blue-200">
                    {params.referenceImageDataUrl ? (
                      <img src={params.referenceImageDataUrl} alt="参考图" className="max-h-56 w-full object-contain" />
                    ) : (
                      <span className="inline-flex items-center gap-2"><PlusIcon className="h-4 w-4" /> 上传参考图</span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        void handleReferenceFile(event.target.files?.[0])
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-300">提示词</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={7}
                  placeholder={params.mode === 'image' ? '描述参考图需要如何动起来…' : '描述你想生成的视频…'}
                  className="w-full resize-y rounded-xl border border-white/[0.1] bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-blue-400/70"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">时长</span>
                  <select
                    value={params.seconds}
                    onChange={(e) => setParams({ seconds: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/[0.1] bg-black/20 px-3 py-3 text-sm text-white outline-none"
                  >
                    {VIDEO_DURATIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">比例</span>
                  <select
                    value={params.aspect}
                    onChange={(e) => {
                      const aspect = e.target.value
                      setParams({ aspect, size: params.size === '自动' ? '自动' : VIDEO_ASPECTS.find((a) => a.value === aspect)?.size ?? params.size })
                    }}
                    className="w-full rounded-lg border border-white/[0.1] bg-black/20 px-3 py-3 text-sm text-white outline-none"
                  >
                    <option value="auto">自动</option>
                    {VIDEO_ASPECTS.map((a) => (
                      <option key={a.value} value={a.value}>{a.value}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">尺寸</span>
                  <select
                    value={params.size}
                    onChange={(e) => setParams({ size: e.target.value })}
                    className="w-full rounded-lg border border-white/[0.1] bg-black/20 px-3 py-3 text-sm text-white outline-none"
                  >
                    {VIDEO_SIZES.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={!prompt.trim() || (params.mode !== 'text' && !params.referenceImageDataUrl)}
                className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                生成视频
              </button>
            </div>
          </section>

          <section className="min-w-0">
          {tasks.length === 0 ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] py-24 text-center text-gray-500">
              <svg className="mb-3 h-12 w-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p>输入提示词开始生成视频</p>
              <p className="mt-1 text-xs text-gray-600">按左侧参数生成视频</p>
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
          </section>
        </div>
      </main>
    </>
  )
}
