export function normalizeUrl(url: string): string {
  if (typeof url !== 'string' || !url) return ''

  url = url.replaceAll('\\', '/') // Normalize slashes
  url = url.trim()

  return url
}

const streamerNameRegex = /^[A-Za-z0-9_]{3,25}$/
const dateTimePattern = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}-\d{2}-\d{2}Z?`
const dateTimeRegex = new RegExp(
  String.raw`(?<!\d)(\d{4})-(\d{2})-(\d{2})[T ](\d{2})-(\d{2})-(\d{2})Z?(?![A-Za-z0-9])`
)

export interface ParsedStreamTitle {
  startTime: Date
  streamer: string | null
}

export function isPossibleStreamerName(streamer: string): boolean {
  return typeof streamer === 'string' && streamerNameRegex.test(streamer)
}

export function getStreamerFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  // The URL format: https?://username:password@hostname:port/streams/streamerName/title (YYYY-MM-DD HH-MM-SS).ext
  const match = normalizeUrl(url).match(/\/streams?\/([^/]+)/i)
  const streamer = match?.[1]
  return streamer && isPossibleStreamerName(streamer) ? streamer : null
}

export function getTitleFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/\/streams?\/[^/]+\/([^/]+)/i)
  if (!match) return null
  const titlePath = match[1]
  if (!titlePath) return null
  const [title] = titlePath.split('?', 2)
  if (!title) return null
  if (!title.includes('%')) return title
  try {
    return decodeURIComponent(title)
  } catch (error) {
    console.error('Error decoding title:', error)
    return title
  }
}

export function getStartTimeFromTitle(title: string): Date | null {
  return parseStreamTitle(title)?.startTime ?? null
}

export function parseStreamTitle(title: string): ParsedStreamTitle | null {
  if (!title || typeof title !== 'string') return null

  const dateTimeMatch = dateTimeRegex.exec(title)
  if (!dateTimeMatch) return null

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = dateTimeMatch
  if (!yearStr || !monthStr || !dayStr || !hourStr || !minuteStr || !secondStr) return null

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const second = Number(secondStr)

  const startTime = new Date(0)
  startTime.setUTCFullYear(year, month - 1, day)
  startTime.setUTCHours(hour, minute, second, 0)
  if (
    startTime.getUTCFullYear() !== year ||
    startTime.getUTCMonth() !== month - 1 ||
    startTime.getUTCDate() !== day ||
    startTime.getUTCHours() !== hour ||
    startTime.getUTCMinutes() !== minute ||
    startTime.getUTCSeconds() !== second
  )
    return null

  let streamer: string | null = null
  const bracketedStreamerMatch = title.match(
    new RegExp(String.raw`^\[${dateTimePattern}\]\s+\[([^\]]+)\]`)
  )
  const unbracketedStreamerMatch = title.match(
    new RegExp(String.raw`^\[${dateTimePattern}\]\s+([^\s]+)\s+-`)
  )
  const streamerCandidate = bracketedStreamerMatch?.[1] ?? unbracketedStreamerMatch?.[1]
  if (streamerCandidate && isPossibleStreamerName(streamerCandidate)) streamer = streamerCandidate

  return { startTime, streamer }
}
