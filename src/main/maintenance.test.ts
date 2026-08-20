import { beforeEach, describe, expect, it, vi } from 'vitest'

const maintenanceMocks = vi.hoisted(() => ({
  clearLinkPreviewCache: vi.fn(),
  clearTitleCache: vi.fn(),
  clearUrlClicked: vi.fn(),
  clearUrlSeen: vi.fn(),
  getAllWindows: vi.fn(),
  handlers: new Map<string, () => void>(),
  handle: vi.fn((channel: string, handler: () => void) => {
    maintenanceMocks.handlers.set(channel, handler)
  })
}))

vi.mock('@/core/potplayer/potplayer', () => ({
  clearTitleCache: maintenanceMocks.clearTitleCache
}))
vi.mock('./links', () => ({
  clearLinkPreviewCache: maintenanceMocks.clearLinkPreviewCache,
  clearUrlClicked: maintenanceMocks.clearUrlClicked,
  clearUrlSeen: maintenanceMocks.clearUrlSeen
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: maintenanceMocks.getAllWindows },
  ipcMain: { handle: maintenanceMocks.handle }
}))

import { initMaintenanceHandlers } from './maintenance'

describe('initMaintenanceHandlers', () => {
  beforeEach(() => {
    maintenanceMocks.handlers.clear()
    vi.clearAllMocks()
  })

  it('clears app caches while preserving settings and saved URL history', () => {
    const activeSend = vi.fn()
    const destroyedSend = vi.fn()
    maintenanceMocks.getAllWindows.mockReturnValue([
      { webContents: { isDestroyed: () => false, send: activeSend } },
      { webContents: { isDestroyed: () => true, send: destroyedSend } }
    ])
    const config = new Map<string, unknown>([
      ['cache:title', { stream: 'cached' }],
      ['cache:twitch-user-id', { streamer: '123' }],
      ['settings', { chat: { chatMessageLimit: 200 } }],
      ['data:urlSeenSet', { filters: [] }],
      ['data:urlClickedSet', { filters: [] }]
    ])
    initMaintenanceHandlers(config as never)

    maintenanceMocks.handlers.get('clearAppCache')?.()

    expect(maintenanceMocks.clearLinkPreviewCache).toHaveBeenCalledOnce()
    expect(maintenanceMocks.clearTitleCache).toHaveBeenCalledOnce()
    expect(config).toEqual(
      new Map([
        ['settings', { chat: { chatMessageLimit: 200 } }],
        ['data:urlSeenSet', { filters: [] }],
        ['data:urlClickedSet', { filters: [] }]
      ])
    )
    expect(activeSend).toHaveBeenCalledWith('appCacheCleared')
    expect(destroyedSend).not.toHaveBeenCalled()
  })

  it('clears saved URL history and notifies open windows', () => {
    const send = vi.fn()
    maintenanceMocks.getAllWindows.mockReturnValue([
      { webContents: { isDestroyed: () => false, send } }
    ])
    initMaintenanceHandlers(new Map() as never)

    maintenanceMocks.handlers.get('clearSavedUrls')?.()

    expect(maintenanceMocks.clearUrlSeen).toHaveBeenCalledOnce()
    expect(maintenanceMocks.clearUrlClicked).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('savedUrlsCleared')
  })
})
