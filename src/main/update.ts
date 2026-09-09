import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Conf } from 'electron-conf/main'
import electronUpdater, { type AppUpdater } from 'electron-updater'

export function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

export function initAutoUpdater(conf: Conf): void {
  // Directory builds omit updater metadata; they are reviewable builds, not update clients.
  if (app.isPackaged && !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    console.debug('Skipping automatic updates: this build has no update configuration.')
    return
  }
  const autoUpdater = getAutoUpdater()
  autoUpdater.allowPrerelease = conf.get('prerelease', false) as boolean
  if (autoUpdater.allowPrerelease) console.debug('Allowing prerelease updates')
  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    console.error('Automatic update check failed:', error)
  })
}
