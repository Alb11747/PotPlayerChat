import type { TwitchMessage } from '@/core/chat/twitch-msg'
import type { MessagePresentationSeed } from './message-presentation'

export const SEARCH_PREVIEW_LIMIT = 200

export interface SearchPreview {
  readonly messages: readonly TwitchMessage[]
  readonly presentation?: MessagePresentationSeed
}

/** Source histories are chronological; only inspect the target's timestamp neighborhood. */
function findTarget(messages: readonly TwitchMessage[], target: TwitchMessage): number {
  let low = 0
  let high = messages.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (messages[middle]!.timestamp < target.timestamp) low = middle + 1
    else high = middle
  }
  const id = target.getId()
  for (
    let i = low;
    i < Math.min(messages.length, low + SEARCH_PREVIEW_LIMIT) &&
    messages[i]!.timestamp === target.timestamp;
    i++
  ) {
    if (messages[i] === target || messages[i]!.getId() === id) return i
  }
  return -1
}

export function selectSearchPreview(
  initial: readonly TwitchMessage[],
  loaded: readonly TwitchMessage[],
  focused?: TwitchMessage
): readonly TwitchMessage[] {
  let source = initial.length ? initial : loaded
  let index = source.length - 1
  if (focused) {
    const initialIndex = findTarget(initial, focused)
    const loadedIndex = initialIndex < 0 ? findTarget(loaded, focused) : -1
    if (initialIndex >= 0) {
      source = initial
      index = initialIndex
    } else if (loadedIndex >= 0) {
      source = loaded
      index = loadedIndex
    } else return [focused]
  }
  const start = Math.max(
    0,
    Math.min(index - Math.floor(SEARCH_PREVIEW_LIMIT / 2), source.length - SEARCH_PREVIEW_LIMIT)
  )
  const ids = new Set<string>()
  return source.slice(start, start + SEARCH_PREVIEW_LIMIT).filter((message) => {
    const id = message.getId()
    if (ids.has(id)) return false
    ids.add(id)
    return true
  })
}
