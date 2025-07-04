/**
 * Escapes HTML special characters in a string.
 * @param text The string to escape.
 * @returns The escaped string.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
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
export function parseMessage(text: string): Array<{ type: 'text' | 'url'; content: string }> {
  const segments: Array<{ type: 'text' | 'url'; content: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    // Add the URL
    segments.push({ type: 'url', content: match[0] })

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return segments
}
