/**
 * Removes the suffix from a string if it exists.
 * @param str The string to remove the suffix from.
 * @param suffix The suffix to remove.
 * @returns The string without the suffix.
 */
export function removeSuffix(str: string, suffix: string): string {
  if (str.endsWith(suffix)) {
    return str.slice(0, -suffix.length)
  }
  return str
}

/**
 * Removes any non-alphanumeric characters from a string.
 * @param title The string to strip symbols from.
 * @returns The string with only alphanumeric characters.
 */
export function stripSymbols(title: string): string {
  return title.replace(/[^a-zA-Z0-9]/g, '').trim()
}

/**
 * Formats a relative time in milliseconds to a string in the format "HH:MM:SS" or "MM:SS".
 * @param relativeTimeMs The relative time in milliseconds.
 * @param startTime The start time in milliseconds, or null if not available.
 * @returns A formatted string representing the relative time.
 */
export function formatRelativeTime(relativeTimeMs: number, startTime: number | null): string {
  if (startTime === null) return '0:00'
  const totalSeconds = Math.floor((relativeTimeMs - startTime) / 1000)
  if (isNaN(totalSeconds)) return '0:00'

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
}
