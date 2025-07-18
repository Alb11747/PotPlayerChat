export function getStreamerFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  // The URL format: https?://username:password@hostname:port/streams/streamerName/title (YYYY-MM-DD HH-MM-SS).ext
  const match = url.match(/\/streams?\/([^/]+)/)
  return match ? (match[1] ?? null) : null
}

export function getTitleFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/\/streams?\/[^/]+\/([^/]+)/)
  if (!match) return null
  const titlePath = match[1]
  if (!titlePath) return null
  const [title] = titlePath.split('?', 2)
  if (!title) return null
  return decodeURIComponent(title)
}

export function getStartTimeFromTitle(title: string): Date | null {
  if (!title || typeof title !== 'string') return null

  const match = title.match(/\((\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})\)\./)
  if (!match) return null
  const dateTimeStr = match[1]
  if (!dateTimeStr) return null
  const [date, time] = dateTimeStr.split(' ')
  if (!date || !time) return null

  // Parse "YYYY-MM-DD HH-MM-SS" as "YYYY-MM-DDTHH:MM:SSZ" (UTC)
  const isoString = `${date}T${time.replaceAll('-', ':')}Z`
  const parsedDate = new Date(isoString)
  return isNaN(parsedDate.getTime()) ? null : parsedDate
}
