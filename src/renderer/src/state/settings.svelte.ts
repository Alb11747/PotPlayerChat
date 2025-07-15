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
  chat: ChatSettings & { chatterinoBaseUrl: string }
  interface: InterfaceSettings
  intervals: PollingIntervals
  general: GeneralSettings
}

export const defaultSettings: Settings = {
  chat: {
    chatMessageLimit: 200,
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

export function normalizeSettings(): void {
  for (const _key in defaultSettings) {
    const key = _key as keyof Settings
    for (const _subkey in defaultSettings[key]) {
      const subkey = _subkey as keyof Settings[keyof Settings]
      if (settings[key][subkey] === undefined || settings[key][subkey] === '')
        settings[key][subkey] = defaultSettings[key][subkey]
    }
  }

  // Normalize the Base URLs
  while ((settings.chat.justlogUrl ?? '').endsWith('/'))
    settings.chat.justlogUrl = settings.chat.justlogUrl.slice(0, -1)
  while ((settings.chat.chatterinoBaseUrl ?? '').endsWith('/'))
    settings.chat.chatterinoBaseUrl = settings.chat.chatterinoBaseUrl.slice(0, -1)
}

export const settings = $state(defaultSettings)

export const settingsConfigKey = 'settings'
conf.get(settingsConfigKey).then((data) => {
  Object.assign(settings, data)
  normalizeSettings()

  if (Object.entries(settings.interface).some(([, value]) => !value)) {
    window.api.getPollingIntervals().then((args) => (settings.intervals = args))
  } else {
    window.api.setPollingIntervals($state.snapshot(settings.intervals))
  }
})
