import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, CloseIcon } from './icons'

interface ModelMultiSelectOption {
  value: string
  label: string
  meta?: string
}

interface ModelMultiSelectProps {
  value: string[]
  options?: ModelMultiSelectOption[]
  placeholder: string
  onChange: (value: string[]) => void
  className?: string
  display?: 'chips' | 'summary'
  getMetaLabel?: (value: string) => string
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function uniqueOptions(options: ModelMultiSelectOption[]) {
  const seen = new Set<string>()
  return options.filter((option) => {
    const value = option.value.trim()
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export default function ModelMultiSelect({ value, options = [], placeholder, onChange, className = '', display = 'chips', getMetaLabel }: ModelMultiSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = useMemo(() => uniqueValues(value), [value])
  const normalizedOptions = useMemo(() => uniqueOptions(options), [options])
  const optionMap = useMemo(() => new Map(normalizedOptions.map((option) => [option.value, option.label])), [normalizedOptions])
  const optionMetaMap = useMemo(() => new Map(normalizedOptions.map((option) => [option.value, option.meta ?? ''])), [normalizedOptions])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const baseOptions: ModelMultiSelectOption[] = normalizedOptions.length
      ? normalizedOptions
      : selected.map((item) => ({ value: item, label: item, meta: getMetaLabel?.(item) || '' }))
    const merged: ModelMultiSelectOption[] = [
      ...baseOptions,
      ...selected
        .filter((item) => !baseOptions.some((option) => option.value === item))
        .map((item) => ({ value: item, label: optionMap.get(item) ?? item, meta: optionMetaMap.get(item) || getMetaLabel?.(item) || '' })),
    ]
    return merged.filter((option) => {
      if (!normalizedQuery) return true
      return option.value.toLowerCase().includes(normalizedQuery) || option.label.toLowerCase().includes(normalizedQuery)
    })
  }, [getMetaLabel, normalizedOptions, optionMap, optionMetaMap, query, selected])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const toggleValue = (next: string) => {
    if (!next.trim()) return
    if (selectedSet.has(next)) {
      onChange(selected.filter((item) => item !== next))
      return
    }
    onChange([...selected, next])
  }

  const addQuery = () => {
    const next = query.trim()
    if (!next) return
    onChange(uniqueValues([...selected, next]))
    setQuery('')
    setOpen(true)
  }

  const visibleSelected = selected.slice(0, 3)
  const restCount = Math.max(0, selected.length - visibleSelected.length)
  const selectedLabels = selected.map((item) => optionMap.get(item) ?? item)
  const summaryPreview = selectedLabels.slice(0, 2).join('、') + (selected.length > 2 ? ` 等 ${selected.length} 个` : '')
  const metaLabelFor = (item: string) => optionMetaMap.get(item) || getMetaLabel?.(item) || ''
  const displayLabelFor = (item: string) => optionMap.get(item) ?? item

  return (
    <div ref={rootRef} className={`group relative ${className}`}>
      <div
        className={`flex w-full items-center gap-2 rounded-xl border border-gray-300/80 bg-white/70 text-sm text-gray-700 outline-none transition focus-within:border-blue-400 dark:border-white/[0.16] dark:bg-white/[0.03] dark:text-gray-100 ${
          display === 'summary' ? 'min-h-[48px] px-3 py-2' : 'min-h-[34px] px-2 py-1'
        }`}
        onClick={() => {
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        <div className={`${display === 'summary' ? 'flex min-w-0 flex-1 items-center gap-3' : 'flex min-w-0 flex-1 flex-wrap items-center gap-1'}`}>
          {display === 'summary' ? (
            <div className="min-w-0 flex-1">
              <div className={`truncate text-xs font-semibold ${selected.length ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400'}`}>
                {selected.length ? `已选 ${selected.length} 个模型` : placeholder}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400" title={selectedLabels.join('、')}>
                {selected.length ? summaryPreview : '点击展开选择，或输入模型名后按 Enter'}
              </div>
            </div>
          ) : (
            <>
              {visibleSelected.map((item) => (
                <span key={item} className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/[0.12] dark:text-gray-200">
                  <span className="truncate" title={metaLabelFor(item) ? `${displayLabelFor(item)} · ${metaLabelFor(item)}` : displayLabelFor(item)}>{displayLabelFor(item)}</span>
                  {metaLabelFor(item) && <span className="shrink-0 text-[10px] font-semibold text-gray-500 dark:text-gray-400">{metaLabelFor(item)}</span>}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onChange(selected.filter((selectedItem) => selectedItem !== item))
                    }}
                    className="rounded-full p-0.5 text-gray-500 hover:bg-black/10 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label="移除模型"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {restCount > 0 && (
                <span className="rounded-md bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/[0.12] dark:text-gray-200">
                  + {restCount} ...
                </span>
              )}
            </>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addQuery()
              }
              if (event.key === 'Backspace' && !query && selected.length) {
                onChange(selected.slice(0, -1))
              }
            }}
            placeholder={selected.length ? '' : placeholder}
            className={`${display === 'summary' ? 'w-24 shrink-0 text-right' : 'min-w-[120px] flex-1'} bg-transparent px-1 py-1 text-xs outline-none placeholder:text-gray-400`}
          />
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
              setQuery('')
              inputRef.current?.focus()
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-white"
            aria-label="清空模型"
            title="清空模型"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
            inputRef.current?.focus()
          }}
          className="shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-white"
          aria-label="展开模型列表"
        >
          <ChevronDownIcon className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-[80] max-h-72 w-max min-w-full max-w-[min(92vw,520px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-2xl dark:border-white/[0.10] dark:bg-[#242424]">
          {filteredOptions.length ? filteredOptions.map((option) => {
            const checked = selectedSet.has(option.value)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleValue(option.value)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${checked ? 'bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
              >
                <span className="min-w-0 break-all leading-snug" title={option.label}>{option.label}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {(option.meta || getMetaLabel?.(option.value)) && (
                    <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">{option.meta || getMetaLabel?.(option.value)}</span>
                  )}
                  {checked && <span className="text-base leading-none">✓</span>}
                </span>
              </button>
            )
          }) : (
            <button
              type="button"
              onClick={addQuery}
              className="w-full rounded-lg px-3 py-3 text-left text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              按 Enter 添加“{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}
