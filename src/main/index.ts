import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app } from 'electron'
import { Conf } from 'electron-conf/main'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { initPopupWindows } from './popup-windows'
import { initAppearanceHandlers } from './appearance'

import { initLinks } from './links'
import { initLog } from './log'
import { initMaintenanceHandlers } from './maintenance'
import { initContextMenus } from './menu'
import { initPotplayerHandlers } from './potplayer'
import { initSecurity } from './security'
import { initStorage } from './storage'
import { initAutoUpdater } from './update'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    icon,
    width: 600,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  initLog(mainWindow)

  const conf = new Conf()
  conf.registerRendererListener()
  initAppearanceHandlers(conf)

  initSecurity(mainWindow)
  initStorage()
  initContextMenus(mainWindow)
  initLinks(conf)
  initPotplayerHandlers(mainWindow, conf)
  initMaintenanceHandlers(conf)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    initAutoUpdater(conf)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  initPopupWindows(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
