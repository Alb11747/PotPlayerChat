import type { ChatSettings } from '@/core/chat/twitch-chat'
import conf from './config'

export interface GeneralSettings {}

export interface InterfaceSettings {
  showTimestamps: boolean
  enableEmotes: boolean
  enableLinkPreviews: boolean
  enableEmotePreviews: boolean
}

export interface Settings {
  chat: ChatSettings
  interface: InterfaceSettings
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
    enableEmotePreviews: true
  },
  general: {}
}

export const settings = $state(defaultSettings)

export const settingsConfigKey = 'settings'
conf.get(settingsConfigKey).then((data) => {
  Object.assign(settings, data)
})
