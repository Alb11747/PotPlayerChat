import { regExpEscape, removePrefix } from '@/utils/strings'
import { NativeTwitchEmote, type TwitchEmote } from '@core/chat/twitch-emotes'
import type { TwitchChatMessage } from '@core/chat/twitch-msg'
import type { Collection } from '@mkody/twitch-emoticons'

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

/**
 * Checks if a message is an action message.
 * Action messages are prefixed with '\u{0001}ACTION ' and suffixed with '\u{0001}'.
 * @param message The message to check.
 * @returns True if the message is an action message, false otherwise.
 */
export function isActionMessage(message: string): boolean {
  return message.startsWith(actionStart) && message.endsWith(actionEnd)
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

let nextPUAId = '\u{E000}'

function genNextPUA(): string {
  const id = nextPUAId
  nextPUAId = String.fromCodePoint(nextPUAId.codePointAt(0)! + 1)
  if (nextPUAId.codePointAt(0)! > 0xf8ff) throw new Error('PUA ID overflow')
  return id
}

const markData = [
  { name: 'TwitchEmote', start: genNextPUA(), end: genNextPUA() },
  { name: 'Emote', start: genNextPUA(), end: genNextPUA() },
  { name: 'Url', start: genNextPUA(), end: genNextPUA() },
  { name: 'Mention', start: genNextPUA(), end: genNextPUA() },
  { name: 'Highlight', start: genNextPUA(), end: genNextPUA() }
] as const

const MarkType = Object.fromEntries(
  markData.flatMap(({ name, start, end }) => [
    [`${name}Start`, start],
    [`${name}End`, end]
  ])
) as {
  [K in
    | `${(typeof markData)[number]['name']}Start`
    | `${(typeof markData)[number]['name']}End`]: string
}

const markRanking = Object.fromEntries(
  markData.flatMap(({ start, end }, i) => [
    [start, i],
    [end, i]
  ])
)

const markStarts = Object.fromEntries(markData.map(({ start, end }) => [start, end])) as Record<
  string,
  string
>

const markEnds = Object.fromEntries(markData.map(({ start, end }) => [end, start])) as Record<
  string,
  string
>

const PUA_UNICODE_REGEX = new RegExp('[\u{E000}-\u{F8FF}]+', 'gu')
const URL_REGEX = /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w._~:/?#[\]@!$&'()*+,;=-])*)?/gi

const highlightStartRegex = new RegExp(MarkType.HighlightStart, 'gu')
const highlightEndRegex = new RegExp(MarkType.HighlightEnd, 'gu')

const legibleMarksData = [
  { start: '(', end: ')', name: 'Parentheses' },
  { start: '[', end: ']', name: 'Square Brackets' },
  { start: '<', end: '>', name: 'Angle Brackets' },
  { start: '{', end: '}', name: 'Curly Braces' },
  { start: '«', end: '»', name: 'Guillemets' },
  { start: '‹', end: '›', name: 'Single Guillemets' },
  { start: '【', end: '】', name: 'Chinese Brackets' },
  { start: '〔', end: '〕', name: 'Japanese Brackets' }
] as const

export function convertStringToLegibleMarks(s: string): string {
  for (const [i, { start, end }] of markData.entries()) {
    const legibleStart = legibleMarksData[i]?.start
    const legibleEnd = legibleMarksData[i]?.end
    s = s.replaceAll(start, legibleStart ?? start)
    s = s.replaceAll(end, legibleEnd ?? end)
  }
  return s
}

/**
 * Corrects unbalanced marks in a string by adding missing closing or opening marks for all mark types.
 * Ensures marks are properly nested and ordered.
 * @param str The string to correct.
 */
export function correctMarks(str: string): string {
  const stack: string[] = []
  let prefix = ''
  let suffix = ''
  for (const mark of str) {
    if (mark in markStarts) {
      // If it's an opening mark, push it onto the stack
      stack.push(mark)
      continue
    }
    const openMark = markStarts[mark]
    if (openMark) {
      // If it's a closing mark, check the stack
      if (stack.length === 0) {
        // If the stack is empty, we need to add the corresponding opening mark
        prefix = openMark + prefix
      } else {
        // Remove the last one that matches openMark
        const lastIndex = stack.lastIndexOf(openMark)
        if (lastIndex !== -1) stack.splice(lastIndex, 1)
        else prefix = openMark + prefix
      }
    }
  }
  // If there are still marks in the stack, we need to add their corresponding closing marks
  if (stack.length > 0)
    suffix = stack
      .map((mark) => markEnds[mark])
      .reverse()
      .join('')
  return prefix + str + suffix
}

export type EmoteSegment = {
  type: 'emote'
  source: string
  url: string
  emote: TwitchEmote | NativeTwitchEmote
  name: string
  zeroWidth?: boolean
  attachedEmotes?: {
    url: string
    emote: TwitchEmote | NativeTwitchEmote
    name: string
    alt: string
  }[]
}

const basicTextTypes = ['text', 'action'] as const
// const partialTextTypes = ['mention', 'url'] as const
type SegmentNoEscape = { fullText: string; text: string } & (
  | { type: 'text' | 'action' | 'highlight' }
  | { type: 'mention'; username: string }
  | { type: 'url'; url: string }
  | EmoteSegment
)
type Segment = SegmentNoEscape & { escaped: string }

export function parseFullMessage(
  username: string,
  message: string,
  {
    twitchMessage,
    twitchEmotes: emotes,
    emotesEnabled = true,
    enableZeroWidthEmotes = true,
    searchQuery,
    debug = true
  }: {
    twitchMessage?: TwitchChatMessage
    twitchEmotes?: Collection<string, TwitchEmote>
    emotesEnabled?: boolean
    enableZeroWidthEmotes?: boolean
    searchQuery?: string | RegExp
    debug?: boolean
  } = {}
): {
  escapedUsername: string
  parsedMessageSegments: Segment[]
} {
  let processedUsername: string = username
  let processedMessage: string = message

  const isAction = isActionMessage(processedMessage)
  if (isAction) processedMessage = stripActionMessage(processedMessage)

  // Strip PUA unicode characters from username and message
  processedUsername = processedUsername.replace(PUA_UNICODE_REGEX, '')
  processedMessage = processedMessage.replace(PUA_UNICODE_REGEX, '')

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
    const fullText = `${processedUsername}: ${processedMessage}`
    for (const match of fullText.matchAll(regex)) {
      const startIndex = (match.index || 0) - processedUsername.length - 2 // Adjust for "username: "
      const endIndex = startIndex + match[0].length
      markIndices.push({ index: startIndex, char: MarkType.HighlightStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.HighlightEnd, otherIndex: startIndex })
    }
  }

  // Process URLs in the message
  const markedUrls: string[] = []
  for (const match of processedMessage.matchAll(URL_REGEX)) {
    const url = match[0]
    const startIndex = match.index || 0
    const endIndex = startIndex + url.length
    markIndices.push({ index: startIndex, char: MarkType.UrlStart, otherIndex: endIndex })
    markIndices.push({ index: endIndex, char: MarkType.UrlEnd, otherIndex: startIndex })
    markedUrls.push(url)
  }
  markedUrls.reverse()

  // Process Twitch emotes
  const markedTwitchEmotes: { index: number; name: string; id?: string }[] = []
  if (emotesEnabled && twitchMessage) {
    const twitchEmotes = twitchMessage.emotes
    if (twitchEmotes) {
      for (const { id, startIndex, endIndex } of twitchEmotes) {
        const endIndexAdjusted = endIndex + 1 // Adjust for inclusive end index
        const emoteName = message.slice(startIndex, endIndexAdjusted)
        markIndices.push({
          index: startIndex,
          char: MarkType.TwitchEmoteStart,
          otherIndex: endIndex
        })
        markIndices.push({
          index: endIndexAdjusted,
          char: MarkType.TwitchEmoteEnd,
          otherIndex: startIndex
        })
        markedTwitchEmotes.push({ index: startIndex, name: emoteName, id })
      }
    }
  }
  markedTwitchEmotes.sort((a, b) => b.index - a.index)

  // Process external emotes
  if (emotesEnabled && emotes) {
    processedMessage.matchAll(/\S+/g).forEach((word) => {
      const emoteName = word[0]
      const emote = emotes.get(emoteName)
      if (!emoteName || !emote) return
      const endIndex = word.index + emoteName.length
      markIndices.push({ index: word.index, char: MarkType.EmoteStart, otherIndex: endIndex })
      markIndices.push({ index: endIndex, char: MarkType.EmoteEnd, otherIndex: word.index })
    })
  }

  // Process mentions in the message
  const markedMentions: string[] = []
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

  // Remove duplicates
  const uniqueMarks = new Map<string, { index: number; char: string }>()
  for (let i = 0; i < markIndices.length; i++) {
    const mark = markIndices[i]
    if (!mark) continue
    const key = `${mark.index}:${mark.char}`
    if (!uniqueMarks.has(key)) {
      uniqueMarks.set(key, mark)
    } else {
      markIndices.splice(i, 1)
      i-- // Adjust index after removal
    }
  }

  for (const mark of markIndices) {
    if (mark.index < 0) {
      // Negative index means the mark is in the username
      const index = mark.index + processedUsername.length + 2 // Adjust for "username: "
      processedUsername =
        processedUsername.slice(0, index) + mark.char + processedUsername.slice(index)
    } else {
      processedMessage =
        processedMessage.slice(0, mark.index) + mark.char + processedMessage.slice(mark.index)
    }
  }

  const balancedMessage = correctMarks(processedMessage)
  if (balancedMessage !== processedMessage) {
    console.warn(
      `Unbalanced marks corrected in message: "${processedMessage}" -> "${balancedMessage}"`
    )
    processedMessage = balancedMessage
  }

  const preSegmentedMessage = processedMessage
  let segments: SegmentNoEscape[] = [
    { type: isAction ? 'action' : 'text', fullText: preSegmentedMessage, text: preSegmentedMessage }
  ]

  function nextIndexOf(str: string, currentIndex: number, chars: string[]): number {
    let nextIndex = str.length
    for (const char of chars) {
      const index = str.indexOf(char, currentIndex)
      if (index !== -1 && index < nextIndex) nextIndex = index
    }
    return nextIndex
  }

  function processSegment(
    acc: SegmentNoEscape[],
    segment: SegmentNoEscape,
    type: string,
    fullText: string,
    text: string,
    opts: { source?: string } = {}
  ): boolean {
    if (type === 'emote') {
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
      const url = emote.toLink(emote.sizes?.length - 1 || 2)
      const source = opts?.source || ''
      const name = emoteName || text.replace(PUA_UNICODE_REGEX, '')
      acc.push({ type, source, fullText, text, url, emote, name, zeroWidth })
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
        let i = 0;
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
        url: next2Segment.url,
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
      const openCount = (segment.fullText.match(startMark) || []).length
      const closeCount = (segment.fullText.match(endMark) || []).length
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

  const populatedSegments: Segment[] = segments.map((segment: SegmentNoEscape): Segment => {
    let escaped =
      markIndices.length > 0
        ? replaceMark(correctMarks(escapeHtml(segment.text))).replace(PUA_UNICODE_REGEX, '')
        : segment.text

    if (segment.type === 'highlight') escaped = `<mark>${escaped}</mark>`

    const processedSegment = {
      ...segment,
      escaped
    }

    if (debug && PUA_UNICODE_REGEX.test(processedSegment.escaped)) {
      console.warn(
        `PUA unicode characters found in segment: "${processedSegment.escaped}" - ${JSON.stringify(
          processedSegment
        )}`
      )
    }

    return processedSegment
  })

  return {
    escapedUsername:
      markIndices.length > 0
        ? replaceMark(correctMarks(escapeHtml(processedUsername)))
        : processedUsername,
    parsedMessageSegments: populatedSegments
  }
}
