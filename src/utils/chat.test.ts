import {
  deduplicateMessages,
  findIntersectingMessageIndex,
  getClosestMessageIndex,
  getMessagesBetween,
  getMessagesForTime
} from '@/utils/chat'
import { describe, expect, it, vi } from 'vitest'

type Message = {
  timestamp: number
  id: string
  username: string
  message: string
  getId: () => string
}

function createMessage(id: string, timestamp: number): Message {
  return {
    id,
    timestamp,
    username: `user-${id}`,
    message: `message-${id}`,
    getId() {
      return id
    }
  }
}

describe('chat utils', () => {
  const messages = [
    createMessage('a', 1_000),
    createMessage('b', 2_000),
    createMessage('c', 2_000),
    createMessage('d', 3_000),
    createMessage('e', 5_000)
  ]

  it('keeps the first message for each id while preserving order', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const duplicateMessages = [
      createMessage('a', 1_000),
      createMessage('b', 2_000),
      createMessage('a', 3_000)
    ]

    expect(deduplicateMessages(duplicateMessages)).toEqual(duplicateMessages.slice(0, 2))
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('Duplicate chat message ignored', {
      id: 'a',
      username: 'user-a',
      message: 'message-a'
    })
    warn.mockRestore()
  })

  it('returns closest message index near boundaries', () => {
    expect(getClosestMessageIndex(messages, 500)).toBe(0)
    expect(getClosestMessageIndex(messages, 4_999)).toBe(4)
    expect(getClosestMessageIndex(messages, 2_100)).toBe(2)
  })

  it('returns messages between timestamps inclusively', () => {
    const results = getMessagesBetween(messages, 2_000, 3_000)
    expect(results.map((m) => m.id)).toEqual(['b', 'c', 'd'])
  })

  it('returns recent messages and optionally one next message', () => {
    const previousOnly = getMessagesForTime(messages, 2_000, 2, false)
    const withNext = getMessagesForTime(messages, 2_000, 2, true)
    expect(previousOnly.map((m) => m.id)).toEqual(['b', 'c'])
    expect(withNext.map((m) => m.id)).toEqual(['b', 'c', 'd'])
  })

  it('finds intersecting message index by id within range', () => {
    const target = [createMessage('d', 3_000), createMessage('missing', 4_000)]
    const idx = findIntersectingMessageIndex(messages, target, 2_500, 3_500)
    expect(idx).toBe(3)
  })
})
