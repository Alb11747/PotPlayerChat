import { EventEmitter } from 'node:events'
import type { PotPlayerManagerDependencies } from './potplayer-manager'
import type { HWND } from '@/types/globals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getForegroundWindow: vi.fn(),
  manager: {
    requestVerification: vi.fn(),
    pollCurrentTime: vi.fn(),
    noteActiveHwnd: vi.fn()
  },
  onInstancesChanged: undefined as PotPlayerManagerDependencies['onInstancesChanged'] | undefined
}))

vi.mock('electron', () => ({ default: { ipcMain: { handle: mocks.handle } } }))
vi.mock('@/core/os/potplayer', () => ({
  discoverPotPlayerInstances: vi.fn(),
  getCurrentVideoTime: vi.fn(),
  getTotalVideoTime: vi.fn(),
  getPlaylists: vi.fn(),
  getStreamHistory: vi.fn()
}))
vi.mock('@/core/os/windows', () => ({
  getForegroundWindow: mocks.getForegroundWindow,
  getLiveWindowText: vi.fn()
}))
vi.mock('@/core/potplayer/potplayer', () => ({
  getPotplayerExtraInfo: vi.fn(),
  initCache: vi.fn()
}))
vi.mock('./potplayer-manager', () => ({
  PotPlayerInstanceManager: class {
    constructor(dependencies: PotPlayerManagerDependencies) {
      mocks.onInstancesChanged = dependencies.onInstancesChanged
      return mocks.manager
    }
  }
}))

import { initPotplayerHandlers } from './potplayer'

function createWindow(): {
  window: EventEmitter & { isDestroyed: ReturnType<typeof vi.fn>; webContents: typeof webContents }
  webContents: EventEmitter & {
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
} {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  })
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    webContents
  })
  initPotplayerHandlers(window as never, {} as never)
  return { window, webContents }
}

describe('PotPlayer polling window lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.manager.requestVerification.mockResolvedValue(undefined)
    mocks.manager.pollCurrentTime.mockResolvedValue(1_000)
    mocks.getForegroundWindow.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('sends current time and continues polling while the window is live', async () => {
    const { window, webContents } = createWindow()
    window.emit('show')
    await vi.advanceTimersByTimeAsync(0)

    expect(webContents.send).toHaveBeenCalledExactlyOnceWith('updateCurrentVideoTime', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.manager.pollCurrentTime).toHaveBeenCalledTimes(2)
    window.emit('close')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['close', 'closed', 'destroyed'] as const)(
    'drops asynchronous poll results and stops polling on %s',
    async (event) => {
      let finishTime!: (value: number) => void
      let finishFocus!: (value: HWND) => void
      mocks.manager.pollCurrentTime.mockReturnValue(
        new Promise<number>((resolve) => {
          finishTime = resolve
        })
      )
      mocks.getForegroundWindow.mockReturnValue(
        new Promise<HWND>((resolve) => {
          finishFocus = resolve
        })
      )
      const { window, webContents } = createWindow()
      window.emit('show')
      await vi.advanceTimersByTimeAsync(0)

      if (event === 'destroyed') {
        webContents.isDestroyed.mockReturnValue(true)
        webContents.emit(event)
      } else {
        if (event === 'closed') window.isDestroyed.mockReturnValue(true)
        window.emit(event)
      }
      finishTime(2_000)
      finishFocus(100 as unknown as HWND)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(webContents.send).not.toHaveBeenCalled()
      expect(mocks.manager.noteActiveHwnd).not.toHaveBeenCalled()
      expect(mocks.manager.pollCurrentTime).toHaveBeenCalledTimes(1)
      expect(mocks.manager.requestVerification).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(['window', 'webContents'] as const)(
    'drops late instance notifications and does not restart polling for a destroyed %s',
    (target) => {
      const { window, webContents } = createWindow()
      const destroyed = target === 'window' ? window : webContents
      destroyed.isDestroyed.mockReturnValue(true)

      expect(() => mocks.onInstancesChanged?.([])).not.toThrow()
      window.emit('focus')

      expect(webContents.send).not.toHaveBeenCalled()
      expect(mocks.manager.pollCurrentTime).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
