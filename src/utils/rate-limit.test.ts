import { TrailingRateLimiter } from '@/utils/rate-limit'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('TrailingRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs immediately and coalesces cooldown requests into one trailing run', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const limiter = new TrailingRateLimiter(1_000, callback)

    await expect(limiter.request()).resolves.toBe(1)
    const trailingA = limiter.request()
    const trailingB = limiter.request()

    expect(trailingA).toBe(trailingB)
    expect(callback).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(999)
    expect(callback).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    await expect(trailingA).resolves.toBe(2)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('queues a trailing run when requested during an active callback', async () => {
    vi.useFakeTimers()
    let finishFirst!: (value: number) => void
    const callback = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finishFirst = resolve
          })
      )
      .mockResolvedValueOnce(2)
    const limiter = new TrailingRateLimiter(1_000, callback)

    const leading = limiter.request()
    await vi.advanceTimersByTimeAsync(0)
    const trailing = limiter.request()
    finishFirst(1)
    await expect(leading).resolves.toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(trailing).resolves.toBe(2)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('recovers after a rejected callback', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    const limiter = new TrailingRateLimiter(100, callback)

    await expect(limiter.request()).rejects.toThrow('boom')
    const trailing = limiter.request()
    await vi.advanceTimersByTimeAsync(100)

    await expect(trailing).resolves.toBe('ok')
  })
})
