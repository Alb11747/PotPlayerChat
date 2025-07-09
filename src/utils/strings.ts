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
  return title.replace(/\W+/g, '').trim()
}

/**
 * Formats a time value relative to a given start time.
 * - If startTime is null or the result is invalid, returns "[0:00]".
 * - If the time is before the startTime, returns the absolute local date/time in a readable format.
 * - Otherwise, returns the elapsed time as "[H:MM:SS]" or "[M:SS]".
 * @param timeMs The current time in milliseconds.
 * @param startTime The reference start time in milliseconds, or null.
 * @param endTime Optional end time in milliseconds to limit the maximum time.
 * @returns A formatted string representing the relative or absolute time.
 */
export function formatTime(timeMs: number, startTime?: number, endTime?: number): string {
  if (startTime === undefined || startTime === null) return '[0:00]'
  const totalSeconds = Math.floor((timeMs - startTime) / 1000)
  if (isNaN(totalSeconds)) return '[0:00]'
  if (totalSeconds < 0 || (endTime !== undefined && timeMs > endTime)) {
    const realTime = new Date(timeMs)
    const now = new Date()
    const sameDayYear = realTime.getFullYear() === now.getFullYear()
    const sameDayMonth =
      sameDayYear && realTime.getMonth() === now.getMonth() && realTime.getDate() === now.getDate()

    const options: Intl.DateTimeFormatOptions = {
      month: !sameDayMonth ? 'short' : undefined,
      day: !sameDayMonth ? '2-digit' : undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }

    const dateStr = realTime.toLocaleString([], options)
    if (sameDayYear) {
      return `[${dateStr}]`
    } else {
      const year = realTime.getFullYear()
      return `[${year}, ${dateStr}]`
    }
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const hoursStr = hours.toString()
  const minutesStr = minutes.toString().padStart(2, '0')
  const secondsStr = seconds.toString().padStart(2, '0')

  return hours > 0 ? `[${hoursStr}:${minutesStr}:${secondsStr}]` : `[${minutes}:${secondsStr}]`
}
