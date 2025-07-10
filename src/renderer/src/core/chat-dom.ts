import { NativeTwitchEmote, type TwitchEmote } from '@/chat/twitch-emotes'
import type { TwitchChatMessage } from '@/chat/twitch-msg'
import { regExpEscape } from '@/utils/strings'
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

const MarkType = {
  HighlightStart: '\u{E000}',
  HighlightEnd: '\u{E001}',
  UrlStart: '\u{E002}',
  UrlEnd: '\u{E003}',
  EmoteStart: '\u{E004}',
  EmoteEnd: '\u{E005}'
} as const

const markPairs = [
  [MarkType.HighlightStart, MarkType.HighlightEnd],
  [MarkType.UrlStart, MarkType.UrlEnd],
  [MarkType.EmoteStart, MarkType.EmoteEnd]
] as const

const markOpens = {
  [MarkType.HighlightStart]: MarkType.HighlightEnd,
  [MarkType.UrlStart]: MarkType.UrlEnd,
  [MarkType.EmoteStart]: MarkType.EmoteEnd
} as const

const markEnds = {
  [MarkType.HighlightEnd]: MarkType.HighlightStart,
  [MarkType.UrlEnd]: MarkType.UrlStart,
  [MarkType.EmoteEnd]: MarkType.EmoteStart
} as const

const PUI_UNICODE_REGEX = new RegExp('[\u{E000}-\u{F8FF}]*', 'gu')
const URL_REGEX = /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w._~:/?#[\]@!$&'()*+,;=-])*)?/gi
const URL_MARKED = new RegExp(`${MarkType.UrlStart}(.+?)${MarkType.UrlEnd}`, 'gu')

const highlightStartRegex = new RegExp(MarkType.HighlightStart, 'gu')
const highlightEndRegex = new RegExp(MarkType.HighlightEnd, 'gu')

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
    if (mark in markOpens) {
      // If it's an opening mark, push it onto the stack
      stack.push(mark)
      continue
    }
    const openMark = (markOpens as Record<string, string>)[mark]
    if (openMark) {
      // If it's a closing mark, check the stack
      if (stack.length === 0) {
        // If the stack is empty, we need to add the corresponding opening mark
        prefix = openMark + prefix
      } else if (openMark === stack[stack.length - 1]) {
        // If it matches the last opened mark, pop it from the stack
        stack.pop()
      } else {
        throw new Error(`Unbalanced string: ${str}`)
      }
    }
  }
  // If there are still marks in the stack, we need to add their corresponding closing marks
  if (stack.length > 0)
    suffix = stack
      .map((mark) => (markEnds as Record<string, string>)[mark])
      .reverse()
      .join('')
  return prefix + str + suffix
}

type SegmentNoEscape =
  | { type: 'text' | 'action'; text: string }
  | { type: 'emote'; text: string; url: string; emote: TwitchEmote | NativeTwitchEmote }
  | { type: 'url'; text: string; url: string }
type Segment = SegmentNoEscape & { escaped: string }

export function parseFullMessage(
  username: string,
  message: string,
  {
    twitchMessage,
    twitchEmotes: emotes,
    emotesEnabled = true,
    searchQuery,
    debug = true
  }: {
    twitchMessage?: TwitchChatMessage
    twitchEmotes?: Collection<string, TwitchEmote>
    emotesEnabled?: boolean
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

  // Strip PUI unicode characters from username and message
  processedUsername = processedUsername.replace(PUI_UNICODE_REGEX, '')
  processedMessage = processedMessage.replace(PUI_UNICODE_REGEX, '')

  const nativeEmotes = new Map<string, NativeTwitchEmote>()
  const markIndices: {
    index: number
    char: string
  }[] = []

  // Process search query
  if (searchQuery) {
    const regex =
      typeof searchQuery === 'string' ? new RegExp(regExpEscape(searchQuery), 'gi') : searchQuery
    const fullText = `${processedUsername}: ${processedMessage}`
    for (const match of fullText.matchAll(regex)) {
      const startIndex = (match.index || 0) - processedUsername.length - 2 // Adjust for "username: "
      const endIndex = startIndex + match[0].length
      markIndices.push({ index: startIndex, char: MarkType.HighlightStart })
      markIndices.push({ index: endIndex, char: MarkType.HighlightEnd })
    }
  }

  // Process URLs in the message
  for (const match of processedMessage.matchAll(URL_REGEX)) {
    const url = match[0]
    const startIndex = match.index || 0
    const endIndex = startIndex + url.length
    markIndices.push({ index: startIndex, char: MarkType.UrlStart })
    markIndices.push({ index: endIndex, char: MarkType.UrlEnd })
  }

  // Process external emotes
  if (emotesEnabled && emotes) {
    processedMessage.matchAll(/\S+/g).forEach((word) => {
      if (!word[0] || !emotes.has(word[0])) return
      const endIndex = word.index + word[0].length
      markIndices.push({ index: word.index, char: MarkType.EmoteStart })
      markIndices.push({ index: endIndex, char: MarkType.EmoteEnd })
    })
  }

  // Process Twitch emotes
  if (emotesEnabled && twitchMessage) {
    const twitchEmotes = twitchMessage.emotes
    if (twitchEmotes) {
      for (const { id, startIndex, endIndex } of twitchEmotes) {
        const endIndexAdjusted = endIndex + 1 // Adjust for inclusive end index
        const emoteName = message.slice(startIndex, endIndexAdjusted)
        const emote = new NativeTwitchEmote(id, emoteName)
        nativeEmotes.set(emoteName, emote)
        markIndices.push({ index: startIndex, char: MarkType.EmoteStart })
        markIndices.push({ index: endIndexAdjusted, char: MarkType.EmoteEnd })
      }
    }
  }

  // Insert marks descending by index to avoid index shifting issues
  markIndices.sort((a, b) => (a.index > 0 || b.index > 0 ? b.index - a.index : a.index - b.index))

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

  const urlMatches = processedMessage
    .matchAll(URL_MARKED)
    .toArray()
    .reverse()
    .map((match) => match[1])
    .filter((url): url is string => typeof url === 'string')
    .map((url) => url.trim().replace(PUI_UNICODE_REGEX, ''))

  const preSegmentedMessage = processedMessage
  let segments: SegmentNoEscape[] = [
    { type: isAction ? 'action' : 'text', text: preSegmentedMessage }
  ]

  function nextIndexOf(str: string, currentIndex: number, chars: string[]): number {
    let nextIndex = str.length
    for (const char of chars) {
      const index = str.indexOf(char, currentIndex)
      if (index !== -1 && index < nextIndex) nextIndex = index
    }
    return nextIndex
  }

  for (const [type, startMark, endMark] of [
    ['emote', MarkType.EmoteStart, MarkType.EmoteEnd],
    ['url', MarkType.UrlStart, MarkType.UrlEnd]
  ]) {
    if (!startMark || !endMark) throw new Error(`Invalid mark type: ${type}`)
    segments = segments.reduce<SegmentNoEscape[]>((acc, segment): SegmentNoEscape[] => {
      if (segment.type !== 'text' && segment.type !== 'action') {
        acc.push(segment)
        return acc
      }

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
          const start = startStack.pop() ?? 0
          const end = i
          if (lastIndex < start) {
            const textBefore = segment.text.slice(lastIndex, start)
            acc.push({ type: segment.type, text: textBefore })
          }
          const fullText = segment.text.slice(start, end + endMark.length)
          const text = fullText.slice(startMark.length, end - start).replace(PUI_UNICODE_REGEX, '')
          let failed = false

          if (type === 'emote') {
            // Handle emotes
            const emote = nativeEmotes.get(text) || emotes?.get(text)
            if (emote) {
              acc.push({
                type: 'emote',
                text,
                url: emote.toLink(emote.sizes?.length - 1 || 2),
                emote
              })
            } else {
              console.warn(`No emote found for marked segment: ${message} - ${segment}`)
              failed = true
            }
          } else if (type === 'url') {
            const url = urlMatches.pop()
            if (url) {
              acc.push({
                type: 'url',
                text,
                url
              })
            } else {
              console.warn(`No URL found for marked segment: ${message} - ${segment}`)
              failed = true
            }
          } else {
            console.warn(`Unknown type: ${type} in segment: ${segment.text}`)
            failed = true
          }

          if (failed) {
            acc.push({ type: segment.type, text })
          }

          lastIndex = end + MarkType.HighlightEnd.length
        }
      }
      if (lastIndex < segment.text.length) {
        const textAfter = segment.text.slice(lastIndex)
        if (startStack.length > 0 && type === 'url') {
          // We have an unclosed url, just push the remaining text
          const url = urlMatches[urlMatches.length - 1] // Peek the last URL
          if (!url) {
            console.warn(`No URL found for unclosed segment: ${message} - ${segment}`)
            return acc
          }
          acc.push({ type: 'url', text: textAfter, url })
        } else {
          acc.push({ type: segment.type, text: textAfter })
        }
      }
      return acc
    }, [])
  }

  // Reconstruct segments with emotes and URLs
  if (debug) {
    const msg = segments.map((seg) => seg.text).join('')
    if (msg.replace(PUI_UNICODE_REGEX, '') !== preSegmentedMessage.replace(PUI_UNICODE_REGEX, ''))
      console.warn(`Failed to reconstruct segments: "${preSegmentedMessage}" -> "${msg}"`)
  }

  function replaceMark(str: string): string {
    return str.replace(highlightStartRegex, '<mark>').replace(highlightEndRegex, '</mark>')
  }

  // Carry open marks into following segments
  const markDepthMap = new Map<string, number>()
  const populatedSegments: Segment[] = segments
    .map((segment) => {
      for (const [startMark, endMark] of markPairs) {
        const openCount = (segment.text.match(startMark) || []).length
        const closeCount = (segment.text.match(endMark) || []).length
        const lastMarkDepth = markDepthMap.get(startMark) || 0
        const markDepth = lastMarkDepth + openCount - closeCount
        markDepthMap.set(startMark, markDepth)
        if (lastMarkDepth > 0 && markDepth > 0) {
          // The current segment is nested inside marks
          segment.text = startMark + segment.text + endMark
        }
      }

      return segment
    })
    .map((segment: SegmentNoEscape): Segment => {
      return {
        ...segment,
        escaped:
          markIndices.length > 0
            ? replaceMark(correctMarks(escapeHtml(segment.text)))
            : segment.text
      }
    })

  return {
    escapedUsername:
      markIndices.length > 0
        ? replaceMark(correctMarks(escapeHtml(processedUsername)))
        : processedUsername,
    parsedMessageSegments: populatedSegments
  }
}
