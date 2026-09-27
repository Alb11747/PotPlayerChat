import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from './strings'

afterEach(() => vi.useRealTimers())

describe('chat timestamp formatting', () => {
  it.each([15_000, -15_000])('subtracts the synchronization offset %i', (offset) => {
    expect(formatTime(70_000, { startTime: 10_000, offset })).toBe(offset > 0 ? '[0:45]' : '[1:15]')
    expect(formatTime(70_000, { startTime: 10_000, offset, elapsedTime: 30_000 })).toBe('[0:30]')
  })

  it('uses absolute timestamps outside the offset-adjusted recording bounds', () => {
    const time = 70_000
    for (const offset of [61_000, -1_000]) {
      expect(formatTime(time, { startTime: 10_000, endTime: 70_000, offset })).toBe(
        formatTime(time)
      )
    }
    expect(formatTime(time, { startTime: 10_000, endTime: 70_000, offset: 60_000 })).toBe('[0:00]')
  })
  it('retains locale formatting for today, earlier dates and earlier years', () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 9, 13, 30)
    vi.setSystemTime(now)
    for (const date of [
      new Date(2026, 8, 9, 8, 2, 3),
      new Date(2026, 7, 8, 8, 2, 3),
      new Date(2025, 8, 9, 8, 2, 3)
    ]) {
      const today = date.toDateString() === now.toDateString()
      const text = date.toLocaleString([], {
        month: today ? undefined : 'short',
        day: today ? undefined : '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
      expect(formatTime(date.getTime())).toBe(
        `[${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}, `}${text}]`
      )
    }
  })

  it('preserves elapsed timestamps and switches to a date after midnight', () => {
    vi.useFakeTimers()
    const evening = new Date(2026, 8, 9, 23, 59, 59)
    vi.setSystemTime(evening)
    expect(formatTime(3_661_000, { startTime: 0 })).toBe('[1:01:01]')
    const before = formatTime(evening.getTime())
    vi.setSystemTime(new Date(2026, 8, 10, 0, 0, 1))
    expect(formatTime(evening.getTime())).not.toBe(before)
  })
})
