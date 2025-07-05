export function getStreamerFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  // The URL format: https?://username:password@hostname:port/streams/streamerName/title (YYYY-MM-DD HH-MM-SS).ext
  const match = url.match(/\/streams?\/([^/]+)/)
  return match ? match[1] : null
}

export function getStartTimeFromTitle(title: string): Date | null {
  if (!title || typeof title !== 'string') return null

  // The title format is expected to be like "Stream Title (YYYY-MM-DD HH-MM-SS).ext"
  const match = title.match(/\((\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})\)\./)
  if (!match) return null

  const dateStr = match[1]
  // Parse "YYYY-MM-DD HH-MM-SS" as "YYYY-MM-DDTHH:MM:SSZ" (UTC)
  const isoStr =
    dateStr.replace(' ', 'T').replace(/-/g, (m, i) => (i === 4 || i === 7 ? m : ':')) + 'Z'
  const date = new Date(isoStr)
  return isNaN(date.getTime()) ? null : date
}
