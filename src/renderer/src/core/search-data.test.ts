import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { describe, expect, it, vi } from 'vitest'
import { mergeSearchMessages, SharedSearchDataCache } from './search-data'

function message(id: string, timestamp: number, text = id): TwitchChatMessage {
  return new TwitchChatMessage(`raw:${id}`, {}, id, timestamp, 'channel', 'Alice', text)
}

describe('shared Search snapshots', () => {
  it('preserves original rows, initial duplicate precedence, and stable equal timestamps', async () => {
    const initial = Object.freeze([message('a', 10), message('b', 20), message('c', 20)])
    const loaded = Object.freeze([
      message('a', 5, 'older duplicate'),
      message('d', 10),
      message('e', 20),
      message('f', 30)
    ])
    const result = await mergeSearchMessages(initial, loaded)
    expect(result).toEqual([initial[0], loaded[1], initial[1], initial[2], loaded[2], loaded[3]])
    expect(result[0]).toBe(initial[0])
    const extended = await mergeSearchMessages(result, [message('g', 1), message('b', 2)])
    expect(extended.slice(1)).toEqual(result)
    expect(extended[3]).toBe(initial[1])
    expect(result).toHaveLength(6)
    expect(initial).toHaveLength(3)
    expect(loaded).toHaveLength(4)
  })

  it('deduplicates within sources including repeated object references', async () => {
    const first = message('a', 1)
    expect(await mergeSearchMessages([first, first, message('a', 2)], [])).toEqual([first])
    expect(await mergeSearchMessages([], [])).toEqual([])
  })

  it('reuses a snapshot across concurrent and subsequent consumers by source array identity', async () => {
    const cache = new SharedSearchDataCache()
    const initial = [message('a', 1)]
    const loaded = [message('b', 2)]
    const [first, second] = await Promise.all([
      cache.prepare(initial, loaded),
      cache.prepare(initial, loaded)
    ])
    expect(first).toBe(second)
    expect(await cache.prepare(initial, loaded)).toBe(first)
    expect(await cache.prepare(initial, [...loaded])).not.toBe(first)
  })

  it('cancels one consumer without interrupting another popup', async () => {
    const cache = new SharedSearchDataCache()
    const initial = [message('a', 1), message('b', 2)]
    const loaded: TwitchChatMessage[] = []
    const controller = new AbortController()
    const clock = vi.spyOn(performance, 'now')
    let time = 0
    clock.mockImplementation(() => (time += 5))
    try {
      const cancelled = cache.prepare(initial, loaded, controller.signal)
      const retained = cache.prepare(initial, loaded)
      controller.abort()
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
      const result = await retained
      expect(result).toEqual(initial)
      expect(await cache.prepare(initial, loaded)).toBe(result)
    } finally {
      clock.mockRestore()
    }
  })

  it('abandons an unneeded preparation and allows a later popup to retry', async () => {
    const cache = new SharedSearchDataCache()
    const initial = [message('a', 1)]
    const loaded: TwitchChatMessage[] = []
    const controller = new AbortController()
    const cancelled = cache.prepare(initial, loaded, controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(await cache.prepare(initial, loaded)).toEqual(initial)
  })
})
