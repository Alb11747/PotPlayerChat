import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app } from 'electron'
import { Conf } from 'electron-conf/main'
import { join } from 'path'
import { pathToFileURL } from 'url'

import { initLinks } from './links'
import { initLog } from './log'
import { initContextMenus } from './menu'
import { initPotplayerHandlers } from './potplayer'
import { initSecurity } from './security'
import { initStorage } from './storage'
import { initAutoUpdater } from './update'

function getSearchWindowUrl(): string {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    return new URL('search.html', rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`).href
  }
  return pathToFileURL(join(__dirname, '../renderer/search.html')).href
}

function isSearchWindowUrl(url: string, expectedUrl: string): boolean {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.hash = ''
    return parsedUrl.href === expectedUrl
  } catch {
    return false
  }
}

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
  initLinks(conf)
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

  const searchWindowUrl = getSearchWindowUrl()
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSearchWindowUrl(url, searchWindowUrl)) return { action: 'deny' }

    const mainBounds = mainWindow.getBounds()
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        width: Math.round(mainBounds.width * 0.8),
        height: Math.round(mainBounds.height * 0.8),
        show: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false
        }
      }
    }
  })

  mainWindow.webContents.on('did-create-window', (searchWindow, { url }) => {
    if (!isSearchWindowUrl(url, searchWindowUrl)) return
    searchWindow.once('ready-to-show', () => {
      searchWindow.show()
      searchWindow.focus()
    })
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
