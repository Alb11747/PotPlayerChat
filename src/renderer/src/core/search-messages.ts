import { regExpEscape } from '@/utils/strings'
import type { TwitchMessage } from '@/core/chat/twitch-msg'
import { CooperativeWork } from '@/utils/cooperative-work'
import { HTTP_URL_REGEX } from './message-marks'

type SearchText = { original: string; lowercase?: string }

function read(text: SearchText, lowercase: boolean): string {
  return lowercase ? (text.lowercase ??= text.original.toLowerCase()) : text.original
}

const noUrls: readonly string[] = []

/** Plain link preview details by URL. The source window owns one store; every
 * tracker given it records previews as they load, so search never fetches. */
export class SearchPreviewTexts {
  private readonly texts = new Map<string, SearchText>()

  set(url: string, text: string | undefined): void {
    if (text) this.texts.set(url, { original: text })
    else this.texts.delete(url)
  }

  get(url: string, lowercase = false): string | undefined {
    const text = this.texts.get(url)
    return text && read(text, lowercase)
  }
}

export class SearchTextCache {
  private readonly texts = new WeakMap<TwitchMessage, SearchText & { urls: readonly string[] }>()

  constructor(private readonly previews = new SearchPreviewTexts()) {}

  private entry(message: TwitchMessage): SearchText & { urls: readonly string[] } {
    let text = this.texts.get(message)
    if (!text) {
      const body = message.message
      text = {
        original:
          message.type === 'chat'
            ? `${message.username}: ${message.message}`
            : message.getSystemText(),
        // Preview text is looked up by URL at match time, so previews that load
        // later need no invalidation of this per-message entry.
        urls: body?.includes('://')
          ? Array.from(body.matchAll(HTTP_URL_REGEX), (match) => match[0])
          : noUrls
      }
      this.texts.set(message, text)
    }
    return text
  }

  get(message: TwitchMessage, lowercase = false): string {
    return read(this.entry(message), lowercase)
  }

  /** Tests the message text, then the loaded preview details of its links, separately. */
  matches(message: TwitchMessage, test: (text: string) => boolean, lowercase = false): boolean {
    const text = this.entry(message)
    if (test(read(text, lowercase))) return true
    for (const url of text.urls) {
      const preview = this.previews.get(url, lowercase)
      if (preview !== undefined && test(preview)) return true
    }
    return false
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
  const test = regex
    ? (text: string): boolean => {
        // Highlight patterns are global; each tested text must start a fresh match.
        regex.lastIndex = 0
        return regex.test(text)
      }
    : (text: string): boolean => text.includes(normalizedQuery)
  const lowercase = !regex && !caseSensitive
  const results: TwitchMessage[] = []
  for (const message of messages) {
    if (cache.matches(message, test, lowercase)) results.push(message)
    const pause = work.checkpoint()
    if (pause) await pause
  }
  work.throwIfAborted()
  return results
}
