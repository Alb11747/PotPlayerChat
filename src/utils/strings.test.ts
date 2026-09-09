import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from './strings'

afterEach(() => vi.useRealTimers())

describe('chat timestamp formatting', () => {
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
