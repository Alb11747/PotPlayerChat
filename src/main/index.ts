import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@core/chat/twitch-msg'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron'
import { Conf } from 'electron-conf/main'
import { join } from 'path'

import { initLinks } from './links'
import { initContextMenus } from './menu'
import { initPotplayerHandlers } from './potplayer'
import { initSecurity } from './security'
import { initStorage } from './storage'

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

  const conf = new Conf()
  conf.registerRendererListener()

  initSecurity(mainWindow)
  initStorage()
  initContextMenus(mainWindow)
  initLinks()
  initPotplayerHandlers(mainWindow)

  mainWindow.on('ready-to-show', mainWindow.show)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Create search window
  function createSearchWindow(
    potplayerInfo: PotPlayerInfo,
    messages?: TwitchMessage[],
    initialSearch?: string
  ): BrowserWindow {
    const searchWindow = new BrowserWindow({
      width: 400,
      height: 600,
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
      searchWindow.webContents.send('searchInfo', { potplayerInfo, messages, initialSearch })
      searchWindow.show()
      searchWindow.focus()
    })

    return searchWindow
  }

  ipcMain.handle(
    'openSearchWindow',
    async (
      _event,
      {
        potplayerInfo,
        messages,
        initialSearch
      }: { potplayerInfo: PotPlayerInfo; messages?: TwitchMessage[]; initialSearch?: string }
    ) => {
      createSearchWindow(potplayerInfo, messages, initialSearch)
    }
  )
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
