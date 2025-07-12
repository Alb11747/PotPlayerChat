import type { EmoteSegment } from '../core/chat-dom'
import { settings } from './settings.svelte'
import type { UrlTracker } from './url-tracker'

export const previewState = $state({
  url: null as string | null,
  emoteSegment: null as EmoteSegment | null,
  mousePosition: { x: 0, y: 0 },
  urlTrackerInstance: null as UrlTracker | null,
  clearOnMove: false
})

export function currentPreviewType(): 'url' | 'emote' | null {
  if (previewState.url) return 'url'
  if (previewState.emoteSegment) return 'emote'
  return null
}

export function onMouseLeavePreviewElement(): void {
  if (settings.interface.stickyPreviews) {
    previewState.clearOnMove = true
  } else {
    previewState.url = null
    previewState.emoteSegment = null
  }
}
