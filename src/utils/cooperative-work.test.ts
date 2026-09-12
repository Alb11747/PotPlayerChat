import { afterEach, describe, expect, it, vi } from 'vitest'
import { CooperativeWork } from './cooperative-work'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('cooperative work', () => {
  it('yields to foreground tasks only after the time budget is exhausted', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const work = new CooperativeWork()
    expect(work.checkpoint()).toBeUndefined()
    const events: string[] = []
    setTimeout(() => events.push('foreground'), 0)
    now = 4
    const paused = work.checkpoint()!.then(() => events.push('resumed'))
    expect(events).toEqual([])
    await vi.runAllTimersAsync()
    await paused
    expect(events).toEqual(['foreground', 'resumed'])
    expect(work.checkpoint()).toBeUndefined()
  })

  it('rejects work cancelled while waiting to resume', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const controller = new AbortController()
    const work = new CooperativeWork(controller.signal)
    now = 5
    const paused = expect(work.checkpoint()).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await vi.runAllTimersAsync()
    await paused
    expect(() => work.checkpoint()).toThrow()
  })
})
