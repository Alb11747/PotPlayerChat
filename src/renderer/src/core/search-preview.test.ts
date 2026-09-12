import { describe, expect, it } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { selectSearchPreview } from './search-preview'

function messages(count: number, start = 0): TwitchChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const id = String(index + start)
    return new TwitchChatMessage('raw', { id }, id, index + start, 'channel', 'alice', id)
  })
}

describe('bounded Search preview selection', () => {
  it('uses original references from the current-chat tail without modifying either source', () => {
    const initial = Object.freeze(messages(1000, 10_000))
    const loaded = Object.freeze(messages(100_000))
    const preview = selectSearchPreview(initial, loaded)
    expect(preview).toHaveLength(200)
    expect(preview[0]).toBe(initial[800])
    expect(preview[199]).toBe(initial[999])
    expect(initial).toHaveLength(1000)
    expect(loaded).toHaveLength(100_000)
  })

  it('centers focused messages with current-chat duplicate precedence and loaded fallback', () => {
    const loaded = messages(1000)
    const initial = messages(400, 300)
    const duplicate = loaded[500]!
    const preview = selectSearchPreview(initial, loaded, duplicate)
    expect(preview[100]).toBe(initial[200])
    const older = selectSearchPreview(initial, loaded, loaded[100])
    expect(older[100]).toBe(loaded[100])
  })

  it('handles empty histories, targets at the boundaries, and unknown focused messages', () => {
    const loaded = messages(500)
    expect(selectSearchPreview([], [])).toEqual([])
    expect(selectSearchPreview([], loaded)[199]).toBe(loaded[499])
    expect(selectSearchPreview(loaded, [], loaded[0])[0]).toBe(loaded[0])
    expect(selectSearchPreview(loaded, [], loaded[499])[199]).toBe(loaded[499])
    const unknown = messages(1, 2000)[0]!
    expect(selectSearchPreview(loaded, [], unknown)).toEqual([unknown])
  })

  it('bounds equal-timestamp lookup while always preserving the requested target', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const id = String(index)
      return new TwitchChatMessage('raw', { id }, id, 10, 'channel', 'alice', id)
    })
    expect(selectSearchPreview(rows, [], rows[150])[100]).toBe(rows[150])
    expect(selectSearchPreview(rows, [], rows[999])).toEqual([rows[999]])
  })

  it('keeps the first original object when the bounded source includes duplicate IDs', () => {
    const original = messages(1)[0]!
    const duplicate = messages(1)[0]!
    const next = messages(1, 1)[0]!
    expect(selectSearchPreview([original, duplicate, next], [])).toEqual([original, next])
    expect(selectSearchPreview([], [original, duplicate, next], duplicate)[0]).toBe(original)
  })
})
