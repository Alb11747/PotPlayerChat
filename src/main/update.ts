import type { Conf } from 'electron-conf/main'
import electronUpdater, { type AppUpdater } from 'electron-updater'

export function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

export function initAutoUpdater(conf: Conf): void {
  const autoUpdater = getAutoUpdater()
  autoUpdater.allowPrerelease = conf.get('prerelease', false) as boolean
  if (autoUpdater.allowPrerelease) console.debug('Allowing prerelease updates')
  autoUpdater.checkForUpdatesAndNotify()
}
