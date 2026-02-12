import type { CheerEmote } from '@/core/chat/twitch-emotes'
import {
  countOccurrences,
  regExpEscape,
  removePrefix,
  utf8IndexToUtf16IndexMap
} from '@/utils/strings'
import { NativeTwitchEmote, type TwitchEmote } from '@core/chat/twitch-emotes'
import type { TwitchMessage } from '@core/chat/twitch-msg'
import type { Collection, Emote } from '@mkody/twitch-emoticons'
import type { CheermoteScale } from '@twurple/api/lib/endpoints/bits/CheermoteDisplayInfo'
import {
  HTTP_URL_REGEX,
  MarkType,
  NON_HTTP_URL_REGEX,
  PUA_UNICODE_REGEX,
  correctMarks,
  highlightEndRegex,
  highlightStartRegex,
  markData,
  markEnds,
  markRanking,
  markStarts,
  nextIndexOf
} from './message-marks'

/**
 * Escapes HTML special characters in a string.
 * @param text The string to escape.
 * @returns The escaped string.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/**
 * Unescapes HTML special characters in a string.
 * @param text The string to unescape.
 * @returns The unescaped string.
 */
export function unescapeHtml(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
}

const actionStart = '\u{0001}ACTION '
const actionEnd = '\u{0001}'

export { convertStringToLegibleMarks } from './message-marks'

/**
 * Checks if a message is an action message.
 * Action messages are prefixed with '\u{0001}ACTION ' and suffixed with '\u{0001}'.
 * @param message The message to check.
 * @returns True if the message is an action message, false otherwise.
 */
export function isActionMessage(message?: string): boolean {
  return !!message && message.startsWith(actionStart) && message.endsWith(actionEnd)
}

/**
 * Strips the action message markers from a message.
 * If the message is not an action message, it returns the original message.
 * @param message The message to strip.
 * @returns The stripped message.
 */
export function stripActionMessage(message: string): string {
  if (isActionMessage(message)) return message.slice(actionStart.length, -actionEnd.length)
  return message
}

export type EmoteSegment =
  | {
      type: 'emote'
      source: string
      urls: Record<string, string>
      emote: TwitchEmote | NativeTwitchEmote
      name: string
      zeroWidth?: boolean
      attachedEmotes?: {
        urls: Record<string, string>
        emote: TwitchEmote | NativeTwitchEmote
        name: string
        alt: string
      }[]
    }
  | {
      type: 'cheer'
      urls: Record<CheermoteScale, string>
      emote: CheerEmote
      name: string
      bits: number
    }

const basicTextTypes = ['text', 'action'] as const
// const partialTextTypes = ['mention', 'url'] as const
type SegmentNoEscape = { fullText: string; text: string } & (
  | { type: 'text' | 'action' | 'highlight' }
  | { type: 'mention'; username: string }
  | { type: 'url'; url: string }
  | EmoteSegment
)
export type Segment = SegmentNoEscape & { escaped: string; index: number }

export function parseFullMessage(
  messageObj: TwitchMessage,
  {
    messagePrefix,
    messageStr,
    twitchEmotes: emotes,
    enableEmotes = true,
    enableZeroWidthEmotes = true,
    enableUrls = true,
    enableMentions = true,
    showName = 'displayFirst',
    searchQuery,
    requireHttpInUrl = true,
    debug = true
  }: {
    messagePrefix?: string
    messageStr?: string | null
    processedMessage?: string | null
    twitchEmotes?: Collection<string, Emote | CheerEmote>
    enableEmotes?: boolean
    enableZeroWidthEmotes?: boolean
    enableUrls?: boolean
    enableMentions?: boolean
    showName?: 'username' | 'displayName' | 'usernameFirst' | 'displayFirst'
    searchQuery?: string | RegExp
    requireHttpInUrl?: boolean
    debug?: boolean
  } = {}
): [string, Segment[] | undefined] {
  const { username = '', message = '' } = messageObj
  let processedMessage: string | undefined =
    messageStr === null ? messageStr || undefined : (messageStr ?? message)

  if (messagePrefix) {
    /* empty */
  } else if (messageObj.type === 'system' || showName === 'username' || !messageObj.displayName) {
    messagePrefix = username || ''
  } else if (
    showName === 'displayName' ||
    username.toLowerCase() === messageObj.displayName.toLowerCase()
  ) {
    messagePrefix = messageObj.displayName
  } else if (showName === 'usernameFirst') {
    messagePrefix = `${username} (${messageObj.displayName})`
  } else {
    messagePrefix = `${messageObj.displayName} (${username})`
  }

  const isAction = isActionMessage(processedMessage)
  if (isAction && processedMessage) processedMessage = stripActionMessage(processedMessage)

  // Strip PUA unicode characters from username and message
  messagePrefix = messagePrefix.replace(PUA_UNICODE_REGEX, '')
  processedMessage = processedMessage && processedMessage.replace(PUA_UNICODE_REGEX, '')

  const isAscii = !processedMessage || /^\p{ASCII}+$/u.test(processedMessage)
  const utf16IndexMap =
    !isAscii && processedMessage ? utf8IndexToUtf16IndexMap(processedMessage) : undefined

  type CharIndex = {
    index: number
    char: string
    otherIndex: number
  }
  const markIndices: CharIndex[] = []

  // Process search query
  if (searchQuery) {
    const regex =
      typeof searchQuery === 'string' ? new RegExp(regExpEscape(searchQuery), 'gi') : searchQuery
    const fullText = processedMessage ? `${messagePrefix}: ${processedMessage}` : messagePrefix
    const extraPrefixLength = processedMessage ? 2 : 0 // Length of ": " after messagePrefix
    for (const match of fullText.matchAll(regex)) {
      const startIndex = (match.index || 0) - messagePrefix.length - extraPrefixLength // Adjust for "messagePrefix: "
      const endIndex = startIndex + match[0].length
      markIndices.push({ index: startIndex, char: MarkType.HighlightStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.HighlightEnd, otherIndex: startIndex })
    }
  }

  // Process URLs in the message
  const markedUrls: string[] = []
  if (enableUrls && processedMessage) {
    const urlRegex = requireHttpInUrl ? HTTP_URL_REGEX : NON_HTTP_URL_REGEX
    for (const match of processedMessage.matchAll(urlRegex)) {
      const url = match[0]
      const startIndex = match.index || 0
      const endIndex = startIndex + url.length
      markIndices.push({ index: startIndex, char: MarkType.UrlStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.UrlEnd, otherIndex: startIndex })
      markedUrls.push(url)
    }
    markedUrls.reverse()
  }

  // Process Twitch emotes
  const markedTwitchEmotes: { index: number; name: string; id?: string }[] = []
  if (enableEmotes && messageObj) {
    const twitchEmotes = messageObj.emotes
    if (twitchEmotes) {
      for (const {
        id,
        startIndex: utf8StartIndex,
        endIndex: utf8EndIndexInclusive
      } of twitchEmotes) {
        let startIndex: number | undefined
        let endIndex: number | undefined
        if (utf16IndexMap) {
          startIndex = utf16IndexMap[utf8StartIndex]
          endIndex = utf16IndexMap[utf8EndIndexInclusive + 1]
        } else {
          startIndex = utf8StartIndex
          endIndex = utf8EndIndexInclusive + 1
        }
        if (startIndex === undefined || endIndex === undefined) {
          console.warn(`Invalid emote index: ${utf8StartIndex} - ${utf8EndIndexInclusive}`, message)
          continue
        }

        const emoteName = message.slice(startIndex, endIndex)
        markIndices.push({
          index: startIndex,
          char: MarkType.TwitchEmoteStart,
          otherIndex: endIndex
        })
        markIndices.push({
          index: endIndex,
          char: MarkType.TwitchEmoteEnd,
          otherIndex: startIndex
        })
        markedTwitchEmotes.push({ index: startIndex, name: emoteName, id })
      }
    }
  }
  markedTwitchEmotes.sort((a, b) => b.index - a.index)

  // Process external emotes
  if (enableEmotes && emotes && processedMessage) {
    for (const word of processedMessage.matchAll(/\S+/g)) {
      const emoteName = word[0]
      const emote = emotes.get(emoteName)
      if (!emoteName || !emote) continue
      const endIndex = word.index + emoteName.length
      markIndices.push({ index: word.index, char: MarkType.EmoteStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.EmoteEnd, otherIndex: word.index })
    }
  }

  // Process mentions in the message
  const markedMentions: string[] = []
  if (enableMentions && processedMessage) {
    for (const match of processedMessage.matchAll(/(?<=^|\s)(@[\p{L}\p{M}\p{N}_]+)(?=\s|$)/gu)) {
      const usernameMatch = match[1]
      if (!usernameMatch) continue
      const startIndex = match.index || 0
      const endIndex = startIndex + usernameMatch.length
      markIndices.push({ index: startIndex, char: MarkType.MentionStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.MentionEnd, otherIndex: startIndex })
      markedMentions.push(removePrefix(usernameMatch, '@'))
    }
    markedMentions.reverse()
  }

  // Insert marks descending by index to avoid index shifting issues
  function compare(a: CharIndex, b: CharIndex): number {
    if (a.index < 0 && b.index >= 0) return 1 // Negative index (username) should come after positive index (message)
    if (a.index >= 0 && b.index < 0) return -1 // Positive index (message) should come before negative index (username)
    console.assert(a.index < 0 === b.index < 0)
    const isNegative = a.index < 0
    const sign = isNegative ? -1 : 1 // If both are negative, flip the order
    // Higher index comes first
    if (b.index !== a.index) return sign * (b.index - a.index)
    if (a.char === b.char) return 0 // Same mark, keep order stable
    // Marks are inserted left-to-right, and each insertion shifts the string to the right.
    // So a mark inserted earlier will appear further to the right in the final string.
    const isOpenA = markStarts[a.char] !== undefined
    const isOpenB = markStarts[b.char] !== undefined
    // Opening marks should come before closing marks - Result: )[
    if (isOpenA && !isOpenB) return sign * -1
    if (!isOpenA && isOpenB) return sign * 1
    console.assert(isOpenA === isOpenB)
    const isOpen = isOpenA
    //Lower otherIndex should come first - Result: ([__]__)
    if (a.otherIndex < b.otherIndex) return sign * -1
    if (a.otherIndex > b.otherIndex) return sign * 1
    const rankA = markRanking[a.char] ?? 0
    const rankB = markRanking[b.char] ?? 0
    // Higher rank should come first in insertion order (Opening) — ends up inside
    // Lower rank should come first in insertion order (Closing) — ends up outside
    // Lower rank should surround higher rank
    // E.g. Rank('(') < Rank('[') - Result: ([__])
    if (rankA !== rankB) return (isOpen ? 1 : -1) * sign * (rankB - rankA)
    // If all else is equal, keep the order stable
    return 0
  }
  markIndices.sort(compare)

  // Remove duplicates in linear time
  const seenMarkKeys = new Set<string>()
  const dedupedMarkIndices: CharIndex[] = []
  for (const mark of markIndices) {
    const key = `${mark.index}:${mark.char}`
    if (seenMarkKeys.has(key)) continue
    seenMarkKeys.add(key)
    dedupedMarkIndices.push(mark)
  }
  markIndices.length = 0
  markIndices.push(...dedupedMarkIndices)

  for (const mark of markIndices) {
    if (mark.index < 0) {
      // Negative index means the mark is in the username
      const index: number = mark.index + messagePrefix.length + 2 // Adjust for "messagePrefix: "
      messagePrefix = messagePrefix.slice(0, index) + mark.char + messagePrefix.slice(index)
    } else if (processedMessage) {
      processedMessage =
        processedMessage.slice(0, mark.index) + mark.char + processedMessage.slice(mark.index)
    }
  }

  const balancedMessage = processedMessage && correctMarks(processedMessage)
  if (balancedMessage !== processedMessage) {
    console.warn(
      `Unbalanced marks corrected in message: "${processedMessage}" -> "${balancedMessage}"`
    )
    processedMessage = balancedMessage
  }

  function parseSegment(str: string): string {
    return markIndices.length > 0 ? replaceMark(correctMarks(escapeHtml(str))) : str
  }

  if (!processedMessage) return [parseSegment(messagePrefix), undefined]

  let preSegmentedMessage = processedMessage
  let segments: SegmentNoEscape[] = [
    { type: isAction ? 'action' : 'text', fullText: preSegmentedMessage, text: preSegmentedMessage }
  ]

  function processSegment(
    acc: SegmentNoEscape[],
    segment: SegmentNoEscape,
    type: string,
    fullText: string,
    text: string,
    opts: { source?: string } = {}
  ): boolean {
    if (type === 'emote' || type === 'cheer') {
      let emoteName: string | undefined
      let emoteId: string | undefined
      let zeroWidth: boolean | undefined

      if (opts?.source === 'twitch') {
        const emoteData = markedTwitchEmotes.pop()
        emoteName = emoteData?.name
        emoteId = emoteData?.id

        console.assert(
          emoteName === text.replace(PUA_UNICODE_REGEX, ''),
          `Emote name mismatch: ${text}`
        )
      } else {
        emoteName = text.replace(PUA_UNICODE_REGEX, '')
        const emote = emotes?.get(emoteName)
        if (emote) {
          zeroWidth = 'zeroWidth' in emote ? !!emote.zeroWidth : undefined
        } else {
          console.warn(`Emote not found in collection: ${emoteName}`, segment)
        }
      }

      const emote = emoteId
        ? new NativeTwitchEmote(emoteId, emoteName)
        : emotes?.get(emoteName || '')

      if (!emote) {
        console.warn(`No emote found for marked segment: ${message}`, segment)
        return false
      }
      if (type === 'emote' && 'toLink' in emote) {
        const maxSize = emote.sizes?.length - 1 || 2
        const urls: Record<string, string> = {}
        for (let i = 0; i <= maxSize; i++) urls[(i + 1).toString()] = emote.toLink(i)
        const source = opts?.source || ''
        const name = emoteName || text.replace(PUA_UNICODE_REGEX, '')
        acc.push({ type, source, fullText, text, urls, emote, name, zeroWidth })
      } else if ('source' in emote && emote.source === 'cheer') {
        const type = 'cheer'
        const urls = emote.urls
        const bits = emote.bits
        const name = emote.name
        acc.push({ type, fullText, text, urls, emote, bits, name })
      } else {
        console.warn(`Unknown emote type: ${type}`, segment)
        return false
      }
    } else if (type === 'url') {
      const url = markedUrls.pop()
      if (!url) {
        console.warn(`No URL found for marked segment: ${message}`, segment)
        return false
      }
      acc.push({ type, fullText, text, url })
    } else if (type === 'highlight') {
      acc.push({ type, fullText, text })
    } else if (type === 'mention') {
      let username = markedMentions.pop()
      if (!username) {
        console.warn(`No username found for marked segment: ${message}`, segment)
        username = removePrefix(text, '@') // Fallback to text if no mention found
      }
      acc.push({ type, fullText, text, username })
    } else {
      console.warn(`Unknown type: ${type} in segment: ${segment.text}`, segment)
      return false
    }
    return true
  }

  for (const { t: type, s: startMark, e: endMark, o: opts } of [
    {
      t: 'emote',
      s: MarkType.TwitchEmoteStart,
      e: MarkType.TwitchEmoteEnd,
      o: { source: 'twitch' }
    },
    { t: 'emote', s: MarkType.EmoteStart, e: MarkType.EmoteEnd, o: { source: 'external' } },
    { t: 'url', s: MarkType.UrlStart, e: MarkType.UrlEnd },
    { t: 'highlight', s: MarkType.HighlightStart, e: MarkType.HighlightEnd },
    { t: 'mention', s: MarkType.MentionStart, e: MarkType.MentionEnd }
  ]) {
    if (!type || !startMark || !endMark) throw new Error(`Invalid mark type: ${type}`)
    segments = segments.reduce<SegmentNoEscape[]>((acc, segment): SegmentNoEscape[] => {
      if (!basicTextTypes.includes(segment.type as (typeof basicTextTypes)[number])) {
        acc.push(segment)
        return acc
      }
      segment.type = segment.type as (typeof basicTextTypes)[number]

      let lastIndex = 0
      const startStack: number[] = []
      for (
        let i = nextIndexOf(segment.text, 0, [startMark, endMark]);
        i < segment.text.length;
        i = nextIndexOf(segment.text, i + 1, [startMark, endMark])
      ) {
        if (segment.text.slice(i, i + startMark.length) === startMark) {
          startStack.push(i)
        } else if (segment.text.slice(i, i + endMark.length) === endMark) {
          const start = startStack.pop() ?? null
          const end = i
          if (lastIndex < (start ?? 0)) {
            const textBefore = segment.text.slice(lastIndex, start ?? 0)
            acc.push({ type: segment.type, fullText: textBefore, text: textBefore })
          }
          const fullText = segment.text.slice(start ?? 0, end + endMark.length)
          const text = fullText.slice(start === null ? 0 : startMark.length, end - (start ?? 0))
          if (!processSegment(acc, segment, type, fullText, text, opts))
            acc.push({ type: segment.type, fullText, text })
          lastIndex = end + MarkType.HighlightEnd.length
        }
      }
      if (lastIndex < segment.text.length) {
        if (startStack.length > 0) {
          const firstStart = startStack[0]!
          const textBeforeStartMark = segment.text.slice(lastIndex, firstStart)
          acc.push({ type: segment.type, fullText: textBeforeStartMark, text: textBeforeStartMark })
          const textAfterStartMark = segment.text.slice(firstStart + startMark.length)
          const textAfterIncludingStartMark = segment.text.slice(firstStart)

          if (type === 'url') {
            // We have an unclosed url, just push the remaining text
            const url = markedUrls[markedUrls.length - 1] // Peek the last URL
            if (!url) console.warn(`No URL found for unclosed segment: ${message}`, segment)
            acc.push({
              type: type,
              fullText: textAfterIncludingStartMark,
              text: textAfterStartMark,
              url: url || ''
            })
          } else if (type === 'mention') {
            // We have an unclosed mention, just push the remaining text
            const username = markedMentions[markedMentions.length - 1] // Peek the last mention
            if (!username)
              console.warn(`No username found for unclosed segment: ${message}`, segment)
            acc.push({
              type: type,
              fullText: textAfterIncludingStartMark,
              text: textAfterStartMark,
              username: username || ''
            })
          } else
            acc.push({
              type: segment.type,
              fullText: textAfterIncludingStartMark,
              text: textAfterIncludingStartMark
            })
        } else {
          const textAfterEndMark = segment.text.slice(lastIndex)
          acc.push({ type: segment.type, fullText: textAfterEndMark, text: textAfterEndMark })
        }
      }
      return acc
    }, [])
  }

  if (enableZeroWidthEmotes) {
    for (let i = 0; i < segments.length - 2; i++) {
      // Segment 1: Emote
      const segment = segments[i]
      if (!segment || segment.type !== 'emote') continue

      // Segment 3: Zero-width Emote
      const next2Segment = segments[i + 2]
      if (!next2Segment || next2Segment.type !== 'emote' || !next2Segment.zeroWidth) continue

      // Segment 2: Whitespace
      const next1Segment = segments[i + 1]
      if (
        !next1Segment ||
        !basicTextTypes.includes(next1Segment.type as (typeof basicTextTypes)[number])
      )
        continue
      if (next1Segment.text.replace(PUA_UNICODE_REGEX, '').trim() !== '') continue

      // Merge zero-width emote with current segment
      segment.fullText += next1Segment.fullText + next2Segment.fullText
      segment.text += next1Segment.text + next2Segment.text
      segment.attachedEmotes = segment.attachedEmotes || []
      segment.attachedEmotes.push({
        urls: next2Segment.urls,
        emote: next2Segment.emote,
        name: next2Segment.name,
        alt:
          next1Segment.text.replace(PUA_UNICODE_REGEX, '') +
          next2Segment.text.replace(PUA_UNICODE_REGEX, '')
      })
      segments.splice(i + 1, 2) // Remove the whitespace and zero-width emote segments
      i-- // Adjust index after removal
    }
  }

  // Prevents weird highlighting behavior when searching 'username: '
  const firstSegment = segments[0]
  if (
    firstSegment &&
    firstSegment.type === 'highlight' &&
    firstSegment.fullText === MarkType.HighlightEnd &&
    !messagePrefix.endsWith(MarkType.HighlightStart)
  ) {
    messagePrefix += firstSegment.fullText
    segments.shift()
    preSegmentedMessage = removePrefix(preSegmentedMessage, firstSegment.fullText)
  }

  // Reconstruct segments with emotes and URLs
  if (debug) {
    const msg = segments.map((seg) => seg.fullText).join('')
    if (msg !== preSegmentedMessage)
      console.warn(`Failed to reconstruct segments: "${preSegmentedMessage}" -> "${msg}"`)
  }

  function replaceMark(str: string): string {
    return str.replace(highlightStartRegex, '<mark>').replace(highlightEndRegex, '</mark>')
  }

  // Carry open marks into next segments
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const nextSegment = segments[i + 1]
    if (!segment || !nextSegment) continue
    while (true) {
      const lastCharFull = segment.fullText.slice(-1)
      if (!(lastCharFull in markStarts)) break
      segment.fullText = segment.fullText.slice(0, -1) // Remove last character
      nextSegment.fullText = lastCharFull + nextSegment.fullText // Prepend to next segment
      const lastChar = segment.text.slice(-1)
      if (!(lastChar in markEnds)) break
      // If the last character is a closing mark, we need to remove it from the current segment
      segment.text = segment.text.slice(0, -1) // Remove last character
      nextSegment.text = lastChar + nextSegment.text // Prepend to next segment
    }
  }

  // Carry closing marks into previous segments
  for (let i = segments.length - 1; i > 0; i--) {
    const prevSegment = segments[i - 1]
    const segment = segments[i]
    if (!prevSegment || !segment) continue
    while (true) {
      const firstCharFull = segment.fullText.slice(0, 1)
      if (!(firstCharFull in markEnds)) break
      segment.fullText = segment.fullText.slice(1) // Remove first character
      prevSegment.fullText += firstCharFull // Append to previous segment
      const firstChar = segment.fullText.slice(0, 1)
      if (!(firstChar in markStarts)) break
      // If the first character is an opening mark, we need to remove it from the next segment
      segment.text = segment.text.slice(1) // Remove first character
      prevSegment.text += firstChar // Append to previous segment
    }
  }

  // Filter out empty segments
  segments = segments.filter((segment) => {
    if (!segment) return false
    return segment.fullText !== '' || segment.text !== ''
  })

  // Carry open marks into following segments
  const markDepthMap = new Map<string, number>()
  segments = segments.map((segment) => {
    for (const { start: startMark, end: endMark } of markData) {
      const openCount = countOccurrences(segment.fullText, startMark)
      const closeCount = countOccurrences(segment.fullText, endMark)
      const lastMarkDepth = markDepthMap.get(startMark) || 0
      const currentMarkDepth = openCount - closeCount
      const totalMarkDepth = lastMarkDepth + currentMarkDepth
      markDepthMap.set(startMark, totalMarkDepth)
      if (lastMarkDepth > 0) {
        segment.text = startMark.repeat(lastMarkDepth) + segment.text
      }
    }
    return segment
  })

  const populatedSegments: Segment[] = segments.map(
    (segment: SegmentNoEscape, index: number): Segment => {
      let escaped =
        markIndices.length > 0
          ? parseSegment(segment.text).replace(PUA_UNICODE_REGEX, '')
          : segment.text

      if (segment.type === 'highlight') escaped = `<mark>${escaped}</mark>`

      const processedSegment = {
        ...segment,
        escaped,
        index
      }

      if (debug && PUA_UNICODE_REGEX.test(processedSegment.escaped)) {
        console.warn(
          `PUA unicode characters found in segment: "${processedSegment.escaped}" - ${JSON.stringify(
            processedSegment
          )}`
        )
      }

      return processedSegment
    }
  )

  return [parseSegment(messagePrefix), populatedSegments]
}
