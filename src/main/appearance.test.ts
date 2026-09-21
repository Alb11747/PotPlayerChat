import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  getAllWindows: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler)
  }
}))
import { initAppearanceHandlers } from './appearance'

describe('appearance preference notification', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
  })
  it('reads the main config and broadcasts changes to live windows once without writing back', () => {
    let value = {
      layout: 'comfort',
      palette: 'blue',
      previewMode: 'hover',
      improveUsernameContrast: true
    }
    let change: (() => void) | undefined
    const config = {
      get: vi.fn(() => value),
      set: vi.fn(),
      onDidChange: vi.fn((_key: string, listener: () => void) => {
        change = listener
      })
    }
    const send = vi.fn()
    const destroyedSend = vi.fn()
    mocks.getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
      { isDestroyed: () => false, webContents: { isDestroyed: () => true, send: destroyedSend } }
    ])
    initAppearanceHandlers(config as never)
    expect(mocks.handlers.get('getAppearancePreferences')?.()).toEqual(value)
    change?.()
    expect(send).not.toHaveBeenCalled()
    value = { ...value, palette: 'lavender' }
    change?.()
    change?.()
    expect(send).toHaveBeenCalledExactlyOnceWith('appearanceChanged', value)
    expect(destroyedSend).not.toHaveBeenCalled()
    expect(config.set).not.toHaveBeenCalled()
    send.mockClear()
    value = { ...value, improveUsernameContrast: false }
    change?.()
    change?.()
    expect(send).toHaveBeenCalledExactlyOnceWith('appearanceChanged', value)
    expect(config.set).not.toHaveBeenCalled()
  })
})
