import { describe, expect, it, vi } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import type { HWND } from '@/types/globals'
import type { SearchContext } from './search-window'
import { openSearchPopup, SearchContextRegistry } from './search-window'
import { openUserPopup, UserContextRegistry, type UserWindowContext } from './user-window'
import { capturePopupSearchRange } from './popup-search-range'

const HOUR = 60 * 60 * 1000
function row(timestamp: number): TwitchChatMessage {
  return new TwitchChatMessage('raw', {}, String(timestamp), timestamp, 'channel', 'alice', 'hello')
}
function context(): SearchContext {
  return {
    timestampOffset: 0,
    potplayerInfo: {
      hwnd: 1n as unknown as HWND,
      pid: 1,
      title: 'Captured recording',
      channel: 'channel',
      startTime: HOUR
    },
    initialMessages: [row(HOUR + 100)],
    loadedMessages: [row(10 * HOUR)],
    focusMessage: vi.fn(),
    onUsernameClick: vi.fn()
  }
}

describe('popup history range capture', () => {
  it.each([15_000, -15_000])(
    'preserves opening offset %i across nested popup contexts',
    (offset) => {
      const source = { ...context(), timestampOffset: offset }
      let token = ''
      const hostWindow = {
        location: { href: 'https://potplayerchat.test/index.html' },
        open: (url?: string | URL): Window => {
          token = new URL(String(url)).hash.slice(1)
          return {} as Window
        }
      }
      const searches = new SearchContextRegistry()
      const users = new UserContextRegistry()
      openSearchPopup({ ...source }, hostWindow as never, searches)
      const search = searches.take(token)!
      source.timestampOffset = 90_000
      openUserPopup(
        {
          ...search,
          initialMessages: [...search.initialMessages],
          loadedMessages: [...search.loadedMessages],
          username: 'alice',
          clickedMessage: search.initialMessages[0]!,
          searchUsername: vi.fn()
        },
        hostWindow as never,
        users
      )
      const user = users.take(token)!
      openSearchPopup({ ...user }, hostWindow as never, searches)
      expect([
        search.timestampOffset,
        user.timestampOffset,
        searches.take(token)!.timestampOffset
      ]).toEqual([offset, offset, offset])
    }
  )

  it('uses the captured focus or visible history without expanding to future loaded messages', () => {
    expect(capturePopupSearchRange(context())).toEqual({ startTime: 100, endTime: HOUR + 100 })
    expect(capturePopupSearchRange({ ...context(), focusedMessage: row(2 * HOUR) })).toEqual({
      startTime: HOUR,
      endTime: 2 * HOUR
    })
    expect(capturePopupSearchRange({ ...context(), clickedMessage: row(3 * HOUR) })).toEqual({
      startTime: 2 * HOUR,
      endTime: 3 * HOUR
    })
    expect(capturePopupSearchRange({ ...context(), initialMessages: [] })).toEqual({
      startTime: 0,
      endTime: HOUR
    })
  })

  it.each(['search', 'user'] as const)(
    'captures the default interval before %s context handoff and keeps it for nested windows',
    (kind) => {
      const source = context()
      let token = ''
      const hostWindow = {
        location: { href: 'https://potplayerchat.test/index.html' },
        open: (url?: string | URL): Window => {
          token = new URL(String(url)).hash.slice(1)
          return {} as Window
        }
      }
      let captured: SearchContext | UserWindowContext
      if (kind === 'search') {
        const registry = new SearchContextRegistry()
        openSearchPopup(source, hostWindow as never, registry)
        captured = registry.take(token)!
      } else {
        const registry = new UserContextRegistry()
        openUserPopup(
          {
            ...source,
            initialMessages: [...source.initialMessages],
            loadedMessages: [...source.loadedMessages],
            username: 'alice',
            clickedMessage: row(HOUR + 100),
            searchUsername: vi.fn()
          },
          hostWindow as never,
          registry
        )
        captured = registry.take(token)!
      }
      source.potplayerInfo.startTime = 20 * HOUR
      captured.initialMessages = [row(30 * HOUR)]
      expect(captured.searchRange).toEqual({ startTime: 100, endTime: HOUR + 100 })
      expect(capturePopupSearchRange({ ...captured, focusedMessage: row(40 * HOUR) })).toEqual(
        captured.searchRange
      )
    }
  )

  it('copies explicit full-history bounds unchanged', () => {
    const searchRange = { startTime: 0, endTime: 10 * HOUR }
    const captured = capturePopupSearchRange({ ...context(), searchRange })
    expect(captured).toEqual(searchRange)
    searchRange.endTime = 20 * HOUR
    expect(captured.endTime).toBe(10 * HOUR)
  })
})
