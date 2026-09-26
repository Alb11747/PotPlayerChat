import type { TwitchMessage } from '@/core/chat/twitch-msg'

/** Separate the optional lookahead row using the same clock and offsets as the query. */
export function playbackMessageWindow<T extends { timestamp: number }>(
  rows: T[],
  startTime: number,
  currentVideoTime: number,
  timestampOffset: number
): { messages: T[]; nextVideoTime?: number } {
  const last = rows[rows.length - 1]
  if (!last || last.timestamp <= startTime + currentVideoTime + timestampOffset)
    return { messages: rows }
  return {
    messages: rows.slice(0, -1),
    nextVideoTime: last.timestamp - startTime - timestampOffset
  }
}

export function isEqualMessageBoundary(a: TwitchMessage[], b: TwitchMessage[]): boolean {
  if (a.length !== b.length) return false
  if (a[0]?.getId() !== b[0]?.getId()) return false
  if (a[a.length - 1]?.getId() !== b[b.length - 1]?.getId()) return false
  return true
}
