import type { AppearancePreferences } from '@/types/appearance'
import { normalizeAppearancePreferences } from '@/types/appearance'
import conf from './config'
import { refreshUsernameContrast } from './username-contrast.svelte'
import {
  createDefaultSettings,
  defaultSettings,
  hydrateSettings,
  normalizeSettingsValue,
  MAX_VIDEO_TIMESTAMP_OFFSETS,
  type Settings
} from './settings-model'
export {
  defaultSettings,
  createDefaultSettings,
  MAX_VIDEO_TIMESTAMP_OFFSETS
} from './settings-model'
export type {
  Settings,
  InterfaceSettings,
  SearchSettings,
  VideoTimestampOffset
} from './settings-model'

export const settings: Settings = $state(createDefaultSettings())
export const settingsStatus = $state({ ready: false, error: '' })
export const settingsConfigKey = 'settings'

export function applyAppearance(): void {
  const appearance = normalizeAppearancePreferences(settings.interface)
  document.documentElement.dataset['layout'] = appearance.layout
  document.documentElement.dataset['palette'] = appearance.palette
  document.documentElement.dataset['previewMode'] = appearance.previewMode
  refreshUsernameContrast(appearance.palette)
}

export function normalizeSettings(): void {
  normalizeSettingsValue(settings)
}

export function saveSettings(): void {
  if (!settingsStatus.ready) return
  normalizeSettings()
  applyAppearance()
  const snapshot = $state.snapshot(settings)
  // Session offsets are derived from the selected video, never restored as a global offset.
  const chat: Partial<Settings['chat']> = snapshot.chat
  delete chat._sessionTimestampOffset
  void conf
    .set(settingsConfigKey, { ...snapshot, chat })
    .then(() => {
      settingsStatus.error = ''
    })
    .catch((error: unknown) => {
      settingsStatus.error = 'Could not save settings. Try changing the setting again.'
      console.error('Failed to save settings:', error)
    })
}

export function resetSettings(): void {
  if (!settingsStatus.ready) return
  Object.assign(settings, createDefaultSettings())
  saveSettings()
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

let latestAppearance: AppearancePreferences | undefined
function receiveAppearance(preferences: AppearancePreferences): void {
  latestAppearance = normalizeAppearancePreferences(preferences)
  Object.assign(settings.interface, latestAppearance)
  applyAppearance()
}
window.api.onAppearanceChanged(receiveAppearance)
window.addEventListener('beforeunload', () => window.api.offAppearanceChanged(receiveAppearance), {
  once: true
})
applyAppearance()

export const settingsReady = (async (): Promise<void> => {
  try {
    defaultSettings.intervals = await window.api.getDefaultPollingIntervals()
    const data = await conf.get(settingsConfigKey)
    Object.assign(settings, hydrateSettings(data))
    // A notification arriving during config hydration takes precedence over that older snapshot.
    const storedAppearance = await window.api.getAppearancePreferences()
    receiveAppearance(latestAppearance ?? storedAppearance)
    await window.api.setPollingIntervals($state.snapshot(settings.intervals))
    settingsStatus.ready = true
  } catch (error) {
    settingsStatus.error = 'Could not load settings. Restart the app to try again.'
    console.error('Failed to initialize settings:', error)
  }
})()
