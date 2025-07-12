import type { UrlTracker } from './url-tracker'

export const previewState = $state({
  url: null as string | null,
  mousePosition: { x: 0, y: 0 },
  urlTrackerInstance: null as UrlTracker | null
})
