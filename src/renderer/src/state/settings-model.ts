import type { ChatSettings } from '@/core/chat/twitch-chat'
import type { PollingIntervals } from '@/types/preload'
import { normalizeAppearancePreferences, type AppearancePreferences } from '@/types/appearance'

export interface InterfaceSettings extends AppearancePreferences {
  enableEmotes: boolean
  enableLinkPreviews: boolean
  enableInlineImagePreviews: boolean
  openInlineImagePreviewsOnClick: boolean
  enableEmotePreviews: boolean
  defaultPreviewPosition: 'top' | 'bottom'
  stickyPreviews: boolean
  keepScrollPosition: boolean
  showTimestamps: boolean
  absoluteTimestamps: boolean
  enableBadges: boolean
  showName: 'username' | 'displayName' | 'usernameFirst' | 'displayFirst'
  requireHttpInUrl: boolean
}

export interface SearchSettings {
  showAllMessages: boolean
}

export interface VideoTimestampOffset {
  title: string
  offset: number
}

export const MAX_VIDEO_TIMESTAMP_OFFSETS = 100

export interface Settings {
  chat: ChatSettings & {
    timestampOffset: number
    chatterinoBaseUrl: string
    _sessionTimestampOffset: number
    videoTimestampOffsets: VideoTimestampOffset[]
  }
  interface: InterfaceSettings
  search: SearchSettings
  intervals: PollingIntervals
}

export const defaultSettings: Settings = {
  chat: {
    chatMessageLimit: 200,
    timestampOffset: 0,
    _sessionTimestampOffset: 0,
    videoTimestampOffsets: [],
    justlogUrl: 'https://justlog.alb11747.com',
    chatterinoBaseUrl: 'https://chatterino.alb11747.com/link_resolver'
  },
  interface: {
    layout: 'streamlined',
    palette: 'blue',
    previewMode: 'hover',
    improveUsernameContrast: true,
    enableEmotes: true,
    enableLinkPreviews: true,
    enableInlineImagePreviews: false,
    openInlineImagePreviewsOnClick: true,
    enableEmotePreviews: true,
    defaultPreviewPosition: 'top',
    stickyPreviews: true,
    keepScrollPosition: true,
    showTimestamps: true,
    absoluteTimestamps: false,
    enableBadges: true,
    showName: 'displayFirst',
    requireHttpInUrl: true
  },
  search: {
    showAllMessages: false
  },
  intervals: {
    videoTime: 0,
    potplayerInstances: 0,
    activeWindow: 0
  }
}

export function createDefaultSettings(): Settings {
  return structuredClone(defaultSettings)
}

/** Merge categories independently so older installations keep their settings. */
export function hydrateSettings(raw: unknown): Settings {
  const result = createDefaultSettings()
  if (raw && typeof raw === 'object') {
    for (const category of Object.keys(result) as (keyof Settings)[]) {
      const value = (raw as Record<string, unknown>)[category]
      if (value && typeof value === 'object' && !Array.isArray(value))
        Object.assign(result[category], structuredClone(value))
    }
  }
  result.chat._sessionTimestampOffset = 0
  normalizeSettingsValue(result)
  return result
}

export function normalizeSettingsValue(settings: Settings): void {
  for (const category of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const current = settings[category] as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(defaultSettings[category])) {
      if (current[key] === undefined || current[key] === '') current[key] = structuredClone(value)
    }
  }
  Object.assign(settings.interface, normalizeAppearancePreferences(settings.interface))
  for (const key of ['justlogUrl', 'chatterinoBaseUrl'] as const) {
    const value = settings.chat[key]
    settings.chat[key] =
      typeof value === 'string' && value.trim()
        ? value.replace(/\/+$/, '')
        : defaultSettings.chat[key]
  }
  const entries = Array.isArray(settings.chat.videoTimestampOffsets)
    ? settings.chat.videoTimestampOffsets
    : []
  const seen = new Set<string>()
  const normalized: VideoTimestampOffset[] = []
  for (const entry of [...entries].reverse()) {
    if (!entry || typeof entry !== 'object') continue
    const title = String(entry.title ?? '').trim()
    const offset = Number(entry.offset)
    if (!title || seen.has(title) || !Number.isFinite(offset)) continue
    seen.add(title)
    normalized.push({ title, offset })
  }
  const next = normalized.reverse().slice(-MAX_VIDEO_TIMESTAMP_OFFSETS)
  if (
    JSON.stringify(entries) !== JSON.stringify(next) ||
    !Array.isArray(settings.chat.videoTimestampOffsets)
  )
    settings.chat.videoTimestampOffsets = next
}
