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
  limit: number
): T[] {
  const lastIdx = bounds.le(messages, { timestamp: currentTime } as T, cmp)
  if (lastIdx === -1) {
    return []
  }
  const startIdx = Math.max(0, lastIdx - limit + 1)
  return messages.slice(startIdx, lastIdx + 1)
}
