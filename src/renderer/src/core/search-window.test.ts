import type { SearchContext } from '@/renderer/src/core/search-window'
import { openSearchPopup, SearchContextRegistry } from '@/renderer/src/core/search-window'
import type { HWND } from '@/types/globals'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { afterEach, describe, expect, it, vi } from 'vitest'

function createContext(): SearchContext {
  return {
    potplayerInfo: {
      hwnd: 1n as unknown as HWND,
      pid: 1,
      title: 'Video',
      channel: 'channel',
      startTime: 1_000
    },
    initialMessages: [],
    loadedMessages: [],
    focusMessage: vi.fn(),
    onUsernameClick: vi.fn()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SearchContextRegistry', () => {
  it('shares prepared rows and search text through real popup context registration', async () => {
    const registry = new SearchContextRegistry()
    const original = new TwitchChatMessage('raw', {}, 'message', 1000, 'channel', 'Alice', 'hello')
    const source = [original]
    const loaded: TwitchChatMessage[] = []
    const tokens: string[] = []
    const hostWindow = {
      location: { href: 'https://potplayerchat.test/index.html' },
      open: (url?: string | URL): Window => {
        tokens.push(new URL(String(url)).hash.slice(1))
        return {} as Window
      }
    }
    for (let i = 0; i < 2; i++) {
      openSearchPopup(
        { ...createContext(), initialMessages: source, loadedMessages: loaded },
        hostWindow as never,
        registry
      )
    }
    const first = registry.take(tokens[0]!)!
    const second = registry.take(tokens[1]!)!
    expect(first.initialMessages).toBe(source)
    expect(second.sharedData).toBe(first.sharedData)
    const snapshot = await first.sharedData!.prepare(first.initialMessages, first.loadedMessages)
    expect(snapshot).toBe(
      await second.sharedData!.prepare(second.initialMessages, second.loadedMessages)
    )
    expect(snapshot[0]).toBe(original)
    expect(first.sharedData!.textCache).toBe(second.sharedData!.textCache)
  })

  it('returns the same context and message array references once', () => {
    const registry = new SearchContextRegistry()
    const context = createContext()
    const initialMessages = context.initialMessages
    const loadedMessages = context.loadedMessages

    registry.register(context, 'search-token')

    const loadedContext = registry.take('search-token')
    expect(loadedContext).toBe(context)
    expect(loadedContext?.initialMessages).toBe(initialMessages)
    expect(loadedContext?.loadedMessages).toBe(loadedMessages)
    expect(registry.take('search-token')).toBeNull()
    expect(loadedContext?.onUsernameClick).toBe(context.onUsernameClick)
  })

  it('returns null for unknown and expired tokens', () => {
    vi.useFakeTimers()
    const registry = new SearchContextRegistry(60_000)
    registry.register(createContext(), 'expiring-token')

    expect(registry.take('unknown-token')).toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(registry.take('expiring-token')).toBeNull()
  })

  it('discards the registered context when opening a window fails', () => {
    const registry = new SearchContextRegistry()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let openedUrl = ''
    const hostWindow = {
      location: { href: 'https://potplayerchat.test/index.html' },
      open: (url?: string | URL): null => {
        openedUrl = String(url)
        return null
      }
    }

    expect(openSearchPopup(createContext(), hostWindow as never, registry)).toBeNull()
    expect(registry.take(new URL(openedUrl).hash.slice(1))).toBeNull()
    expect(consoleError).toHaveBeenCalledWith('Failed to open the search window')
  })
})
