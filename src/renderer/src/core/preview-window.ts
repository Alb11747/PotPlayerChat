import type { EmoteSegment } from './chat-dom'
import { openPopupContext, takePopupContext } from './popup-window'
import type { UrlTracker } from './url-tracker'

export type PreviewWindowContext =
  | {
      kind: 'link'
      url: string
      tracker: UrlTracker
      restoreFocus: () => void
    }
  | {
      kind: 'emote'
      segment: EmoteSegment
      restoreFocus: () => void
    }

export function shouldOpenExpandedPreview(
  enabled: boolean,
  mode: 'hover' | 'expanded',
  ctrlKey: boolean
): boolean {
  return enabled && (mode === 'expanded' || ctrlKey)
}

export function sauceNaoUrl(imageUrl: string | undefined): string | null {
  if (!imageUrl) return null
  try {
    const image = new URL(imageUrl)
    if (!['http:', 'https:'].includes(image.protocol)) return null
    const destination = new URL('https://saucenao.com/search.php')
    destination.searchParams.set('url', imageUrl)
    return destination.href
  } catch {
    return null
  }
}

export function originalLinkActions(
  url: string,
  imageUrl?: string
): { open: string; copy: string; sauceNAO: string | null } {
  return { open: url, copy: url, sauceNAO: sauceNaoUrl(imageUrl) }
}

export function restorePreviewTrigger(trigger: HTMLElement): void {
  if (trigger.isConnected) trigger.focus({ preventScroll: true })
}

export function openPreviewPopup(context: PreviewWindowContext): Window | null {
  return openPopupContext('preview.html', context, 'preview')
}

export function takePreviewContext(): PreviewWindowContext | null {
  return takePopupContext<PreviewWindowContext>()
}
