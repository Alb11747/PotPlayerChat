import type { ChatSettings } from '@/core/chat/twitch-chat'
import type { PollingIntervals } from '@/types/preload'
import { SvelteSet } from 'svelte/reactivity'
import conf from './config'

export interface InterfaceSettings {
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

export interface GeneralSettings {
  prerelease: boolean
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
  general: GeneralSettings
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
  },
  general: {
    prerelease: false
  }
}

export const settings: Settings = $state(defaultSettings)
export const settingsConfigKey = 'settings'

export function saveSettings(): void {
  const settingsSnapshot = $state.snapshot(settings)
  console.debug('Saving settings:', settingsSnapshot)
  conf.set(settingsConfigKey, settingsSnapshot)
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

  const rawVideoTimestampOffsets = Array.isArray(settings.chat.videoTimestampOffsets)
    ? settings.chat.videoTimestampOffsets
    : []
  const seenTitles: Set<string> = new SvelteSet()
  const normalizedVideoTimestampOffsets: VideoTimestampOffset[] = []
  for (let i = rawVideoTimestampOffsets.length - 1; i >= 0; i -= 1) {
    const entry = rawVideoTimestampOffsets[i]
    if (!entry || typeof entry !== 'object') continue

    const title = String(entry.title ?? '').trim()
    const offset = Number(entry.offset)
    if (!title || seenTitles.has(title) || !Number.isFinite(offset)) continue

    seenTitles.add(title)
    normalizedVideoTimestampOffsets.push({ title, offset })
  }

  const nextVideoTimestampOffsets = [...normalizedVideoTimestampOffsets]
    .reverse()
    .slice(-MAX_VIDEO_TIMESTAMP_OFFSETS)
  const currentVideoTimestampOffsets = settings.chat.videoTimestampOffsets
  const hasSameVideoTimestampOffsets =
    currentVideoTimestampOffsets.length === nextVideoTimestampOffsets.length &&
    currentVideoTimestampOffsets.every(
      (entry, index) =>
        entry.title === nextVideoTimestampOffsets[index]?.title &&
        entry.offset === nextVideoTimestampOffsets[index]?.offset
    )

  if (!hasSameVideoTimestampOffsets) {
    settings.chat.videoTimestampOffsets = nextVideoTimestampOffsets
  }
}

export function getSessionTimestampOffsetByTitle(title: string | null | undefined): number {
  const normalizedTitle = title?.trim()
  if (!normalizedTitle) return 0

  const entry = settings.chat.videoTimestampOffsets.find((x) => x.title === normalizedTitle)
  return entry?.offset ?? 0
}

export function setSessionTimestampOffsetByTitle(
  title: string | null | undefined,
  offset: number
): void {
  const normalizedTitle = title?.trim()
  if (!normalizedTitle || !Number.isFinite(offset)) return

  const currentOffsets = settings.chat.videoTimestampOffsets
  const lastEntry = currentOffsets[currentOffsets.length - 1]
  if (lastEntry?.title === normalizedTitle && lastEntry.offset === offset) return

  const deduped = currentOffsets.filter((x) => x.title !== normalizedTitle)
  deduped.push({ title: normalizedTitle, offset })

  if (deduped.length > MAX_VIDEO_TIMESTAMP_OFFSETS) {
    deduped.splice(0, deduped.length - MAX_VIDEO_TIMESTAMP_OFFSETS)
  }

  settings.chat.videoTimestampOffsets = deduped
  saveSettings()
}

export function removeTemporarySettings(): void {
  // Remove settings that are prefixed with _
  for (const [subkey, subSettings] of iterSettingsKeys()) {
    if (subkey.startsWith('_')) delete subSettings[subkey]
  }
}

void (async () => {
  try {
    const defaultIntervals = await window.api.getDefaultPollingIntervals()
    defaultSettings.intervals = defaultIntervals
    const entries = Object.entries(settings.intervals) as [keyof PollingIntervals, number][]
    for (const [key, value] of entries) if (!value) settings.intervals[key] = defaultIntervals[key]

    const data = await conf.get(settingsConfigKey)
    Object.assign(settings, data)
    removeTemporarySettings()
    normalizeSettings()

    if (Object.entries(settings.intervals).some(([, value]) => value === undefined)) {
      settings.intervals = await window.api.getPollingIntervals()
    } else {
      await window.api.setPollingIntervals($state.snapshot(settings.intervals))
    }
  } catch (error) {
    console.error('Failed to initialize settings:', error)
  }
})()
