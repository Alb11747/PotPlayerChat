import { EventEmitter } from 'node:events'
import { ipcMain } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initLog } from './log'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})

const levels = ['debug', 'info', 'warn', 'error'] as const
const windows: EventEmitter[] = []

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
  windows.push(window)
  return { window, webContents }
}

afterEach(() => {
  for (const window of windows.splice(0)) window.emit('closed')
  vi.restoreAllMocks()
  ipcMain.removeAllListeners()
})

describe('main-process log forwarding', () => {
  it('calls each original console function and forwards logs while the window is live', () => {
    const originals = levels.map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const { window, webContents } = createWindow()
    initLog(window as never)

    for (const [index, level] of levels.entries()) {
      console[level]('message', 42)
      expect(originals[index]).toHaveBeenCalledExactlyOnceWith('message', 42)
      expect(webContents.send).toHaveBeenLastCalledWith('log', {
        messages: ['message', 42],
        level
      })
    }
    console.info()
    expect(originals[1]).toHaveBeenCalledTimes(2)
  })

  it.each(['window', 'webContents'] as const)(
    'keeps console output without forwarding when %s is destroyed before its lifecycle event',
    (target) => {
      const original = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { window, webContents } = createWindow()
      initLog(window as never)
      const hook = console.warn
      const destroyed = target === 'window' ? window : webContents
      destroyed.isDestroyed.mockReturnValue(true)

      expect(() => hook('late process warning')).not.toThrow()
      expect(original).toHaveBeenCalledExactlyOnceWith('late process warning')
      expect(webContents.send).not.toHaveBeenCalled()
    }
  )

  it.each(['closed', 'destroyed'] as const)(
    'restores console functions and removes only its IPC listeners on %s',
    (event) => {
      const originals = levels.map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
      const unrelatedListener = vi.fn()
      ipcMain.on('warn', unrelatedListener)
      const { window, webContents } = createWindow()
      initLog(window as never)
      const lateHook = console.warn

      if (event === 'closed') window.emit(event)
      else webContents.emit(event)

      for (const [index, level] of levels.entries()) {
        expect(console[level]).toBe(originals[index])
        expect(ipcMain.listenerCount(level)).toBe(level === 'warn' ? 1 : 0)
      }
      expect(window.listenerCount('closed')).toBe(0)
      expect(webContents.listenerCount('destroyed')).toBe(0)
      expect(() => console.warn('after close')).not.toThrow()
      expect(() => lateHook('in-flight warning')).not.toThrow()
      expect(originals[2]).toHaveBeenCalledTimes(2)
      expect(webContents.send).not.toHaveBeenCalled()
      ipcMain.emit('warn', 'external event')
      expect(unrelatedListener).toHaveBeenCalledExactlyOnceWith('external event')
    }
  )
})
