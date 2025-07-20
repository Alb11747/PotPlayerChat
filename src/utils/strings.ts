/**
 * Removes the prefix from a string if it exists.
 * @param str The string to remove the prefix from.
 * @param prefix The prefix to remove.
 * @returns The string without the prefix.
 */
export function removePrefix(str: string, prefix: string): string {
  if (str.startsWith(prefix)) {
    return str.slice(prefix.length)
  }
  return str
}

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
 * Escapes special characters in a string for use in a regular expression.
 * This is a polyfill for `RegExp.escape` if it doesn't exist.
 * @param str The string to escape.
 * @returns The escaped string.
 */
export const regExpEscape: (str: string) => string =
  (RegExp as unknown as { escape: (str: string) => string }).escape ??
  ((str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/**
 * Creates a map that converts UTF-8 indices to UTF-16 indices.
 * @param str The string to convert.
 * @returns A map of UTF-16 indices for each UTF-8 index.
 */
export function utf8IndexToUtf16IndexMap(str: string): Record<number, number> {
  const map: Array<number> = [0]
  let utf16Index = 0
  for (const codePoint of str) {
    utf16Index += codePoint.length
    map.push(utf16Index)
  }
  return map
}

/**
 * Formats a time value relative to a given start time.
 * - During playback time, returns the elapsed time as "[H:MM:SS]" or "[M:SS]".
 * - Otherwise, returns the absolute local date/time in a readable format.
 * @param timeMs The current time in milliseconds.
 * @param startTime The reference start time in milliseconds, or null.
 * @param endTime Optional end time in milliseconds to limit the maximum time.
 * @returns A formatted string representing the relative or absolute time.
 */
export function formatTime(
  timeMs: number,
  {
    startTime,
    endTime,
    elapsedTime
  }: { startTime?: number; endTime?: number; elapsedTime?: number } = {}
): string {
  const totalDuration =
    endTime !== undefined && startTime !== undefined ? endTime - startTime : undefined
  elapsedTime ??= startTime ? timeMs - startTime : undefined
  if (
    elapsedTime === undefined ||
    elapsedTime < 0 ||
    (totalDuration !== undefined && elapsedTime > totalDuration)
  ) {
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

  const elapsedSeconds = Math.floor(elapsedTime / 1000)
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60

  const hoursStr = hours.toString()
  const minutesStr = minutes.toString().padStart(2, '0')
  const secondsStr = seconds.toString().padStart(2, '0')

  return hours > 0 ? `[${hoursStr}:${minutesStr}:${secondsStr}]` : `[${minutes}:${secondsStr}]`
}
