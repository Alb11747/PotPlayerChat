export const markData = [
  { name: 'TwitchEmote', start: '\u{E000}', end: '\u{E001}' },
  { name: 'Emote', start: '\u{E002}', end: '\u{E003}' },
  { name: 'Url', start: '\u{E004}', end: '\u{E005}' },
  { name: 'Mention', start: '\u{E006}', end: '\u{E007}' },
  { name: 'Highlight', start: '\u{E008}', end: '\u{E009}' }
] as const

export const MarkType = Object.fromEntries(
  markData.flatMap(({ name, start, end }) => [
    [`${name}Start`, start],
    [`${name}End`, end]
  ])
) as {
  [K in
    | `${(typeof markData)[number]['name']}Start`
    | `${(typeof markData)[number]['name']}End`]: string
}

export const marksList: string[] = markData.flatMap(({ start, end }) => [start, end])

export const markRanking = Object.fromEntries(
  markData.flatMap(({ start, end }, i) => [
    [start, i],
    [end, i]
  ])
)

export const markStarts = Object.fromEntries(
  markData.map(({ start, end }) => [start, end])
) as Record<string, string>

export const markEnds = Object.fromEntries(
  markData.map(({ start, end }) => [end, start])
) as Record<string, string>

export const PUA_UNICODE_REGEX = /[\u{E000}-\u{F8FF}]+/gu
export const HTTP_URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.,~#?&/=]*)/gi
export const NON_HTTP_URL_REGEX =
  /(?<=^|\s)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.,~#?&/=]*)(?=\s|$)/gi

export const highlightStartRegex = new RegExp(MarkType.HighlightStart, 'gu')
export const highlightEndRegex = new RegExp(MarkType.HighlightEnd, 'gu')

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

export function nextIndexOf(str: string, currentIndex: number, chars: string[]): number {
  let nextIndex = str.length
  for (const char of chars) {
    const index = str.indexOf(char, currentIndex)
    if (index !== -1 && index < nextIndex) nextIndex = index
  }
  return nextIndex
}

export function correctMarks(str: string): string {
  const stack: string[] = []
  let prefix = ''
  let suffix = ''
  for (
    let i = nextIndexOf(str, 0, marksList);
    i < str.length;
    i = nextIndexOf(str, i + 1, marksList)
  ) {
    const mark = str[i]!
    if (mark in markStarts) {
      stack.push(mark)
      continue
    }
    const openMark = markEnds[mark]
    if (openMark) {
      if (stack.length === 0) {
        prefix = openMark + prefix
      } else {
        const lastIndex = stack.lastIndexOf(openMark)
        if (lastIndex !== -1) stack.splice(lastIndex, 1)
        else prefix = openMark + prefix
      }
    }
  }
  if (stack.length > 0)
    suffix = stack
      .map((mark) => markStarts[mark])
      .reverse()
      .join('')
  return prefix + str + suffix
}
