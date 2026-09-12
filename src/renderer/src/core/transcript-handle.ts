import type { TwitchMessage } from '@/core/chat/twitch-msg'
import type { TimelineMap } from '@/utils/datastructs'
import type { MessagePresentationSeed } from './message-presentation'

export interface TranscriptScrollOptions {
  align?: 'start' | 'center' | 'end'
  offset?: number
  smooth?: boolean
}

export interface TranscriptHandle {
  scrollToIndex(index: number, options?: TranscriptScrollOptions): void
  getItemOffset(index: number): number
  getItemSize(index: number): number
  getScrollOffset(): number
  getScrollSize(): number
  getViewportSize(): number
  preservePosition(): void
  clearCache?(): void
  capturePresentation?(
    messages: readonly TwitchMessage[],
    timeline?: Pick<TimelineMap<string, string>, 'get'>
  ): MessagePresentationSeed
}
