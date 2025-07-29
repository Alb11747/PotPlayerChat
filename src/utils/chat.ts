import bounds from 'binary-searching'

// Assumes messages are sorted by timestamp ascending
const cmp = <T extends { timestamp: number }>(a: T, b: T): number => a.timestamp - b.timestamp

/**
 * Get the index of the closest message to the given time
 * @param messages - Non-empty array of messages sorted by timestamp
 * @param currentTime - The time to find the closest message for
 * @returns The index of the closest message
 */
export function getClosestMessageIndex<T extends { timestamp: number }>(
  messages: T[],
  currentTime: number
): number {
  if (messages.length === 0) throw new Error('No messages available to find closest message')

  const idx = bounds.ge(messages, { timestamp: currentTime } as T, cmp)
  if (idx === messages.length) return messages.length - 1
  if (idx === 0) return 0

  const prev = messages[idx - 1]
  const curr = messages[idx]
  if (!prev || !curr) throw new Error('Invalid message array')

  return Math.abs(prev.timestamp - currentTime) <= Math.abs(curr.timestamp - currentTime)
    ? idx - 1
    : idx
}

/**
 * Get the closest message to the given time
 * @param messages - Non-empty array of messages sorted by timestamp
 * @param currentTime - The time to find the closest message for
 * @returns The closest message
 */
export function getClosestMessage<T extends { timestamp: number }>(
  messages: T[],
  currentTime: number
): T {
  const idx = getClosestMessageIndex(messages, currentTime)
  if (idx < 0 || idx >= messages.length) throw new Error('Closest message index out of bounds')
  return messages[idx]!
}

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

export function isMessageInMessages<T extends { timestamp: number; getId: () => string }>(
  messages: T[],
  message: T
): boolean {
  const startIdx = bounds.ge(messages, { timestamp: message.timestamp } as T, cmp)
  const endIdx = bounds.le(messages, { timestamp: message.timestamp } as T, cmp)

  const id = message.getId()
  for (let i = startIdx; i <= endIdx; i++) if (messages[i]?.getId() === id) return true
  return false
}
