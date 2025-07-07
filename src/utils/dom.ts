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

const p = '[\u{E000}-\u{F8FF}]*'
const PUI_UNICODE_REGEX = new RegExp(p, 'gu')
// /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w._~:/?#[\]@!$&'()*+,;=-])*)?/gi
const URL_REGEX_STR = `h${p}t${p}t${p}p${p}s?${p}:${p}\\/${p}\\/${p}(?:[-\\w.]|${p})+(?:${p}:(?:[0-9]|${p})+)?(?:\\/${p}(?:[\\w._~:/?#[\\]@!$&'()*+,;=-]|${p})*)?`
const URL_REGEX = new RegExp(URL_REGEX_STR, 'gui')

const markStart = '\u{E000}'
const markEnd = '\u{E001}'
const markStartRegex = new RegExp(markStart, 'gu')
const markEndRegex = new RegExp(markEnd, 'gu')

/**
 * Processes text to make URLs clickable while escaping other HTML.
 * @param text The text to process.
 * @returns HTML string with clickable URLs.
 */
function parseUrlsFromMessage(
  text: string
): Array<{ type: 'text'; escaped: string } | { type: 'url'; escaped: string; url: string }> {
  const segments: ReturnType<typeof parseUrlsFromMessage> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index)
      segments.push({ type: 'text', escaped: escapeHtml(textBefore) })
    }

    // Process the URL - check if it has marks and handle them
    const urlText = match[0]
    const url = urlText.replace(PUI_UNICODE_REGEX, '') // Remove PUI unicode characters
    segments.push({ type: 'url', escaped: escapeHtml(urlText), url })

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', escaped: escapeHtml(text.slice(lastIndex)) })
  }

  return segments
}

const replaceMark = (str: string): string =>
  str.replaceAll(markStart, '<mark>').replaceAll(markEnd, '</mark>')

/**
 * Corrects unbalanced marks in a string by adding missing closing or opening marks.
 * @param str The string to correct.
 */
function correctMarks(str: string): string {
  // Ensure marks are correctly closed
  const firstOpenIndex = str.indexOf(markStart)
  const firstCloseIndex = str.indexOf(markEnd)
  const lastOpenIndex = str.lastIndexOf(markStart)
  const lastCloseIndex = str.lastIndexOf(markEnd)
  if (firstOpenIndex === -1 && firstCloseIndex === -1) {
    // No marks at all
    return str
  } else if (firstOpenIndex === -1 || firstCloseIndex === -1) {
    // If one type of mark is missing, add it
    if (firstOpenIndex === -1) {
      // No opening mark, add one at the start
      return markStart + str
    } else if (firstCloseIndex === -1) {
      // No closing mark, add one at the end
      return str + markEnd
    }
  } else if (firstOpenIndex < firstCloseIndex) {
    // Opening mark comes before closing mark
    return str + markEnd
  } else if (lastOpenIndex > lastCloseIndex) {
    // Last opening mark comes after last closing mark
    return markStart + str
  }
  return str
}

export function parseFullMessage(
  username: string,
  message: string,
  searchQuery?: string | RegExp
): {
  escapedUsername: string
  parsedMessageSegments: Array<
    { type: 'text'; escaped: string } | { type: 'url'; escaped: string; url: string }
  >
} {
  let processedMessage = message
  let processedUsername = username
  let highlight = false

  if (searchQuery) {
    highlight = true
    const fullText = `${username}: ${message}`
    const markedFullMsg = fullText.replace(searchQuery, (match) => markStart + match + markEnd)
    const splitIndex = markedFullMsg.indexOf(':') // ": " is the split point
    if (splitIndex !== -1) {
      // Check if a mark is opened before ": " and closed after
      const before = markedFullMsg.slice(0, splitIndex)
      const after = markedFullMsg.slice(splitIndex + 2)
      const openBefore = before.lastIndexOf(markStart) > before.lastIndexOf(markEnd)
      const closeAfter = after.indexOf(markEnd) !== -1

      if (openBefore && closeAfter) {
        // Close before ": ", reopen after
        processedUsername = before + markEnd
        processedMessage = markStart + after
      } else {
        processedUsername = before
        processedMessage = after
      }
    } else {
      console.error('Invalid message format: no ": " found in', markedFullMsg)
    }
  }

  let markDepth = 0
  const segments = parseUrlsFromMessage(processedMessage).map((segment) => {
    const openCount = (segment.escaped.match(markStartRegex) || []).length
    const closeCount = (segment.escaped.match(markEndRegex) || []).length
    const lastMarkDepth = markDepth
    markDepth += openCount - closeCount
    if (lastMarkDepth > 0 && markDepth > 0) {
      // The current segment is nested inside marks
      segment.escaped = markStart + segment.escaped + markEnd
    }
    if (highlight) segment.escaped = replaceMark(correctMarks(segment.escaped))
    return segment
  })

  return {
    escapedUsername: highlight
      ? replaceMark(correctMarks(escapeHtml(processedUsername)))
      : escapeHtml(processedUsername),
    parsedMessageSegments: segments
  }
}
