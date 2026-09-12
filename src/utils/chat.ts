import mutableBounds from 'binary-searching'

// The library only reads its input, but its bundled declarations require mutable arrays.
type ReadonlyBound = <T>(
  array: readonly T[],
  value: T,
  compare: (a: T, b: T) => number,
  low?: number,
  high?: number
) => number
const bounds: { ge: ReadonlyBound; le: ReadonlyBound } = {
  ge: (array, value, compare, low, high) =>
    mutableBounds.ge(array as (typeof value)[], value, compare, low, high),
  le: (array, value, compare, low, high) =>
    mutableBounds.le(array as (typeof value)[], value, compare, low, high)
}

// Assumes messages are sorted by timestamp ascending
const cmp = <T extends { timestamp: number }>(a: T, b: T): number => a.timestamp - b.timestamp

export function deduplicateMessages<
  T extends { getId: () => string; username?: string; message?: string }
>(messages: readonly T[]): T[] {
  const seenIds = new Set<string>()
  return messages.filter((message) => {
    const id = message.getId()
    if (seenIds.has(id)) {
      console.warn('Duplicate chat message ignored', {
        id,
        username: message.username,
        message: message.message
      })
      return false
    }
    seenIds.add(id)
    return true
  })
}

export function findMessageIndex<T extends { timestamp: number; getId: () => string }>(
  messages: readonly T[],
  message: T | string,
  timestamp?: number
): number | null {
  let messageId: string
  if (typeof message === 'string') {
    messageId = message
  } else {
    messageId = message.getId()
    if (timestamp === undefined) timestamp = message.timestamp
  }
  if (timestamp !== undefined) {
    // Find all messages with the matching timestamp
    const startIdx = bounds.ge(messages, { timestamp } as T, cmp)
    const endIdx = bounds.le(messages, { timestamp } as T, cmp)
    for (let i = startIdx; i <= endIdx; i++) {
      if (messages[i]?.getId() === messageId) return i
    }
    return null
  }
  const idx = messages.findIndex((msg) => msg.getId() === messageId)
  return idx !== -1 ? idx : null
}

export function findMessage<T extends { timestamp: number; getId: () => string }>(
  messages: readonly T[],
  message: T | string,
  timestamp?: number
): T | null {
  let messageId: string
  if (typeof message === 'string') {
    messageId = message
  } else {
    messageId = message.getId()
    if (timestamp === undefined) timestamp = message.timestamp
  }
  const idx = findMessageIndex(messages, messageId, timestamp)
  return idx !== null ? messages[idx]! : null
}

/**
 * Get the index of the closest message to the given time
 * @param messages - Non-empty array of messages sorted by timestamp
 * @param currentTime - The time to find the closest message for
 * @returns The index of the closest message
 */
export function getClosestMessageIndex<T extends { timestamp: number }>(
  messages: readonly T[],
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
  messages: readonly T[],
  currentTime: number
): T {
  const idx = getClosestMessageIndex(messages, currentTime)
  if (idx < 0 || idx >= messages.length) throw new Error('Closest message index out of bounds')
  return messages[idx]!
}

export function getMessagesBetween<T extends { timestamp: number }>(
  messages: readonly T[],
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
  messages: readonly T[],
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
  messages: readonly T[],
  startTime: number,
  endTime: number
): boolean {
  // If there is a msg before startTime and a msg after endTime, then the range is in the messages
  const startIdx = bounds.ge(messages, { timestamp: startTime } as T, cmp)
  const endIdx = bounds.le(messages, { timestamp: endTime } as T, cmp)
  return startIdx !== -1 && endIdx !== -1 && startIdx < endIdx
}

export function isMessageInMessages<T extends { timestamp: number; getId: () => string }>(
  messages: readonly T[],
  message: T
): boolean {
  const startIdx = bounds.ge(messages, { timestamp: message.timestamp } as T, cmp)
  const endIdx = bounds.le(messages, { timestamp: message.timestamp } as T, cmp)

  const id = message.getId()
  for (let i = startIdx; i <= endIdx; i++) if (messages[i]?.getId() === id) return true
  return false
}

export function findIntersectingMessageIndex<T extends { timestamp: number; getId: () => string }>(
  messages: readonly T[],
  targetMessages: readonly T[],
  minTimestamp: number = -Infinity,
  maxTimestamp: number = Infinity,
  findLast: boolean = false
): number | null {
  const low = bounds.ge(messages, { timestamp: minTimestamp } as T, cmp)
  const high = bounds.le(messages, { timestamp: maxTimestamp } as T, cmp)
  for (let step = 0; step < targetMessages.length; step++) {
    const target = targetMessages[findLast ? targetMessages.length - 1 - step : step]!
    if (target.timestamp < minTimestamp || target.timestamp > maxTimestamp)
      throw new Error('Target message out of bounds')

    const startIdx = bounds.ge(messages, { timestamp: target.timestamp } as T, cmp, low, high)
    if (startIdx === messages.length || startIdx > high) continue
    const targetId = target.getId()

    // Linear search for matching id at this timestamp
    for (
      let i = startIdx;
      i <= high && i < messages.length && messages[i]!.timestamp === target.timestamp;
      i++
    ) {
      if (messages[i]!.getId() === targetId) return i
    }
  }
  return null
}
