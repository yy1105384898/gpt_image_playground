import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getSelectedModels, hasSelectedModelsConfig, useModelGroups } from '../lib/modelCatalog'
import { getPlaygroundApiChannelTarget, type PlaygroundApiPurpose } from '../lib/devProxy'
import { fetchChannelPricingSnapshot, findModelPricing, modelPricingLabel, type ChannelPricingSnapshot } from '../lib/modelPricing'
import { resolvePlaygroundModelChannelTarget } from '../lib/playgroundChannels'
import { ChevronDownIcon } from './icons'

interface ModelSelectProps {
  purpose: PlaygroundApiPurpose
  value: string
  target?: string
  showAllChannels?: boolean
  // Called with the chosen channel target (厂商) and model id.
  onSelect: (target: string, model: string) => void
  // Shown when the relay returns no models (offline / unreachable).
  fallbackModels?: string[]
  enabled?: boolean
  className?: string
}

interface ModelOption {
  key: string
  target: string
  model: string
  groupId: string
  groupLabel: string
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

const MENU_GAP = 8
const MENU_MAX_HEIGHT = 320
const MENU_MIN_WIDTH = 288

// Models need richer labels than a native select can reliably render on Windows:
// channel headings, long model names and pricing are laid out separately.
export default function ModelSelect({ purpose, value, target, showAllChannels = false, onSelect, fallbackModels = [], enabled = true, className }: ModelSelectProps) {
  const { groups, loading } = useModelGroups(purpose, enabled)
  const [pricingSnapshots, setPricingSnapshots] = useState<Record<string, ChannelPricingSnapshot>>({})
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeTarget = target || getPlaygroundApiChannelTarget(purpose)
  const activeGroups = useMemo(() => showAllChannels ? groups : groups.filter((group) => group.target === activeTarget), [activeTarget, groups, showAllChannels])
  const displayGroups = useMemo(() => activeGroups.map((group) => {
    const selected = getSelectedModels(group.target, purpose)
    const selectedSet = new Set(selected)
    const baseModels = hasSelectedModelsConfig(group.target, purpose)
      ? group.models.filter((model) => selectedSet.has(model))
      : group.models
    return { ...group, models: baseModels }
  }), [activeGroups, purpose])

  const hasGroups = displayGroups.some((group) => group.models.length > 0)
  const hasCurrentModel = displayGroups.some((group) => group.models.includes(value))

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const targets = Array.from(new Set([activeTarget, ...displayGroups.map((group) => group.target)].filter(Boolean)))
    targets.forEach((pricingTarget) => {
      fetchChannelPricingSnapshot(resolvePlaygroundModelChannelTarget(pricingTarget))
        .then((snapshot) => {
          if (!cancelled) setPricingSnapshots((state) => ({ ...state, [pricingTarget]: snapshot }))
        })
    })
    return () => {
      cancelled = true
    }
  }, [activeTarget, displayGroups, enabled])

  useEffect(() => {
    if (!enabled || loading || !hasGroups) return
    if (displayGroups.some((group) => group.models.includes(value))) return
    const firstGroup = displayGroups.find((group) => group.models.length > 0)
    if (firstGroup) onSelect(firstGroup.target, firstGroup.models[0])
  }, [displayGroups, enabled, hasGroups, loading, onSelect, value])

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const source = event.target as Node
      if (!triggerRef.current?.contains(source) && !menuRef.current?.contains(source)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const modelPrice = (pricingTarget: string, model: string) => modelPricingLabel(findModelPricing(pricingSnapshots[pricingTarget], model))
  const options = useMemo<ModelOption[]>(() => {
    if (!hasGroups) {
      return [value, ...fallbackModels.filter((model) => model !== value)].filter(Boolean).map((model) => ({
        key: `${activeTarget}:${model}`,
        target: activeTarget,
        model,
        groupId: 'fallback',
        groupLabel: loading ? '正在加载模型' : '可用模型',
      }))
    }
    return displayGroups.flatMap((group) => group.models.map((model) => ({
      key: `${group.target}:${model}`,
      target: group.target,
      model,
      groupId: group.id,
      groupLabel: group.label,
    })))
  }, [activeTarget, displayGroups, fallbackModels, hasGroups, loading, value])
  const selectedOption = options.find((option) => option.target === activeTarget && option.model === value)
    ?? options.find((option) => option.model === value)
  const displayValue = value || (loading ? '加载模型…' : '默认模型')

  const updateMenuPosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 8
    const width = Math.min(Math.max(rect.width, MENU_MIN_WIDTH), window.innerWidth - viewportPadding * 2)
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding)
    const availableBelow = window.innerHeight - rect.bottom - MENU_GAP - viewportPadding
    const availableAbove = rect.top - MENU_GAP - viewportPadding
    const opensUpward = availableBelow < 180 && availableAbove > availableBelow
    const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, opensUpward ? availableAbove : availableBelow))
    setMenuPosition({
      top: opensUpward ? Math.max(viewportPadding, rect.top - MENU_GAP - maxHeight) : rect.bottom + MENU_GAP,
      left,
      width,
      maxHeight,
    })
  }

  useEffect(() => {
    if (!isOpen) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen])

  const selectModel = (option: ModelOption) => {
    onSelect(option.target, option.model)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  let lastGroupId = ''
  const groupedMenuItems = options.map((option) => {
    const showGroup = option.groupId !== lastGroupId
    lastGroupId = option.groupId
    const price = modelPrice(option.target, option.model)
    const isSelected = option.model === value && (option.target === activeTarget || !selectedOption)
    return (
      <div key={option.key}>
        {showGroup && (
          <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-zinc-950/95 px-3 py-2 text-[10px] font-semibold text-zinc-400 backdrop-blur dark:bg-zinc-950/95">
            {option.groupLabel}
          </div>
        )}
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          onClick={() => selectModel(option)}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
            isSelected
              ? 'bg-blue-500/20 text-white'
              : 'text-zinc-200 hover:bg-white/[0.07]'
          }`}
          title={price ? `${option.model} · ${price}` : option.model}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isSelected ? 'bg-blue-400' : 'bg-transparent'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.model}</span>
          {price && <span className="shrink-0 text-[11px] tabular-nums text-amber-200/90">{price}</span>}
        </button>
      </div>
    )
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
        className={`${className ?? 'yy-model-select rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none'} flex items-center justify-between gap-2 text-left`}
        title={selectedOption ? (modelPrice(selectedOption.target, selectedOption.model) ? `${selectedOption.model} · ${modelPrice(selectedOption.target, selectedOption.model)}` : selectedOption.model) : displayValue}
      >
        <span className="min-w-0 flex-1 truncate">{displayValue}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="选择模型"
          className="custom-scrollbar fixed z-[110] overflow-y-auto rounded-xl border border-white/[0.12] bg-zinc-950/98 py-1 shadow-2xl shadow-black/50 ring-1 ring-black/30 backdrop-blur-xl"
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
        >
          {groupedMenuItems}
        </div>,
        document.body,
      )}
    </>
  )
}
