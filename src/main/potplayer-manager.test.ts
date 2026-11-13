import { PotPlayerInstanceManager } from '@/main/potplayer-manager'
import type { HWND } from '@/types/globals'
import type { PotPlayerWindow } from '@/types/potplayer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hwnd = (value: number): HWND => value as unknown as HWND

function createHarness(initialWindows: PotPlayerWindow[] = [{ pid: 10, hwnd: hwnd(100) }]): {
  manager: PotPlayerInstanceManager
  discoverInstances: ReturnType<typeof vi.fn>
  readTitle: ReturnType<typeof vi.fn>
  readCurrentTime: ReturnType<typeof vi.fn>
  readTotalTime: ReturnType<typeof vi.fn>
  onInstancesChanged: ReturnType<typeof vi.fn>
  setWallTime: (value: number) => void
} {
  let wallTime = 0
  const discoverInstances = vi.fn().mockResolvedValue(initialWindows)
  const readTitle = vi.fn().mockResolvedValue('live-title.mp4')
  const readCurrentTime = vi.fn().mockResolvedValue(1_000)
  const readTotalTime = vi.fn().mockResolvedValue(60_000)
  const onInstancesChanged = vi.fn()
  const manager = new PotPlayerInstanceManager({
    discoverInstances,
    readTitle,
    readCurrentTime,
    readTotalTime,
    onInstancesChanged,
    now: () => wallTime
  })

  return {
    manager,
    discoverInstances,
    readTitle,
    readCurrentTime,
    readTotalTime,
    onInstancesChanged,
    setWallTime: (value: number) => {
      wallTime = value
    }
  }
}

describe('PotPlayerInstanceManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses a live title and confirms it on the trailing edge after discovery', async () => {
    const harness = createHarness()
    harness.readTitle.mockResolvedValueOnce('initial-live-title.mp4')
    harness.readTitle.mockResolvedValueOnce('settled-live-title.mp4')

    await harness.manager.requestVerification('test')

    expect(harness.manager.getInstanceSnapshot()).toEqual([
      { pid: 10, hwnd: hwnd(100), title: 'initial-live-title.mp4' }
    ])
    await vi.advanceTimersByTimeAsync(1_000)

    expect(harness.manager.getInstanceSnapshot()).toEqual([
      { pid: 10, hwnd: hwnd(100), title: 'settled-live-title.mp4' }
    ])
    expect(harness.onInstancesChanged).toHaveBeenLastCalledWith([
      { pid: 10, hwnd: hwnd(100), title: 'settled-live-title.mp4', selected: true }
    ])
  })

  it('resolves metadata with the canonical live title instead of the caller title', async () => {
    const harness = createHarness()
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.readTitle.mockResolvedValue('new-live-title.mp4')
    const resolver = vi.fn(async (instance) => ({
      ...instance,
      channel: 'channel',
      startTime: 1,
      endTime: 2
    }))

    const resultPromise = harness.manager.resolveExtraInfo(
      { pid: 10, hwnd: hwnd(100), title: 'stale-tasklist-title.mp4' },
      resolver
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await resultPromise

    expect(result?.title).toBe('new-live-title.mp4')
    expect(resolver).toHaveBeenCalledWith({
      pid: 10,
      hwnd: hwnd(100),
      title: 'new-live-title.mp4'
    })
  })

  it('reconciles an HWND replacement by PID before retrying an interactive call', async () => {
    const harness = createHarness()
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.discoverInstances.mockResolvedValue([{ pid: 10, hwnd: hwnd(200) }])
    harness.readTitle.mockResolvedValue('replacement-title.mp4')
    harness.readTotalTime.mockResolvedValueOnce(0).mockResolvedValueOnce(90_000)

    const resultPromise = harness.manager.getTotalTime(hwnd(100))
    await vi.advanceTimersByTimeAsync(4_000)
    const result = await resultPromise

    expect(result).toBe(90_000)
    expect(harness.readTotalTime).toHaveBeenNthCalledWith(1, hwnd(100))
    expect(harness.readTotalTime).toHaveBeenNthCalledWith(2, hwnd(200))
    expect(harness.manager.getSelectedHwnd()).toBe(hwnd(200))
  })

  it('preserves the last live title when a temporary title read fails', async () => {
    const harness = createHarness()
    harness.readTitle.mockResolvedValue('known-good-title.mp4')
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.readTitle.mockRejectedValue(new Error('window is busy'))
    const resolver = vi.fn(async (instance) => ({
      ...instance,
      channel: 'channel',
      startTime: 1,
      endTime: 2
    }))

    const resultPromise = harness.manager.resolveExtraInfo(
      { pid: 10, hwnd: hwnd(100), title: 'stale-title.mp4' },
      resolver
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await resultPromise

    expect(result?.title).toBe('known-good-title.mp4')
    expect(harness.manager.getInstanceSnapshot()[0]?.title).toBe('known-good-title.mp4')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(harness.discoverInstances).toHaveBeenCalledTimes(2)
  })

  it('reverifies and retries metadata once when a synchronized title still does not resolve', async () => {
    const harness = createHarness()
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    const resolver = vi.fn().mockResolvedValue(null)

    const resultPromise = harness.manager.resolveExtraInfo(
      { pid: 10, hwnd: hwnd(100), title: 'caller-title.mp4' },
      resolver
    )
    await vi.advanceTimersByTimeAsync(4_000)

    await expect(resultPromise).resolves.toBeNull()
    expect(harness.discoverInstances).toHaveBeenCalledTimes(2)
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it.each([0.5, 1, 2])(
    'uses the fixed and inferred-rate allowances at %sx playback',
    async (playbackRate) => {
      const harness = createHarness()
      harness.readCurrentTime.mockReset()
      await harness.manager.requestVerification('test')
      await vi.advanceTimersByTimeAsync(1_000)

      for (let second = 0; second < 4; second++) {
        harness.setWallTime(second * 1_000)
        harness.readCurrentTime.mockResolvedValueOnce(second * 1_000 * playbackRate)
        await harness.manager.pollCurrentTime()
        await vi.advanceTimersByTimeAsync(1_000)
      }
      // Starting the timeline and leaving 0 read the title; only jumps count below.
      const baselineTitleReads = harness.readTitle.mock.calls.length

      const previousMediaTime = 3_000 * playbackRate
      const exactAllowance = 120_000 + 2 * playbackRate * 1_000
      harness.setWallTime(4_000)
      harness.readCurrentTime.mockResolvedValueOnce(previousMediaTime + exactAllowance)
      await harness.manager.pollCurrentTime()
      await vi.advanceTimersByTimeAsync(0)
      expect(harness.readTitle).toHaveBeenCalledTimes(baselineTitleReads)

      harness.setWallTime(5_000)
      harness.readCurrentTime.mockResolvedValueOnce(
        previousMediaTime + exactAllowance + 120_000 + 2 * playbackRate * 1_000 + 1
      )
      await harness.manager.pollCurrentTime()
      await vi.advanceTimersByTimeAsync(0)

      expect(harness.readTitle).toHaveBeenCalledTimes(baselineTitleReads + 1)
    }
  )

  it('reads the title when playback leaves 0 without a timeline jump', async () => {
    const harness = createHarness()
    harness.readTitle.mockResolvedValue('PotPlayer')
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)

    // An idle player reports 0 until a file opens and starts playing from its start.
    harness.readCurrentTime.mockResolvedValue(0)
    for (let second = 0; second < 3; second++) {
      harness.setWallTime(second * 1_000)
      await harness.manager.pollCurrentTime()
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(harness.onInstancesChanged).toHaveBeenLastCalledWith([
      { pid: 10, hwnd: hwnd(100), title: 'PotPlayer', selected: true }
    ])

    harness.readTitle.mockResolvedValue('new-video.mp4')
    harness.readCurrentTime.mockResolvedValue(1_000)
    harness.setWallTime(3_000)
    await harness.manager.pollCurrentTime()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(harness.onInstancesChanged).toHaveBeenLastCalledWith([
      { pid: 10, hwnd: hwnd(100), title: 'new-video.mp4', selected: true }
    ])
  })

  it('reads the title again when a sample follows a failed read during a file load', async () => {
    const harness = createHarness()
    harness.readTitle.mockResolvedValue('PotPlayer')
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.readCurrentTime.mockResolvedValue(0)
    await harness.manager.pollCurrentTime()
    await vi.advanceTimersByTimeAsync(5_000)

    // The failed read's verification still sees the idle caption.
    harness.readCurrentTime.mockRejectedValueOnce(new Error('window is busy'))
    await expect(harness.manager.pollCurrentTime()).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.discoverInstances).toHaveBeenCalledTimes(2)
    expect(harness.manager.getInstanceSnapshot()[0]?.title).toBe('PotPlayer')

    // A bookmark lands deep in the file; there is no timeline left to show a jump.
    harness.readTitle.mockResolvedValue('bookmarked-video.mp4')
    harness.readCurrentTime.mockResolvedValue(3_600_000)
    await harness.manager.pollCurrentTime()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(harness.onInstancesChanged).toHaveBeenLastCalledWith([
      { pid: 10, hwnd: hwnd(100), title: 'bookmarked-video.mp4', selected: true }
    ])
  })

  it('suppresses a failed background sample and queues rate-limited verification', async () => {
    const harness = createHarness()
    await harness.manager.requestVerification('test')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.readCurrentTime.mockRejectedValueOnce(new Error('invalid HWND'))

    await expect(harness.manager.pollCurrentTime()).resolves.toBeNull()
    expect(harness.discoverInstances).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(3_999)
    expect(harness.discoverInstances).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.discoverInstances).toHaveBeenCalledTimes(2)
  })
})
