import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app } from 'electron'
import { Conf } from 'electron-conf/main'
import { join } from 'path'
import { pathToFileURL } from 'url'

import { initLinks } from './links'
import { initLog } from './log'
import { initMaintenanceHandlers } from './maintenance'
import { initContextMenus } from './menu'
import { initPotplayerHandlers } from './potplayer'
import { initSecurity } from './security'
import { initStorage } from './storage'
import { initAutoUpdater } from './update'

type PopupKind = 'search' | 'user'

function getRendererWindowUrl(fileName: `${PopupKind}.html`): string {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    return new URL(fileName, rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`).href
  }
  return pathToFileURL(join(__dirname, `../renderer/${fileName}`)).href
}

function getPopupKind(url: string, expectedUrls: Record<PopupKind, string>): PopupKind | null {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.hash = ''
    for (const [kind, expectedUrl] of Object.entries(expectedUrls)) {
      if (parsedUrl.href === expectedUrl) return kind as PopupKind
    }
    return null
  } catch {
    return null
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

  const popupUrls: Record<PopupKind, string> = {
    search: getRendererWindowUrl('search.html'),
    user: getRendererWindowUrl('user.html')
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const popupKind = getPopupKind(url, popupUrls)
    if (!popupKind) return { action: 'deny' }

    const mainBounds = mainWindow.getBounds()
    const isUserWindow = popupKind === 'user'
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        width: isUserWindow ? 600 : Math.round(mainBounds.width * 0.8),
        height: isUserWindow ? 640 : Math.round(mainBounds.height * 0.8),
        minWidth: isUserWindow ? 420 : undefined,
        minHeight: isUserWindow ? 400 : undefined,
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

  mainWindow.webContents.on('did-create-window', (popupWindow, { url }) => {
    if (!getPopupKind(url, popupUrls)) return
    popupWindow.once('ready-to-show', () => {
      popupWindow.show()
      popupWindow.focus()
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
