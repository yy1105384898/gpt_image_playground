import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
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

// Module-level cache per dataset so each multi-MB file is fetched only once per session.
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

export default function PromptLibraryModal() {
  const visible = useStore((s) => s.showPromptLibrary)
  const setShowPromptLibrary = useStore((s) => s.setShowPromptLibrary)
  const setPrompt = useStore((s) => s.setPrompt)
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

  const close = () => setShowPromptLibrary(false)
  // ESC closes the detail preview first, then the whole library.
  useCloseOnEscape(visible, () => (detail ? setDetail(null) : close()))
  usePreventBackgroundScroll(visible)

  // Load the active dataset whenever the modal opens or the model tab changes.
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

  // Reset filters when switching model; reset everything when closing.
  useEffect(() => {
    setCategory('all')
    setQuery('')
    setDetail(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [model])

  useEffect(() => {
    if (visible) {
      const id = window.setTimeout(() => searchRef.current?.focus(), 60)
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
    setPrompt(entry.content)
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
    <div
      data-no-drag-select
      className="fixed inset-0 z-[65] flex items-center justify-center p-3 sm:p-4"
      onClick={close}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">提示词库</h2>
            {/* Model tabs */}
            <div className="flex items-center gap-1 rounded-full bg-black/5 p-0.5 dark:bg-white/10">
              {MODELS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setModel(m.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    model === m.key
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {entries.length ? `${filtered.length} / ${entries.length}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭提示词库"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、分类、标签或提示词内容…"
            className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-gray-900 outline-none transition focus:border-yellow-400 focus:ring-2 focus:ring-yellow-300/40 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto px-5 py-3">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
              category === 'all'
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
            }`}
          >
            全部 {entries.length ? `(${entries.length})` : ''}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.label}
              type="button"
              onClick={() => setCategory(cat.label)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                category === cat.label
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-5">
          {loading && (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">加载提示词库…</div>
          )}
          {loadError && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-gray-400">
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
                className="rounded-full bg-black/5 px-3 py-1 text-xs hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
              >
                重试
              </button>
            </div>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">没有匹配的提示词</div>
          )}
          {!loading && !loadError && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(entry)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setDetail(entry) }}
                  className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-gray-800/60"
                >
                  {entry.image && (
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                      <img
                        src={entry.image}
                        alt={entry.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(event) => {
                          ;(event.currentTarget.parentElement as HTMLElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
                        {entry.title}
                      </h3>
                      {entry.category && (
                        <span className="shrink-0 rounded-full bg-yellow-400/15 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-300">
                          {entry.category}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {entry.content}
                    </p>
                    <div className="mt-auto flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); insertPrompt(entry) }}
                        className="flex-1 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                      >
                        填入
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); copyPrompt(entry) }}
                        aria-label="复制提示词"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview detail overlay */}
      {detail && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-3 sm:p-4"
          onClick={(e) => { e.stopPropagation(); setDetail(null) }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-overlay-in" />
          <div
            className="relative z-10 flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-white/50 bg-white shadow-2xl animate-modal-in dark:border-white/[0.08] dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/10">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Preview</span>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="关闭预览"
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 sm:grid-cols-2">
              {/* Left: image */}
              <div className="overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
                {detail.image ? (
                  <img
                    src={detail.image}
                    alt={detail.title}
                    referrerPolicy="no-referrer"
                    className="h-full max-h-[60vh] w-full object-contain"
                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-gray-400">无预览图</div>
                )}
              </div>

              {/* Right: meta + prompt */}
              <div className="flex min-w-0 flex-col gap-3">
                {detail.category && (
                  <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">{detail.category}</span>
                )}
                <h3 className="text-xl font-bold leading-snug text-gray-900 dark:text-gray-50">{detail.title}</h3>
                {detail.description && (
                  <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{detail.description}</p>
                )}
                {detail._source && (
                  <div className="text-xs text-gray-400">
                    来源 <span className="font-medium text-gray-500 dark:text-gray-300">{detail._source}</span>
                  </div>
                )}
                <div className="flex flex-col overflow-hidden rounded-xl border border-black/5 dark:border-white/10">
                  <div className="flex items-center justify-between border-b border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <span className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">PROMPT</span>
                    <button
                      type="button"
                      onClick={() => copyPrompt(detail)}
                      className="text-xs font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                    >
                      复制
                    </button>
                  </div>
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{detail.content}</pre>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-black/5 p-4 dark:border-white/10">
              <button
                type="button"
                onClick={() => insertPrompt(detail)}
                className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
              >
                使用到创作台
              </button>
              <button
                type="button"
                onClick={() => copyPrompt(detail)}
                className="rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-black/[0.03] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.05]"
              >
                复制 Prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
