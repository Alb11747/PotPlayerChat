import { describe, expect, it, vi } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { SearchMessagePager, type SearchPagingHistory } from './search-paging'

function row(id: string, timestamp: number): TwitchChatMessage {
  return new TwitchChatMessage('raw', { id }, id, timestamp, 'channel', 'alice', id)
}
function messages(count: number, start = 0): TwitchChatMessage[] {
  return Array.from({ length: count }, (_, index) => row(String(start + index), start + index))
}

function history(
  rows: readonly TwitchChatMessage[],
  start: number,
  end: number
): SearchPagingHistory {
  return {
    resolveRange: vi.fn(async () => ({ start, end })),
    fetchRange: vi.fn(async (from, to) =>
      rows.filter((message) => message.timestamp >= from && message.timestamp <= to)
    )
  }
}

describe('SearchMessagePager', () => {
  it.each([10_000, 100_000])(
    'opens a bounded original-object neighborhood from %i rows without scanning history',
    async (count) => {
      const rows = messages(count)
      const touched = new Set<number>()
      const tracked = new Proxy(rows, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) touched.add(Number(key))
          return Reflect.get(target, key, receiver)
        }
      })
      const pager = new SearchMessagePager({ sources: [tracked], preview: rows.slice(400, 600) })
      expect(pager.messages).toEqual(rows.slice(400, 600))
      expect(pager.messages[100]).toBe(rows[500])
      expect(touched.size).toBeLessThan(1500)
      expect(await pager.page('older')).toEqual(rows.slice(200, 600))
      expect(await pager.page('newer')).toEqual(rows.slice(200, 800))
    }
  )

  it('merges interleaved sources and preserves first-source references, ties, and deduplication', async () => {
    const original = row('duplicate', 10)
    const first = [row('a', 10), original, row('b', 10), row('d', 30)]
    const second = [row('duplicate', 10), row('c', 10), row('middle', 20)]
    const pager = new SearchMessagePager({
      sources: [first, second],
      preview: [original],
      pageSize: 2
    })
    while (!pager.isExhausted('older')) await pager.page('older')
    while (!pager.isExhausted('newer')) await pager.page('newer')
    expect(pager.messages).toEqual([first[0], original, first[2], second[1], second[2], first[3]])
    expect(pager.messages[1]).toBe(original)
  })

  it('handles an empty source, an unknown focused row, and both exhausted ends', async () => {
    const empty = new SearchMessagePager({ sources: [[], []], preview: [] })
    expect(empty.messages).toEqual([])
    expect(empty.isExhausted('older')).toBe(true)
    expect(empty.isExhausted('newer')).toBe(true)
    const focused = row('outside', 100)
    const pager = new SearchMessagePager({ sources: [[]], preview: [focused] })
    expect(await pager.page('older')).toEqual([focused])
    expect(pager.isExhausted('newer')).toBe(true)
  })

  it('buffers busy five-minute intervals and never publishes more than one page', async () => {
    const rows = messages(700)
    const remote = history(rows, 0, 1_000_000)
    const pager = new SearchMessagePager({
      sources: [],
      preview: [],
      anchorTime: 1000,
      history: remote
    })
    expect(await pager.page('older')).toEqual(rows.slice(500))
    expect(remote.fetchRange).toHaveBeenCalledExactlyOnceWith(0, 1000, expect.any(AbortSignal))
    expect(await pager.page('older')).toEqual(rows.slice(300))
    expect(remote.fetchRange).toHaveBeenCalledTimes(1)
    await pager.page('older')
    expect(await pager.page('older')).toEqual(rows)
    expect(pager.isExhausted('older')).toBe(true)
  })

  it('continues across empty intervals to the requested boundary and exhausts', async () => {
    const remote = history([row('early', 1)], 0, 900_000)
    const pager = new SearchMessagePager({
      sources: [],
      preview: [],
      anchorTime: 900_000,
      history: remote
    })
    expect(await pager.page('older')).toEqual([row('early', 1)])
    expect(remote.fetchRange).toHaveBeenCalledTimes(3)
    expect(pager.isExhausted('older')).toBe(true)
  })

  it('retains captured-source precedence and API order at inclusive timestamp boundaries', async () => {
    const captured = row('captured', 100)
    const first = row('remote-first', 100)
    const second = row('remote-second', 100)
    const remote = history([first, second], 0, 100)
    const pager = new SearchMessagePager({
      sources: [[captured]],
      preview: [captured],
      pageSize: 1,
      history: remote
    })
    expect(await pager.page('older')).toEqual([captured, second])
    expect(await pager.page('older')).toEqual([captured, first, second])
  })

  it('fills gaps between captured arrays before admitting the next captured page', async () => {
    const captured = [row('first', 0), row('later', 700_000)]
    const missing = row('middle', 400_000)
    const remote = history([missing], 0, 900_000)
    const pager = new SearchMessagePager({
      sources: [[captured[0]!], [captured[1]!]],
      preview: [captured[0]!],
      pageSize: 1,
      history: remote
    })
    expect(await pager.page('newer')).toEqual([captured[0], missing])
    expect(await pager.page('newer')).toEqual([captured[0], missing, captured[1]])
  })

  it('keeps the opening neighborhood within connected coverage so remote gaps remain reachable', async () => {
    const first = row('first', 0)
    const later = row('later', 700_000)
    const middle = row('middle', 400_000)
    const remote = history([middle], 0, 900_000)
    const pager = new SearchMessagePager({
      sources: [[first], [later]],
      preview: [first],
      history: remote
    })
    expect(pager.messages).toEqual([first])
    expect(remote.resolveRange).not.toHaveBeenCalled()
    expect(await pager.page('newer')).toEqual([first, middle, later])
  })

  it('uses captured coverage without resolving or fetching history for local pages', async () => {
    const rows = messages(100_000)
    const remote = history([], -900_000, 900_000)
    const pager = new SearchMessagePager({
      sources: [rows],
      preview: rows.slice(400, 600),
      history: remote
    })
    expect(await pager.page('older')).toEqual(rows.slice(200, 600))
    expect(await pager.page('newer')).toEqual(rows.slice(200, 800))
    expect(remote.resolveRange).not.toHaveBeenCalled()
    expect(remote.fetchRange).not.toHaveBeenCalled()
  })

  it('preserves readable rows and retries failed intervals', async () => {
    const initial = row('seed', 900_000)
    const remote = history([row('older', 800_000)], 600_000, 900_000)
    vi.mocked(remote.fetchRange).mockRejectedValueOnce(new Error('offline'))
    const pager = new SearchMessagePager({
      sources: [[initial]],
      preview: [initial],
      history: remote
    })
    await expect(pager.page('older')).rejects.toThrow('offline')
    expect(pager.messages).toEqual([initial])
    expect(pager.isExhausted('older')).toBe(false)
    expect(await pager.page('older')).toEqual([row('older', 800_000), initial])
    expect(remote.fetchRange).toHaveBeenCalledTimes(2)
  })

  it('coalesces repeated direction requests and discards aborted or disposed work', async () => {
    const initial = row('seed', 900_000)
    let finish!: (rows: TwitchChatMessage[]) => void
    const remote: SearchPagingHistory = {
      resolveRange: async () => ({ start: 600_000, end: 900_000 }),
      fetchRange: vi.fn(
        () =>
          new Promise<TwitchChatMessage[]>((resolve) => {
            finish = resolve
          })
      )
    }
    const pager = new SearchMessagePager({
      sources: [[initial]],
      preview: [initial],
      history: remote
    })
    const controller = new AbortController()
    const first = pager.page('older', controller.signal)
    expect(pager.page('older', controller.signal)).toBe(first)
    await vi.waitFor(() => expect(remote.fetchRange).toHaveBeenCalledTimes(1))
    controller.abort()
    finish([row('older', 800_000)])
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(pager.messages).toEqual([initial])
    pager.dispose()
    await expect(pager.page('older')).rejects.toMatchObject({ name: 'AbortError' })
  })
})
