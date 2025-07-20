import electronUpdater, { type AppUpdater } from 'electron-updater'

export function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

export function initAutoUpdater(): void {
  const autoUpdater = getAutoUpdater()
  autoUpdater.checkForUpdatesAndNotify()
}
