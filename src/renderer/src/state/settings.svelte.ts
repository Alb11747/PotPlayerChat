import type { ChatSettings } from '@/core/chat/twitch-chat'
import type { PollingIntervals } from '@/preload/types'
import conf from './config'

export interface GeneralSettings {}

export interface InterfaceSettings {
  showTimestamps: boolean
  enableEmotes: boolean
  enableLinkPreviews: boolean
  enableEmotePreviews: boolean
  stickyPreviews: boolean
}

export interface Settings {
  chat: ChatSettings
  interface: InterfaceSettings
  intervals: PollingIntervals
  general: GeneralSettings
}

export const defaultSettings: Settings = {
  chat: {
    justlogUrl: 'https://justlog.alb11747.com',
    chatMessageLimit: 200
  },
  interface: {
    showTimestamps: true,
    enableEmotes: true,
    enableLinkPreviews: true,
    enableEmotePreviews: true,
    stickyPreviews: true
  },
  intervals: {
    videoTime: 0,
    potplayerInstances: 0,
    activeWindow: 0
  },
  general: {}
}

export const settings = $state(defaultSettings)

export const settingsConfigKey = 'settings'
conf.get(settingsConfigKey).then((data) => {
  Object.assign(settings, data)
  if (Object.entries(settings.interface).some(([, value]) => !value)) {
    window.api.getPollingIntervals().then((args) => (settings.intervals = args))
  } else {
    window.api.setPollingIntervals($state.snapshot(settings.intervals))
  }
})
