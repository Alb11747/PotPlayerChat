import { clearTitleCache } from '@/core/potplayer/potplayer'
import { clearConfigEntriesByPrefix } from '@/utils/cache'
import { BrowserWindow, ipcMain } from 'electron'
import type { Conf } from 'electron-conf/main'
import { clearLinkPreviewCache, clearUrlClicked, clearUrlSeen } from './links'

const APP_CACHE_CLEARED_CHANNEL = 'appCacheCleared'
const SAVED_URLS_CLEARED_CHANNEL = 'savedUrlsCleared'

function broadcast(channel: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(channel)
  }
}

export function initMaintenanceHandlers(config: Conf): void {
  ipcMain.handle('clearAppCache', () => {
    clearLinkPreviewCache()
    clearTitleCache()
    clearConfigEntriesByPrefix(config, 'cache:')
    broadcast(APP_CACHE_CLEARED_CHANNEL)
  })

  ipcMain.handle('clearSavedUrls', () => {
    clearUrlSeen()
    clearUrlClicked()
    broadcast(SAVED_URLS_CLEARED_CHANNEL)
  })
}
