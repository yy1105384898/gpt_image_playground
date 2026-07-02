import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useVideoStore } from '../videoStore'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, CopyIcon } from './icons'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'

interface PromptEntry {
  id: number | string
  title: string
  description?: string
  content: string
  category: string
  image?: string
  tags?: string[]
  _source?: string
}

type ModelKey = 'gptimage2' | 'nanobanana'

const MODELS: { key: ModelKey; label: string }[] = [
  { key: 'gptimage2', label: 'GPT Image 2' },
  { key: 'nanobanana', label: 'NanoBanana' },
]

const cache: Partial<Record<ModelKey, PromptEntry[]>> = {}
const inflight: Partial<Record<ModelKey, Promise<PromptEntry[]>>> = {}

function loadPrompts(model: ModelKey): Promise<PromptEntry[]> {
  if (cache[model]) return Promise.resolve(cache[model]!)
  if (!inflight[model]) {
    const url = `${import.meta.env.BASE_URL}prompt-library/${model}.json`
    inflight[model] = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: PromptEntry[]) => {
        cache[model] = Array.isArray(data) ? data : []
        return cache[model]!
      })
      .catch((err) => {
        delete inflight[model]
        throw err
      })
  }
  return inflight[model]!
}

function getEntrySource(entry: PromptEntry) {
  if (entry._source) return entry._source
  if (typeof entry.id === 'string') return entry.id
  return `#${entry.id}`
}

export default function PromptLibraryModal() {
  const visible = useStore((s) => s.showPromptLibrary)
  const target = useStore((s) => s.promptLibraryTarget)
  const setShowPromptLibrary = useStore((s) => s.setShowPromptLibrary)
  const setPrompt = useStore((s) => s.setPrompt)
  const videoPrompt = useVideoStore((s) => s.prompt)
  const setVideoPrompt = useVideoStore((s) => s.setPrompt)
  const showToast = useStore((s) => s.showToast)

  const [model, setModel] = useState<ModelKey>('gptimage2')
  const [entries, setEntries] = useState<PromptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [detail, setDetail] = useState<PromptEntry | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const scrollAllowRefs = useMemo(() => detail ? [scrollRef, detailScrollRef] : scrollRef, [detail])

  const close = () => setShowPromptLibrary(false)

  useCloseOnEscape(visible, () => (detail ? setDetail(null) : close()))
  usePreventBackgroundScroll(visible, scrollAllowRefs)

  useEffect(() => {
    if (!visible) return
    if (cache[model]) {
      setEntries(cache[model]!)
      setLoadError(false)
      return
    }

    setLoading(true)
    setLoadError(false)
    let cancelled = false
    loadPrompts(model)
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, model])

  useEffect(() => {
    setCategory('all')
    setQuery('')
    setDetail(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [model])

  useEffect(() => {
    if (visible) {
      const id = window.setTimeout(() => searchRef.current?.focus(), 80)
      return () => window.clearTimeout(id)
    }
    setQuery('')
    setCategory('all')
    setDetail(null)
    return undefined
  }, [visible])

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) {
      const key = entry.category || '其他'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  }, [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false
      if (!q) return true
      return (
        entry.title?.toLowerCase().includes(q) ||
        entry.description?.toLowerCase().includes(q) ||
        entry.category?.toLowerCase().includes(q) ||
        entry.content?.toLowerCase().includes(q) ||
        entry.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [entries, query, category])

  const insertPrompt = (entry: PromptEntry) => {
    if (target === 'video') {
      const current = videoPrompt.trim()
      setVideoPrompt(current ? `${current}\n\n${entry.content}` : entry.content)
    } else {
      setPrompt(entry.content)
    }
    showToast(`已填入：${entry.title}`, 'success')
    close()
  }

  const copyPrompt = async (entry: PromptEntry) => {
    try {
      await copyTextToClipboard(entry.content)
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  if (!visible) return null

  return createPortal(
    <div data-no-drag-select className="fixed inset-0 z-[65] flex flex-col bg-[#070708] text-gray-100">
      <div className="border-b border-white/[0.08] bg-[#080809]/95 backdrop-blur-xl">
        <div className="safe-area-x mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0 truncate text-sm font-semibold tracking-tight text-white">
Y² 绘影 <span className="font-normal text-gray-500">Prompts</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.08]">
            {MODELS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setModel(m.key)}
                className={`h-9 rounded-lg px-4 text-sm font-semibold transition ${
                  model === m.key
                    ? 'bg-white/[0.12] text-white shadow-sm'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-100'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              aria-label="关闭提示词库"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition hover:bg-white/[0.08] hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="safe-area-x mx-auto max-w-7xl px-3 pb-12 pt-10 sm:px-4">
          <section className="mx-auto max-w-3xl text-center">
            <h2 className="font-serif text-3xl font-bold tracking-wide text-white sm:text-4xl">
              {model === 'gptimage2' ? 'GPT Image 2 提示词案例库' : 'NanoBanana 提示词案例库'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-gray-400 sm:text-base">
              真实图片案例、分类筛选、搜索和 Prompt 复制。图片资源直连外部图床，不经过主 API。
            </p>
          </section>

          <div className="mx-auto mt-14 max-w-2xl">
            <div className="relative">
              <svg className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索提示词、标签、分类..."
                className="h-14 w-full rounded-2xl border border-white/[0.09] bg-white/[0.045] px-14 text-sm text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-white/[0.22] focus:bg-white/[0.065]"
              />
              <svg className="pointer-events-none absolute right-5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2 border-b border-white/[0.08] pb-6">
            <button
              type="button"
              onClick={() => setCategory('all')}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                category === 'all'
                  ? 'bg-white text-black'
                  : 'border border-white/[0.08] bg-white/[0.025] text-gray-400 hover:bg-white/[0.07] hover:text-white'
              }`}
            >
              全部 {entries.length ? `(${entries.length})` : ''}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => setCategory(cat.label)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  category === cat.label
                    ? 'bg-white text-black'
                    : 'border border-white/[0.08] bg-white/[0.025] text-gray-400 hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex h-72 items-center justify-center text-sm text-gray-500">加载提示词库...</div>
          )}

          {loadError && (
            <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm text-gray-500">
              <span>提示词库加载失败</span>
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  setLoadError(false)
                  loadPrompts(model)
                    .then((data) => setEntries(data))
                    .catch(() => setLoadError(true))
                    .finally(() => setLoading(false))
                }}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs text-gray-200 transition hover:bg-white/[0.08]"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !loadError && filtered.length === 0 && (
            <div className="flex h-72 items-center justify-center text-sm text-gray-500">没有匹配的提示词</div>
          )}

          {!loading && !loadError && filtered.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((entry) => (
                <article
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(entry)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setDetail(entry)
                  }}
                  className="group cursor-pointer overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045] transition hover:border-white/[0.18] hover:bg-white/[0.065]"
                >
                  <div className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                      <span>分类 {entry.category || '其他'}</span>
                      <span>{getEntrySource(entry)}</span>
                    </div>
                    <h3 className="line-clamp-2 min-h-[3.25rem] text-lg font-bold leading-snug text-white">
                      {entry.title}
                    </h3>
                  </div>

                  {entry.image && (
                    <div className="aspect-[4/3] overflow-hidden bg-black">
                      <img
                        src={entry.image}
                        alt={entry.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        onError={(event) => {
                          ;(event.currentTarget.parentElement as HTMLElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}

                  <div className="space-y-3 px-4 py-4">
                    <p className="line-clamp-3 min-h-[4.5rem] text-sm leading-relaxed text-gray-400">
                      {entry.description || entry.content}
                    </p>
                    <div className="rounded-md border border-white/[0.07] bg-black/25">
                      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
                        <span className="text-xs font-semibold text-gray-400">提示词</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void copyPrompt(entry)
                          }}
                          className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
                        >
                          复制
                        </button>
                      </div>
                      <pre className="line-clamp-4 whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-gray-400">
                        {entry.content}
                      </pre>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                        {entry.category || '其他'}
                      </span>
                      <span className="text-[11px] text-gray-600">{model}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {detail && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
          onClick={() => setDetail(null)}
        >
          <section
            className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#161616] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-6">
              <h3 className="text-base font-bold text-white">Preview</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="关闭预览"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/[0.08] hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div ref={detailScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
              <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
                <div className="overflow-hidden rounded-md border border-white/[0.08] bg-black">
                  {detail.image ? (
                    <img
                      src={detail.image}
                      alt={detail.title}
                      referrerPolicy="no-referrer"
                      className="h-full max-h-[62vh] w-full object-contain"
                      onError={(event) => {
                        ;(event.currentTarget.parentElement as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="flex h-72 items-center justify-center text-sm text-gray-500">无预览图</div>
                  )}
                </div>

                <div className="min-w-0 space-y-5">
                  <div>
                    <div className="mb-3 text-sm font-semibold text-gray-300">{detail.category || '其他'}</div>
                    <h4 className="text-2xl font-black leading-tight text-white">{detail.title}</h4>
                    {detail.description && (
                      <p className="mt-3 text-sm leading-relaxed text-gray-400">{detail.description}</p>
                    )}
                  </div>

                  <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-gray-500">
                    来源 {getEntrySource(detail)}
                  </div>

                  <div className="overflow-hidden rounded-md border border-white/[0.08] bg-black/25">
                    <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Prompt</span>
                      <button
                        type="button"
                        onClick={() => copyPrompt(detail)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-3 py-1.5 text-xs text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                        复制
                      </button>
                    </div>
                    <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-gray-300 custom-scrollbar">
                      {detail.content}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-white/[0.08] p-4">
              <button
                type="button"
                onClick={() => insertPrompt(detail)}
                className="h-12 rounded-md bg-white text-sm font-bold text-black transition hover:bg-gray-200"
              >
                使用到创作台
              </button>
              <button
                type="button"
                onClick={() => copyPrompt(detail)}
                className="h-12 rounded-md border border-white/[0.08] bg-white/[0.035] text-sm font-bold text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                复制 Prompt
              </button>
            </div>
          </section>
        </div>
      )}
    </div>,
    document.body,
  )
}
