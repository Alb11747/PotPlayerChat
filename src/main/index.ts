import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron'
import { Conf } from 'electron-conf/main'
import { join } from 'path'

import type { SearchInfo } from '@/types/preload'
import { IpcPromiseMain } from '@/utils/electron'
import { initLinks } from './links'
import { initLog } from './log'
import { initContextMenus } from './menu'
import { initPotplayerHandlers } from './potplayer'
import { initSecurity } from './security'
import { initStorage } from './storage'
import { initAutoUpdater } from './update'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  initSecurity(mainWindow)
  initStorage()
  initContextMenus(mainWindow)
  initLinks()
  initPotplayerHandlers(mainWindow, conf)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    initAutoUpdater(conf)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const messagesRawIpcPromise = new IpcPromiseMain<ArrayBufferLike>(ipcMain, 'messagesRaw', true)

  // Create search window
  function createSearchWindow(): BrowserWindow {
    const mainBounds = mainWindow.getBounds()
    const searchWindow = new BrowserWindow({
      width: mainBounds.width * 0.8,
      height: mainBounds.height * 0.8,
      show: false,
      autoHideMenuBar: true,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      searchWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/search.html`)
    } else {
      searchWindow.loadFile(join(__dirname, '../renderer/search.html'))
    }

    searchWindow.once('ready-to-show', () => {
      searchWindow.show()
      searchWindow.focus()
    })

    return searchWindow
  }

  ipcMain.handle('openSearchWindow', async (_event, args: SearchInfo) => {
    const searchWindow = createSearchWindow()
    searchWindow.webContents.send('searchInfo', args)
    searchWindow.webContents.send(messagesRawIpcPromise.channel, await messagesRawIpcPromise.get())
  })
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
