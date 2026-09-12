import { regExpEscape } from '@/utils/strings'
import type { TwitchMessage } from '@/core/chat/twitch-msg'
import { CooperativeWork } from '@/utils/cooperative-work'

export class SearchTextCache {
  private readonly texts = new WeakMap<TwitchMessage, { original: string; lowercase?: string }>()

  get(message: TwitchMessage, lowercase = false): string {
    let text = this.texts.get(message)
    if (!text) {
      text = {
        original:
          message.type === 'chat'
            ? `${message.username}: ${message.message}`
            : message.getSystemText()
      }
      this.texts.set(message, text)
    }
    return lowercase ? (text.lowercase ??= text.original.toLowerCase()) : text.original
  }
}

export function getSearchPattern(
  query: string,
  caseSensitive: boolean,
  useRegex: boolean
): string | RegExp | undefined {
  if (!query) return undefined
  if (useRegex || !caseSensitive) {
    try {
      return new RegExp(useRegex ? query : regExpEscape(query), caseSensitive ? 'g' : 'gi')
    } catch {
      // Incomplete expressions remain searchable as literal text while the user types.
      return query
    }
  }
  return query
}

export async function filterSearchMessages(
  messages: readonly TwitchMessage[],
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  pattern: string | RegExp | undefined = getSearchPattern(query, caseSensitive, useRegex),
  cache = new SearchTextCache(),
  signal?: AbortSignal
): Promise<readonly TwitchMessage[]> {
  const work = new CooperativeWork(signal)
  work.throwIfAborted()
  if (!query) return messages
  // Patterns can come from the opener's realm; avoid instanceof here.
  const regex =
    useRegex && pattern !== undefined && typeof pattern !== 'string'
      ? new RegExp(pattern.source, pattern.flags)
      : null
  const normalizedQuery = caseSensitive ? query : query.toLowerCase()
  const results: TwitchMessage[] = []
  for (const message of messages) {
    let matches: boolean
    if (regex) {
      // Highlight patterns are global; each transcript row must start a fresh match.
      regex.lastIndex = 0
      matches = regex.test(cache.get(message))
    } else {
      matches = cache.get(message, !caseSensitive).includes(normalizedQuery)
    }
    if (matches) results.push(message)
    const pause = work.checkpoint()
    if (pause) await pause
  }
  work.throwIfAborted()
  return results
}
