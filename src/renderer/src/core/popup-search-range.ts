import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@/core/chat/twitch-msg'

export interface PopupSearchRange {
  startTime: number
  endTime: number
}

/** Capture synchronously so delayed loads and nested popups never consult a different recording. */
export function capturePopupSearchRange(context: {
  potplayerInfo: PotPlayerInfo
  searchRange?: PopupSearchRange
  focusedMessage?: TwitchMessage
  clickedMessage?: TwitchMessage
  initialMessages: readonly TwitchMessage[]
}): PopupSearchRange {
  if (context.searchRange) return { ...context.searchRange }

  // The chat supplies its sampled playback range. Other callers can still open a
  // popup using only their captured history, without reaching back into live playback.
  const endTime =
    context.focusedMessage?.timestamp ??
    context.clickedMessage?.timestamp ??
    context.initialMessages.at(-1)?.timestamp ??
    context.potplayerInfo.startTime
  return { startTime: endTime - 60 * 60 * 1000, endTime }
}
