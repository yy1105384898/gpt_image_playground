import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, CloseIcon } from './icons'

interface ModelMultiSelectOption {
  value: string
  label: string
}

interface ModelMultiSelectProps {
  value: string[]
  options?: ModelMultiSelectOption[]
  placeholder: string
  onChange: (value: string[]) => void
  className?: string
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export default function ModelMultiSelect({ value, options = [], placeholder, onChange, className = '' }: ModelMultiSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = useMemo(() => uniqueValues(value), [value])
  const optionMap = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const baseOptions = options.length
      ? options
      : selected.map((item) => ({ value: item, label: item }))
    const merged = [
      ...baseOptions,
      ...selected
        .filter((item) => !baseOptions.some((option) => option.value === item))
        .map((item) => ({ value: item, label: optionMap.get(item) ?? item })),
    ]
    return merged.filter((option) => {
      if (!normalizedQuery) return true
      return option.value.toLowerCase().includes(normalizedQuery) || option.label.toLowerCase().includes(normalizedQuery)
    })
  }, [optionMap, options, query, selected])

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

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        className="flex min-h-[34px] w-full items-center gap-1 rounded-xl border border-gray-300/80 bg-white/70 px-2 py-1 text-sm text-gray-700 outline-none transition focus-within:border-blue-400 dark:border-white/[0.16] dark:bg-white/[0.03] dark:text-gray-100"
        onClick={() => {
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {visibleSelected.map((item) => (
            <span key={item} className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/[0.12] dark:text-gray-200">
              <span className="truncate" title={optionMap.get(item) ?? item}>{optionMap.get(item) ?? item}</span>
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
            className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-xs outline-none placeholder:text-gray-400"
          />
        </div>
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
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[80] max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-2xl dark:border-white/[0.10] dark:bg-[#242424]">
          {filteredOptions.length ? filteredOptions.map((option) => {
            const checked = selectedSet.has(option.value)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleValue(option.value)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${checked ? 'bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
              >
                <span className="min-w-0 truncate" title={option.label}>{option.label}</span>
                {checked && <span className="shrink-0 text-base leading-none">✓</span>}
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
