import type { ChatSettings } from '@/core/chat/twitch-chat'
import type { PollingIntervals } from '@/types/preload'
import conf from './config'

export interface GeneralSettings {}

export interface InterfaceSettings {
  enableEmotes: boolean
  enableLinkPreviews: boolean
  enableEmotePreviews: boolean
  stickyPreviews: boolean
  keepScrollPosition: boolean
  showTimestamps: boolean
  enableBadges: boolean
  showName: 'username' | 'displayName' | 'usernameFirst' | 'displayFirst'
  requireHttpInUrl: boolean
}

export interface Settings {
  chat: ChatSettings & {
    timestampOffset: number
    chatterinoBaseUrl: string
    _sessionTimestampOffset: number
  }
  interface: InterfaceSettings
  intervals: PollingIntervals
  general: GeneralSettings
}

export const defaultSettings: Settings = {
  chat: {
    chatMessageLimit: 200,
    timestampOffset: 0,
    _sessionTimestampOffset: 0,
    justlogUrl: 'https://justlog.alb11747.com',
    chatterinoBaseUrl: 'https://chatterino.alb11747.com/link_resolver'
  },
  interface: {
    enableEmotes: true,
    enableLinkPreviews: true,
    enableEmotePreviews: true,
    stickyPreviews: true,
    keepScrollPosition: true,
    showTimestamps: true,
    enableBadges: true,
    showName: 'displayFirst',
    requireHttpInUrl: true
  },
  intervals: {
    videoTime: 0,
    potplayerInstances: 0,
    activeWindow: 0
  },
  general: {}
}

export function* iterSettingsKeys(): Generator<
  [string, Record<string, unknown>, Record<string, unknown>]
> {
  for (const key in defaultSettings) {
    const key2 = key as keyof Settings
    for (const subkey in defaultSettings[key2]) {
      yield [
        subkey,
        settings[key2] as Record<string, unknown>,
        defaultSettings[key2] as Record<string, unknown>
      ]
    }
  }
}

export function normalizeSettings(): void {
  for (const [subkey, subSettings, defaultSubSettings] of iterSettingsKeys()) {
    if (subSettings[subkey] === undefined || subSettings[subkey] === '')
      subSettings[subkey] = defaultSubSettings[subkey]
  }

  // Normalize the Base URLs
  while ((settings.chat.justlogUrl ?? '').endsWith('/'))
    settings.chat.justlogUrl = settings.chat.justlogUrl.slice(0, -1)
  while ((settings.chat.chatterinoBaseUrl ?? '').endsWith('/'))
    settings.chat.chatterinoBaseUrl = settings.chat.chatterinoBaseUrl.slice(0, -1)
}

export function removeTemporarySettings(): void {
  // Remove settings that are prefixed with _
  for (const [subkey, subSettings] of iterSettingsKeys()) {
    if (subkey.startsWith('_')) delete subSettings[subkey]
  }
}

export const settings = $state(defaultSettings)

export const settingsConfigKey = 'settings'
conf.get(settingsConfigKey).then((data) => {
  Object.assign(settings, data)
  removeTemporarySettings()
  normalizeSettings()

  if (Object.entries(settings.interface).some(([, value]) => !value)) {
    window.api.getPollingIntervals().then((args) => (settings.intervals = args))
  } else {
    window.api.setPollingIntervals($state.snapshot(settings.intervals))
  }
})
