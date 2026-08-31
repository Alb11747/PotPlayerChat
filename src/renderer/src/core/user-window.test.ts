import { TwitchChatMessage, TwitchSystemMessage } from '@/core/chat/twitch-msg'
import type { HWND } from '@/types/globals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMessagesFromUser,
  openUserPopup,
  UserContextRegistry,
  type UserWindowContext
} from './user-window'

function createMessage(id: string, username: string, message: string): TwitchChatMessage {
  return new TwitchChatMessage(
    `raw:${id}`,
    { 'display-name': username, 'user-id': `user-${username}` },
    id,
    Number(id.replace(/\D/g, '')) || 1,
    'channel',
    username,
    message
  )
}

function createContext(): UserWindowContext {
  const clickedMessage = createMessage('message-1', 'Alice', 'hello')
  return {
    username: 'Alice',
    clickedMessage,
    potplayerInfo: {
      hwnd: 1n as unknown as HWND,
      pid: 1,
      title: 'Video',
      channel: 'channel',
      startTime: 1_000
    },
    initialMessages: [clickedMessage],
    loadedMessages: [],
    focusMessage: vi.fn()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('user window context', () => {
  it('returns the original context and message arrays once', () => {
    const registry = new UserContextRegistry()
    const context = createContext()
    registry.register(context, 'user-token')

    const loadedContext = registry.take('user-token')
    expect(loadedContext).toBe(context)
    expect(loadedContext?.initialMessages).toBe(context.initialMessages)
    expect(loadedContext?.loadedMessages).toBe(context.loadedMessages)
    expect(registry.take('user-token')).toBeNull()
  })

  it('expires unused contexts', () => {
    vi.useFakeTimers()
    const registry = new UserContextRegistry(60_000)
    registry.register(createContext(), 'expiring-token')

    vi.advanceTimersByTime(60_000)
    expect(registry.take('expiring-token')).toBeNull()
  })

  it('discards context when the user window fails to open', () => {
    const registry = new UserContextRegistry()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let openedUrl = ''
    const hostWindow = {
      location: { href: 'https://potplayerchat.test/index.html' },
      open: (url?: string | URL): null => {
        openedUrl = String(url)
        return null
      }
    }

    expect(openUserPopup(createContext(), hostWindow as never, registry)).toBeNull()
    expect(registry.take(new URL(openedUrl).hash.slice(1))).toBeNull()
    expect(consoleError).toHaveBeenCalledWith('Failed to open the user window')
  })
})

describe('user message history', () => {
  it('matches exact senders case-insensitively and excludes mentions and system messages', () => {
    const alice = createMessage('message-1', 'Alice', 'first')
    const aliceDifferentCase = createMessage('message-2', 'ALICE', 'second')
    const mention = createMessage('message-3', 'Bob', 'hello @Alice')
    const system = new TwitchSystemMessage(
      'raw:system',
      {},
      4,
      'NOTICE',
      'channel',
      'Alice joined',
      'Alice joined'
    )

    expect(getMessagesFromUser([alice, aliceDifferentCase, mention, system], 'alice')).toEqual([
      alice,
      aliceDifferentCase
    ])
  })
})
