import bounds from 'binary-searching'

// Assumes messages are sorted by timestamp ascending
const cmp = <T extends { timestamp: number }>(a: T, b: T): number => a.timestamp - b.timestamp

export function getMessagesBetween<T extends { timestamp: number }>(
  messages: T[],
  startTime: number,
  endTime: number
): T[] {
  const startIdx = bounds.ge(messages, { timestamp: startTime } as T, cmp)
  const endIdx = bounds.le(messages, { timestamp: endTime } as T, cmp)
  if (startIdx === messages.length || startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return []
  }
  return messages.slice(startIdx, endIdx + 1)
}

export function getMessagesForTime<T extends { timestamp: number }>(
  messages: T[],
  currentTime: number,
  limit: number,
  next: boolean = false
): T[] {
  const lastIdx = bounds.le(messages, { timestamp: currentTime } as T, cmp)
  if (lastIdx === -1) {
    return []
  }
  const startIdx = Math.max(0, lastIdx - limit + 1)
  return messages.slice(startIdx, lastIdx + (next ? 2 : 1))
}

/**
 * Check if a range is contained in the given messages
 * @param messages - The messages to check
 * @param startTime - The start time of the range
 * @param endTime - The end time of the range
 * @returns True if the range is in the messages, false otherwise
 */
export function isRangeInMessages<T extends { timestamp: number }>(
  messages: T[],
  startTime: number,
  endTime: number
): boolean {
  // If there is a msg before startTime and a msg after endTime, then the range is in the messages
  const startIdx = bounds.ge(messages, { timestamp: startTime } as T, cmp)
  const endIdx = bounds.le(messages, { timestamp: endTime } as T, cmp)
  return startIdx !== -1 && endIdx !== -1 && startIdx < endIdx
}
