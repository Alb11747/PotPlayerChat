import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TranscriptEstimator } from './transcript-estimator'

interface Row {
  key: string
  height: number
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface Fixture {
  estimator: TranscriptEstimator<Row>
  data: Row[]
  measure: Mock<(row: Row) => number>
  publish: Mock<() => void>
  frames: Map<number, FrameRequestCallback>
  frame: () => void
  drain: () => void
}

function fixture(count: number, duration = 0): Fixture {
  let clock = 0
  let handle = 0
  const frames = new Map<number, FrameRequestCallback>()
  const data = Array.from({ length: count }, (_, index) => ({
    key: String(index),
    height: 60 + index
  }))
  const measure = vi.fn((row: Row) => {
    clock += duration
    return row.height
  })
  const publish = vi.fn()
  const estimator = new TranscriptEstimator<Row>({
    getKey: (row) => row.key,
    measure,
    publish,
    now: () => clock,
    requestFrame: (callback) => {
      frames.set(++handle, callback)
      return handle
    },
    cancelFrame: (id) => {
      frames.delete(id)
    }
  })
  const frame = (): void => {
    const next = frames.entries().next().value
    if (!next) throw new Error('No frame scheduled')
    frames.delete(next[0])
    next[1](clock)
  }
  const drain = (): void => {
    let count = 0
    while (frames.size && count++ < 1000) frame()
    expect(frames.size).toBe(0)
  }
  return { estimator, data, measure, publish, frames, frame, drain }
}

describe('transcript estimator', () => {
  it('resumes the published dataset after a cooperative replacement is aborted', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 2))
    const f = fixture(5)
    f.estimator.replace(f.data, 'published')
    const controller = new AbortController()
    const pending = f.estimator.replaceCooperatively(
      Array.from({ length: 20 }, (_, index) => ({ key: `new-${index}`, height: 300 })),
      'replacement',
      controller.signal
    )
    expect(f.frames.size).toBe(0)
    f.estimator.prioritize(3, 4)
    expect(f.frames.size).toBe(0)
    const reason = new Error('superseded')
    const rejected = expect(pending).rejects.toBe(reason)
    controller.abort(reason)
    await vi.runAllTimersAsync()
    await rejected
    f.drain()
    expect(f.measure.mock.calls.map(([row]) => row.key)).toEqual(['3', '0', '1', '2', '4'])
    expect(f.estimator.get('new-0')).toBe(48)
    f.data[0]!.height = 150
    f.estimator.invalidate(['0'])
    f.drain()
    expect(f.estimator.get('0')).toBe(150)
  })

  it.each(['synchronous', 'cooperative'] as const)(
    'supersedes pending work when a %s replacement returns to the published dataset',
    async (mode) => {
      vi.useFakeTimers()
      let now = 0
      vi.spyOn(performance, 'now').mockImplementation(() => (now += 2))
      const f = fixture(5)
      f.estimator.replace(f.data, 'published')
      const pending = f.estimator.replaceCooperatively(
        Array.from({ length: 20 }, (_, index) => ({ key: `new-${index}`, height: 300 })),
        'replacement'
      )
      if (mode === 'synchronous') f.estimator.replace(f.data, 'published')
      else await f.estimator.replaceCooperatively(f.data, 'published')
      expect(f.frames.size).toBe(1)
      await vi.runAllTimersAsync()
      await pending
      f.drain()
      expect(f.measure.mock.calls.map(([row]) => row.key)).toEqual(['0', '1', '2', '3', '4'])
      expect(f.estimator.get('new-0')).toBe(48)
    }
  )

  it('does not let an aborted predecessor cancel a newer replacement or its invalidations', async () => {
    vi.useFakeTimers()
    const f = fixture(20)
    f.estimator.replace(f.data, 'published')
    f.drain()
    f.measure.mockClear()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 2))
    const controller = new AbortController()
    const old = f.estimator.replaceCooperatively([...f.data], 'published', controller.signal)
    const reason = new Error('old preparation cancelled')
    const rejected = expect(old).rejects.toBe(reason)
    const current = f.estimator.replaceCooperatively([...f.data], 'published')
    controller.abort(reason)
    f.data[0]!.height = 500
    f.estimator.invalidate(['0'])
    expect(f.frames.size).toBe(0)
    await vi.runAllTimersAsync()
    await rejected
    await current
    f.drain()
    expect(f.estimator.get('0')).toBe(500)
    expect(f.measure.mock.calls.map(([row]) => row.key)).toEqual(['0'])
  })
  it('does not lose an invalidation after a row has been copied into a pending replacement', async () => {
    vi.useFakeTimers()
    const f = fixture(100)
    f.estimator.replace(f.data, 'same')
    f.drain()
    f.measure.mockClear()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 2))
    const pending = f.estimator.replaceCooperatively([...f.data], 'same')
    f.data[0]!.height = 999
    f.estimator.invalidate(['0'])
    await vi.runAllTimersAsync()
    await pending
    f.drain()
    expect(f.estimator.get('0')).toBe(999)
    expect(f.measure.mock.calls.map(([item]) => item.key)).toEqual(['0'])
  })
  it('publishes cooperative replacements only after preparation and ignores superseded work', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 2))
    const f = fixture(100)
    const pending = f.estimator.replaceCooperatively(f.data, 'old')
    expect(f.estimator.get('0')).toBe(48)
    expect(f.frames.size).toBe(0)
    f.estimator.replace([{ key: 'new', height: 75 }], 'new')
    await vi.runAllTimersAsync()
    await pending
    f.drain()
    expect(f.estimator.get('new')).toBe(75)
    expect(f.measure.mock.calls.map(([item]) => item.key)).toEqual(['new'])
    vi.restoreAllMocks()
  })
  it('yields beyond the browser frame before measuring and keeps subsequent batches frame-limited', () => {
    vi.useFakeTimers()
    let frame!: FrameRequestCallback
    let handle = 0
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return ++handle
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const events: string[] = []
    const measure = vi.fn((item: Row) => {
      events.push('measure')
      return item.height
    })
    const publish = vi.fn()
    const estimator = new TranscriptEstimator<Row>({
      getKey: (item) => item.key,
      measure,
      publish,
      now: () => 0
    })
    estimator.replace(
      Array.from({ length: 65 }, (_, index) => ({ key: String(index), height: 60 })),
      0
    )
    setTimeout(() => events.push('foreground'), 0)
    frame(0)
    expect(measure).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    estimator.prioritize(0, 65)
    expect(requestFrame).toHaveBeenCalledTimes(1)

    vi.runOnlyPendingTimers()
    expect(events[0]).toBe('foreground')
    expect(measure).toHaveBeenCalledTimes(64)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    vi.runOnlyPendingTimers()
    expect(measure).toHaveBeenCalledTimes(64)
    frame(16)
    expect(measure).toHaveBeenCalledTimes(64)
    vi.runOnlyPendingTimers()
    expect(measure).toHaveBeenCalledTimes(65)
    expect(publish).toHaveBeenCalledTimes(2)
    estimator.dispose()
  })

  it('cancels post-frame browser tasks on replacement and disposal without publishing stale rows', () => {
    vi.useFakeTimers()
    let frame!: FrameRequestCallback
    let handle = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return ++handle
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const measure = vi.fn((item: Row) => item.height)
    const publish = vi.fn()
    const estimator = new TranscriptEstimator<Row>({
      getKey: (item) => item.key,
      measure,
      publish
    })
    estimator.replace([{ key: 'old', height: 60 }], 0)
    const oldFrame = frame
    frame(0)
    expect(vi.getTimerCount()).toBe(1)
    estimator.replace([{ key: 'new', height: 90 }], 1)
    expect(vi.getTimerCount()).toBe(0)
    oldFrame(0)
    expect(vi.getTimerCount()).toBe(0)
    frame(16)
    vi.runOnlyPendingTimers()
    expect(measure.mock.calls.map(([item]) => item.key)).toEqual(['new'])
    expect(publish).toHaveBeenCalledExactlyOnceWith(['new'])

    estimator.invalidate()
    frame(32)
    expect(vi.getTimerCount()).toBe(1)
    estimator.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.runOnlyPendingTimers()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('defers all measurement and yields after 64 rows, publishing once per frame', () => {
    const f = fixture(150)
    f.estimator.replace(f.data, 0)
    expect(f.measure).not.toHaveBeenCalled()
    expect(f.estimator.get('149')).toBe(48)
    expect(f.estimator.get('missing')).toBe(48)
    f.frame()
    expect(f.measure).toHaveBeenCalledTimes(64)
    expect(f.publish).toHaveBeenCalledTimes(1)
    expect(f.estimator.get('63')).toBe(123)
    expect(f.estimator.get('64')).toBe(48)
    f.drain()
    expect(f.measure).toHaveBeenCalledTimes(150)
    expect(f.publish).toHaveBeenCalledTimes(3)
  })

  it('yields after four milliseconds, including when one row exceeds the budget', () => {
    const f = fixture(10, 1.5)
    f.estimator.replace(f.data, 0)
    f.frame()
    expect(f.measure).toHaveBeenCalledTimes(3)
    expect(f.frames.size).toBe(1)
    const slow = fixture(2, 10)
    slow.estimator.replace(slow.data, 0)
    slow.frame()
    expect(slow.measure).toHaveBeenCalledTimes(1)
    expect(slow.frames.size).toBe(1)
  })

  it('prioritizes the current visible range and replaces obsolete viewport priorities', () => {
    const f = fixture(20, 4)
    f.estimator.replace(f.data, 0)
    f.estimator.prioritize(10, 13)
    f.frame()
    f.estimator.prioritize(17, 19)
    f.frame()
    f.frame()
    f.frame()
    expect(f.measure.mock.calls.map(([row]) => row.key)).toEqual(['10', '17', '18', '0'])
    f.drain()
    expect(f.measure).toHaveBeenCalledTimes(20)
  })

  it('retains cached values for identical rows and prunes removed rows on replacement', () => {
    const f = fixture(3)
    f.estimator.replace(f.data, 'first')
    f.drain()
    f.estimator.replace(f.data, 'first')
    f.estimator.replace([...f.data], 'first')
    expect(f.frames.size).toBe(0)
    f.estimator.replace([f.data[1]!, { key: '2', height: 200 }], 'first')
    expect(f.estimator.get('0')).toBe(48)
    expect(f.estimator.get('2')).toBe(62)
    f.drain()
    expect(f.measure).toHaveBeenCalledTimes(4)
    expect(f.estimator.get('2')).toBe(200)
  })

  it('invalidates affected rows while retaining stale estimates and unrelated queued work', () => {
    const f = fixture(5, 4)
    f.estimator.replace(f.data, 0)
    f.frame()
    f.frame()
    f.data[0]!.height = 100
    f.estimator.invalidate(['0', 'missing'])
    expect(f.estimator.get('0')).toBe(60)
    f.estimator.prioritize(0, 2)
    f.drain()
    expect(f.measure.mock.calls.map(([row]) => row.key)).toEqual(['0', '1', '0', '2', '3', '4'])
    expect(f.estimator.get('0')).toBe(100)
  })

  it('remeasures all rows after a version change or explicit cache invalidation', () => {
    const f = fixture(3)
    f.estimator.replace(f.data, 0)
    f.drain()
    f.estimator.replace(f.data, 1)
    expect(f.estimator.get('1')).toBe(61)
    f.drain()
    expect(f.measure).toHaveBeenCalledTimes(6)
    f.estimator.invalidate()
    f.drain()
    expect(f.measure).toHaveBeenCalledTimes(9)
    expect(f.publish).toHaveBeenCalledTimes(3)
  })

  it('publishes the completed batch atomically and only once even if heights are unchanged', () => {
    const f = fixture(3)
    f.measure.mockImplementation((row) => {
      expect(f.estimator.get('0')).toBe(48)
      return row.height
    })
    f.estimator.replace(f.data, 0)
    f.drain()
    f.measure.mockImplementation((row) => row.height)
    f.estimator.invalidate()
    f.drain()
    expect(f.publish).toHaveBeenCalledTimes(2)
    expect(f.estimator.get('0')).toBe(60)
  })

  it('rejects obsolete dispatched frames without cancelling a replacement frame', () => {
    const f = fixture(2)
    f.estimator.replace(f.data, 0)
    const stale = [...f.frames.values()][0]!
    f.estimator.replace([{ key: 'new', height: 90 }], 1)
    stale(0)
    expect(f.measure).not.toHaveBeenCalled()
    expect(f.frames.size).toBe(1)
    f.drain()
    expect(f.estimator.get('new')).toBe(90)
    expect(f.publish).toHaveBeenCalledTimes(1)
  })

  it('discards a batch replaced during measurement and requeues surviving unmeasured rows', () => {
    const f = fixture(3)
    f.measure.mockImplementationOnce((row) => {
      f.estimator.replace([row, { key: 'new', height: 100 }], 0)
      return 999
    })
    f.estimator.replace(f.data, 0)
    f.frame()
    expect(f.estimator.get('0')).toBe(48)
    expect(f.publish).not.toHaveBeenCalled()
    f.drain()
    expect(f.estimator.get('0')).toBe(60)
    expect(f.estimator.get('new')).toBe(100)
    expect(f.estimator.get('1')).toBe(48)
  })

  it('rejects stale results after reentrant invalidation without losing other pending work', () => {
    const f = fixture(3)
    f.measure
      .mockImplementationOnce((row) => row.height)
      .mockImplementationOnce(() => {
        f.estimator.invalidate(['1'])
        return 999
      })
    f.estimator.replace(f.data, 0)
    f.frame()
    expect(f.publish).not.toHaveBeenCalled()
    expect(f.estimator.get('0')).toBe(48)
    f.drain()
    expect(f.estimator.get('0')).toBe(60)
    expect(f.estimator.get('1')).toBe(61)
    expect(f.estimator.get('2')).toBe(62)
  })

  it('cancels disposal during measurement and ignores later requests', () => {
    const f = fixture(3)
    f.measure.mockImplementationOnce(() => {
      f.estimator.dispose()
      return 999
    })
    f.estimator.replace(f.data, 0)
    f.frame()
    f.estimator.invalidate()
    f.estimator.replace(f.data, 1)
    f.estimator.prioritize(0, 2)
    expect(f.frames.size).toBe(0)
    expect(f.publish).not.toHaveBeenCalled()
    expect(f.estimator.get('0')).toBe(48)
  })

  it('cancels queued work on disposal, including an already-dispatched callback', () => {
    const f = fixture(3)
    f.estimator.replace(f.data, 0)
    const stale = [...f.frames.values()][0]!
    f.estimator.dispose()
    stale(0)
    expect(f.frames.size).toBe(0)
    expect(f.measure).not.toHaveBeenCalled()
  })
})
