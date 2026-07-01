import type { PlaygroundApiPurpose } from './devProxy'

export const PLAYGROUND_CHANNEL_CONFIG_STORAGE_KEY = 'yy-image-pro.channel-configs.v2'

export type PlaygroundPurposeConfig = {
  apiKey: string
  model: string
}

export type PlaygroundChannelConfigs = Record<string, Partial<Record<PlaygroundApiPurpose, Partial<PlaygroundPurposeConfig>>>>

function readConfigs(): PlaygroundChannelConfigs {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLAYGROUND_CHANNEL_CONFIG_STORAGE_KEY) || '{}') as PlaygroundChannelConfigs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfigs(configs: PlaygroundChannelConfigs) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PLAYGROUND_CHANNEL_CONFIG_STORAGE_KEY, JSON.stringify(configs))
}

export function getStoredPlaygroundPurposeConfig(target: string, purpose: PlaygroundApiPurpose): Partial<PlaygroundPurposeConfig> {
  return readConfigs()[target]?.[purpose] ?? {}
}

export function savePlaygroundPurposeConfig(
  target: string,
  purpose: PlaygroundApiPurpose,
  patch: Partial<PlaygroundPurposeConfig>,
) {
  const configs = readConfigs()
  const previous = configs[target]?.[purpose] ?? {}
  configs[target] = {
    ...(configs[target] ?? {}),
    [purpose]: {
      apiKey: patch.apiKey ?? previous.apiKey ?? '',
      model: patch.model ?? previous.model ?? '',
    },
  }
  writeConfigs(configs)
}
