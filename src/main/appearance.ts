import { BrowserWindow, ipcMain } from 'electron'
import type { Conf } from 'electron-conf/main'
import { normalizeAppearancePreferences } from '../types/appearance'

export function initAppearanceHandlers(conf: Conf): void {
  const current = (): ReturnType<typeof normalizeAppearancePreferences> =>
    normalizeAppearancePreferences(conf.get('settings.interface'))
  ipcMain.handle('getAppearancePreferences', current)
  let last = JSON.stringify(current())
  conf.onDidChange('settings', () => {
    const preferences = current()
    const serialized = JSON.stringify(preferences)
    if (serialized === last) return
    last = serialized
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send('appearanceChanged', preferences)
    }
  })
}
