import { useEffect, useMemo } from 'react'
import { getSelectedModels, hasSelectedModelsConfig, useModelGroups } from '../lib/modelCatalog'
import { getPlaygroundApiChannelTarget, type PlaygroundApiPurpose } from '../lib/devProxy'

const SEP = '::yy-model::'

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

// A native <select> grouped by 厂商 (channel) → its real models, read from
// the relay's /v1/models. Falls back to a static list when nothing loads.
export default function ModelSelect({ purpose, value, target, showAllChannels = false, onSelect, fallbackModels = [], enabled = true, className }: ModelSelectProps) {
  const { groups, loading } = useModelGroups(purpose, enabled)
  const activeTarget = target || getPlaygroundApiChannelTarget(purpose)
  const activeGroups = useMemo(() => showAllChannels ? groups : groups.filter((group) => group.target === activeTarget), [activeTarget, groups, showAllChannels])
  const displayGroups = useMemo(() => activeGroups.map((group) => {
    const selected = getSelectedModels(group.target, purpose)
    const selectedSet = new Set(selected)
    const baseModels = hasSelectedModelsConfig(group.target, purpose)
      ? group.models.filter((model) => selectedSet.has(model))
      : group.models
    return { ...group, models: baseModels }
  }), [activeGroups, activeTarget, purpose, value])

  const hasGroups = displayGroups.length > 0
  useEffect(() => {
    if (!enabled || loading || !hasGroups) return
    if (displayGroups.some((group) => group.models.includes(value))) return
    const firstGroup = displayGroups.find((group) => group.models.length > 0)
    if (firstGroup) onSelect(firstGroup.target, firstGroup.models[0])
  }, [displayGroups, enabled, hasGroups, loading, onSelect, value])

  const selectValue = useMemo(() => {
    if (hasGroups) {
      const targetGroup = displayGroups.find((g) => g.target === activeTarget && g.models.includes(value))
      if (targetGroup) return `${targetGroup.target}${SEP}${value}`
      for (const g of displayGroups) {
        if (g.models.includes(value)) return `${g.target}${SEP}${value}`
      }
      // Current value isn't in any allowed group — keep a hidden marker until the
      // user picks one, but don't render it as a selectable option.
      return `${SEP}${value}`
    }
    return `${SEP}${value}`
  }, [activeTarget, displayGroups, hasGroups, value])

  return (
    <select
      value={selectValue}
      onChange={(e) => {
        const [target, model] = e.target.value.split(SEP)
        if (model) onSelect(target, model)
      }}
      className={className ?? 'yy-model-select rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-gray-100 outline-none'}
      title={value}
    >
      {!hasGroups && (
        <>
          <option value={`${SEP}${value}`}>{value || (loading ? '加载模型…' : '默认模型')}</option>
          {fallbackModels
            .filter((m) => m !== value)
            .map((m) => (
              <option key={m} value={`${SEP}${m}`}>{m}</option>
            ))}
        </>
      )}
      {hasGroups && displayGroups.map((g) => (
        <optgroup key={g.id} label={g.label}>
          {g.models.map((m) => (
            <option key={`${g.id}-${m}`} value={`${g.target}${SEP}${m}`}>{m}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
