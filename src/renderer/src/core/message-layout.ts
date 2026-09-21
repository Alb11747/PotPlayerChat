import {
  clearCache as clearPretextCache,
  layoutNextLineRange,
  measureNaturalWidth,
  prepareWithSegments,
  type PreparedTextWithSegments,
  type LayoutCursor
} from '@chenglou/pretext'
import type { MessagePresentation } from './message-presentation'
import type { UrlTracker } from './url-tracker'

export interface MessageMetrics {
  rem: number
  fontFamily: string
  fontSize: number
  timestampSize: number
  lineHeight: number
  badgeSize: number
  emoteSize: number
  padding: number
  horizontalPadding: number
  letterSpacing: number
}

export function readMessageMetrics(element: HTMLElement): MessageMetrics {
  const css = getComputedStyle(element)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const token = (name: string, fallback: number): number => {
    const value = css.getPropertyValue(name).trim()
    const number = parseFloat(value)
    return Number.isFinite(number) ? number * (value.endsWith('rem') ? rem : 1) : fallback
  }
  const fontSize = token('--deck-message-size', rem * 1.09375)
  return {
    rem,
    fontFamily: css.fontFamily || '"Segoe UI", sans-serif',
    fontSize,
    timestampSize: token('--deck-timestamp-size', rem * 0.90625),
    lineHeight: token('--deck-message-line-height', 1.5) * fontSize,
    badgeSize: token('--deck-badge-size', rem * 1.5),
    emoteSize: token('--deck-emote-size', rem * 2.5),
    padding: token('--deck-message-gap', 2),
    horizontalPadding: rem * 1.2,
    letterSpacing: parseFloat(css.letterSpacing) || 0
  }
}

export function plainPresentationText(escaped: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'"
  }
  return escaped
    .replace(/<\/?mark>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#039);/g, (entity) => entities[entity]!)
}

/** Retaining a presentation retains its width-independent shaping; recycling releases it. */
let preparedCache = new WeakMap<MessagePresentation, Map<string, PreparedTextWithSegments>>()
// Chat repeats emote names, sender names and entire lines. Share shaping across
// messages as well as widths, while bounding retained user text across contexts.
const sharedPrepared = new Map<string, PreparedTextWithSegments>()
const MAX_SHARED_PREPARED = 5000
let layoutCache = new WeakMap<
  MessagePresentation,
  { width: number; metrics: MessageMetrics; inlinePreviews: boolean; media: string; height: number }
>()
export function clearMessageLayoutCache(): void {
  clearPretextCache()
  preparedCache = new WeakMap()
  sharedPrepared.clear()
  layoutCache = new WeakMap()
}

export function fitMedia(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  allowUpscale = false
): { width: number; height: number } {
  const scale = Math.min(
    allowUpscale ? Infinity : 1,
    maxWidth / Math.max(1, width),
    maxHeight / Math.max(1, height)
  )
  return { width: width * scale, height: height * scale }
}

/** Predict native pre-wrap flow; ResizeObserver remains authoritative for DOM geometry. */
export function measureMessage(
  presentation: MessagePresentation,
  width: number,
  metrics: MessageMetrics,
  tracker: UrlTracker,
  inlinePreviews = false
): number {
  // Read media state even on a cache hit so loaded/failed assets still invalidate
  // Svelte estimates. Unchanged rows need no repeated Pretext line walking.
  let media = ''
  for (const segment of presentation.segments ?? []) {
    if (segment.type === 'emote' || segment.type === 'cheer') {
      const failed = Object.values(segment.urls).every((url) => tracker.isFailedUrl(url))
      const dimensions = tracker.getImageDimensions(Object.values(segment.urls)[0]!)
      media += `e${failed}:${dimensions?.width},${dimensions?.height};`
    } else if (inlinePreviews && segment.type === 'url') {
      const preview = tracker.getCachedPreview(segment.url)
      const dimensions = preview?.thumbnail
        ? tracker.getImageDimensions(preview.thumbnail)
        : undefined
      media += `p${tracker.isFailedUrl(segment.url)}:${preview?.status}:${preview?.thumbnail}:${dimensions?.width},${dimensions?.height};`
    }
  }
  const previous = layoutCache.get(presentation)
  if (
    previous?.width === width &&
    previous.metrics === metrics &&
    previous.inlinePreviews === inlinePreviews &&
    previous.media === media
  )
    return previous.height
  const available = Math.max(1, width - metrics.horizontalPadding)
  let x = 0
  let height = 0
  let lineHeight = metrics.lineHeight
  const nextLine = (): void => {
    height += lineHeight
    x = 0
    lineHeight = metrics.lineHeight
  }
  let cache = preparedCache.get(presentation)
  if (!cache) {
    cache = new Map()
    preparedCache.set(presentation, cache)
  }
  const prepareText = (paragraph: string, font: string): PreparedTextWithSegments => {
    const key = `${font}\u0000${metrics.letterSpacing}\u0000${paragraph}`
    let prepared = cache!.get(key)
    if (!prepared) {
      prepared = sharedPrepared.get(key)
      if (prepared) {
        sharedPrepared.delete(key)
      } else {
        prepared = prepareWithSegments(paragraph, font, {
          whiteSpace: 'pre-wrap',
          letterSpacing: metrics.letterSpacing
        })
        if (sharedPrepared.size >= MAX_SHARED_PREPARED)
          sharedPrepared.delete(sharedPrepared.keys().next().value!)
      }
      sharedPrepared.set(key, prepared)
      cache!.set(key, prepared)
    }
    return prepared
  }
  const text = (value: string, font = `${metrics.fontSize}px ${metrics.fontFamily}`): void => {
    const paragraphs = value.split('\n')
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) nextLine()
      if (!paragraph) return
      const prepared = prepareText(paragraph, font)
      let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
      while (cursor.segmentIndex < prepared.segments.length) {
        if (x >= available) nextLine()
        let line = layoutNextLineRange(prepared, cursor, Math.max(1, available - x))
        if (!line) break
        if (x > 0 && line.width > available - x) {
          nextLine()
          line = layoutNextLineRange(prepared, cursor, available)
          if (!line) break
        }
        x += line.width
        if (
          cursor.segmentIndex === line.end.segmentIndex &&
          cursor.graphemeIndex === line.end.graphemeIndex
        )
          break
        cursor = line.end
        if (cursor.segmentIndex < prepared.segments.length) nextLine()
      }
    })
  }
  const box = (boxWidth: number, boxHeight: number): void => {
    if (x > 0 && x + boxWidth > available) nextLine()
    x += boxWidth
    // Inline middle alignment extends equally about the text x-height center.
    lineHeight = Math.max(lineHeight, boxHeight + metrics.fontSize * 0.25)
  }
  if (presentation.timestamp) {
    text(presentation.timestamp, `${metrics.timestampSize}px ${metrics.fontFamily}`)
    x += metrics.rem * 0.125
  }
  if (presentation.badges.length)
    box(
      presentation.badges.length * metrics.badgeSize +
        Math.max(0, presentation.badges.length - 1) * metrics.rem * 0.125,
      metrics.badgeSize
    )
  const prefix =
    plainPresentationText(presentation.prefix) +
    (presentation.message.type === 'chat' || presentation.segments ? ': ' : '')
  if (presentation.message.type === 'chat') x += metrics.rem * 0.1
  text(
    prefix,
    `${presentation.message.type === 'system' ? 'italic 500' : '700'} ${metrics.fontSize}px ${metrics.fontFamily}`
  )
  for (const segment of presentation.segments ?? []) {
    if (
      (segment.type === 'emote' || segment.type === 'cheer') &&
      Object.values(segment.urls).some((url) => !tracker.isFailedUrl(url))
    ) {
      const url = Object.values(segment.urls)[0]!
      const dimensions = tracker.getImageDimensions(url)
      const size = dimensions
        ? fitMedia(
            dimensions.width,
            dimensions.height,
            metrics.rem * 9,
            metrics.emoteSize,
            segment.type === 'cheer'
          )
        : {
            width: Math.max(
              metrics.emoteSize,
              measureNaturalWidth(
                prepareText(
                  plainPresentationText(segment.escaped),
                  `900 ${metrics.fontSize}px ${metrics.fontFamily}`
                )
              )
            ),
            height: Math.max(metrics.emoteSize, metrics.lineHeight)
          }
      const amountWidth =
        segment.type === 'cheer'
          ? measureNaturalWidth(
              prepareText(String(segment.bits), `${metrics.fontSize}px ${metrics.fontFamily}`)
            ) +
            metrics.rem * 0.2
          : 0
      // The amount has its own text metrics but shares the native inline-grid box.
      box(size.width + metrics.rem * 0.125 + amountWidth, size.height)
    } else
      text(
        plainPresentationText(segment.escaped),
        `${segment.type === 'mention' ? '700 ' : ''}${metrics.fontSize}px ${metrics.fontFamily}`
      )
  }
  height += lineHeight + metrics.padding * 2
  if (inlinePreviews) {
    let count = 0
    for (const segment of presentation.segments ?? []) {
      if (segment.type !== 'url' || tracker.isFailedUrl(segment.url)) continue
      const preview = tracker.getCachedPreview(segment.url)
      if (!preview?.thumbnail || preview.status < 200 || preview.status >= 300) continue
      const dimensions = preview?.thumbnail
        ? tracker.getImageDimensions(preview.thumbnail)
        : undefined
      height += dimensions
        ? fitMedia(
            dimensions.width,
            dimensions.height,
            Math.min(available, metrics.rem * 30),
            metrics.rem * 20
          ).height
        : metrics.fontSize
      count++
    }
    if (count) height += metrics.rem * 0.9 + (count - 1) * metrics.rem * 0.5
  }
  const result = Math.max(1, height)
  layoutCache.set(presentation, { width, metrics, inlinePreviews, media, height: result })
  return result
}
