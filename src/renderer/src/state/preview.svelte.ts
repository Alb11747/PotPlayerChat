import type { EmoteSegment } from '../core/chat-dom'
import type { UrlTracker } from './url-tracker'

export const previewState = $state({
  url: null as string | null,
  emoteSegment: null as EmoteSegment | null,
  mousePosition: { x: 0, y: 0 },
  urlTrackerInstance: null as UrlTracker | null
})
