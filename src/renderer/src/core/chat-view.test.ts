import { describe, expect, it, vi, afterEach } from 'vitest'
import { playbackMessageWindow } from './chat-view'
import { CurrentVideoTimeHistory } from '@/utils/time'

const start = 1_700_000_000_000
const rows = [1000, 2000, 3000].map((time) => ({ timestamp: start + time }))

afterEach(() => vi.useRealTimers())

describe('playback message window', () => {
  it('keeps the final logged message at and beyond its playback time', () => {
    for (const time of [3000, 4000]) {
      expect(playbackMessageWindow(rows, start, time, 0)).toEqual({ messages: rows })
    }
    expect(playbackMessageWindow([], start, 0, 0)).toEqual({ messages: [] })
  })

  it('holds back the future row even on the first display without mutating the source', () => {
    expect(playbackMessageWindow(rows, start, 2500, 0)).toEqual({
      messages: rows.slice(0, 2),
      nextVideoTime: 3000
    })
    expect(rows).toHaveLength(3)
  })

  it.each([500, -500])('applies the %i ms offset to both visibility and scheduling', (offset) => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const history = new CurrentVideoTimeHistory()
    history.addSample(1500 - offset)
    vi.setSystemTime(500)
    history.addSample(2500 - offset)
    const result = playbackMessageWindow(rows, start, 2500 - offset, offset)
    expect(result.messages).toEqual(rows.slice(0, 2))
    expect(result.nextVideoTime).toBe(3000 - offset)
    // At 2x speed the next row is 250ms away, independent of Unix time or offset.
    expect(history.getPredictedTimeUntil(result.nextVideoTime!)).toBe(250)
  })
})
