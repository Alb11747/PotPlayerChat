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
 * URL regex pattern that matches HTTP/HTTPS URLs
 */
const URL_REGEX = /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w._~:/?#[\]@!$&'()*+,;=-])*)?/gi

/**
 * Processes text to make URLs clickable while escaping other HTML.
 * @param text The text to process.
 * @returns HTML string with clickable URLs.
 */
export function parseUrlsFromMessage(
  text: string
): Array<{ type: 'text'; escaped: string } | { type: 'url'; escaped: string; url: string }> {
  const segments: ReturnType<typeof parseUrlsFromMessage> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      segments.push({ type: 'text', escaped: escapeHtml(text.slice(lastIndex, match.index)) })
    }

    // Add the URL
    segments.push({ type: 'url', escaped: escapeHtml(match[0]), url: match[0] })

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', escaped: escapeHtml(text.slice(lastIndex)) })
  }

  return segments
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

  const markStart = '\uF0000'
  const markEnd = '\uF0001'

  const replaceMark = (str: string): string =>
    str.replaceAll(markStart, '<mark>').replaceAll(markEnd, '</mark>')

  if (searchQuery) {
    highlight = true
    const fullText = `${username}: ${message}`
    const markedFullMsg = fullText.replace(searchQuery, (match) => markStart + match + markEnd)
    const splitIndex = markedFullMsg.indexOf(': ')
    if (splitIndex !== -1) {
      processedUsername = markedFullMsg.slice(0, splitIndex)
      processedMessage = markedFullMsg.slice(splitIndex + 2)
    } else {
      console.error('Invalid message format: no ": " found in', markedFullMsg)
    }
  }

  const segments = parseUrlsFromMessage(processedMessage).map((segment) => {
    if (highlight) segment.escaped = replaceMark(segment.escaped)
    return segment
  })

  return {
    escapedUsername: highlight
      ? replaceMark(escapeHtml(processedUsername))
      : escapeHtml(processedUsername),
    parsedMessageSegments: segments
  }
}
