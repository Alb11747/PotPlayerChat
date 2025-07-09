import type { HWND } from '@/types/globals'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { loadDataFile, saveDataFile } from './storage'

import { RecentValue } from '@/utils/state'
import AsyncLock from 'async-lock'
import { join } from 'path'
import {
  getCurrentTime,
  getPotPlayerInstances,
  getStreamHistory,
  getTotalTime,
  type PotPlayerInstance
} from './potplayer'
import { getForegroundWindow } from './windows'

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

  const lock = new AsyncLock()

  ipcMain.handle('load-data-file', async (_event, subpath: string) => {
    return await loadDataFile(subpath)
  })

  ipcMain.handle('save-data-file', async (_event, subpath: string, value: unknown) => {
    await saveDataFile(subpath, value)
    return true
  })

  const keysCache: { twitch?: { clientId: string; clientSecret: string } | null } = {}

  ipcMain.handle('load-keys', async () => {
    return await lock.acquire('keysCache', async () => {
      if (keysCache.twitch === undefined) {
        const twitchKeys = (await loadDataFile<{ clientId: string; clientSecret: string }>(
          'twitch-keys.json'
        )) || {
          clientId: '',
          clientSecret: ''
        }
        if (twitchKeys.clientId) keysCache.twitch = twitchKeys
        else keysCache.twitch = null
      }
      return keysCache
    })
  })

  let selectedPotplayerHwnd: HWND | null = null
  const lastActivePotplayerHwnd = new RecentValue<HWND>()

  async function sendPotplayerInstancesChanged(
    potplayerInstances: { hwnd: HWND; title: string }[],
    selectedPotplayerHwnd: HWND | null
  ): Promise<void> {
    console.debug('Updating PotPlayer instances list')
    await mainWindow.webContents.send(
      'potplayer-instances-changed',
      potplayerInstances.map((instance) => ({
        ...instance,
        selected: instance.hwnd === selectedPotplayerHwnd
      }))
    )
  }

  function getPotplayerHwnd(): HWND | null {
    return selectedPotplayerHwnd || lastActivePotplayerHwnd.getRecent()
  }

  ipcMain.handle('get-potplayer-hwnd', async () => {
    return getPotplayerHwnd()
  })

  ipcMain.handle('set-potplayer-hwnd', async (_event, hwnd: HWND) => {
    if (selectedPotplayerHwnd !== hwnd) {
      const lastSelected = getPotplayerHwnd()
      selectedPotplayerHwnd = hwnd
      if (lastSelected !== selectedPotplayerHwnd)
        await sendPotplayerInstancesChanged(potplayerInstances, selectedPotplayerHwnd)
    }
    await updatePotplayerInstances()
  })

  let potplayerInstancesDebounceTimeoutId: NodeJS.Timeout | null = null
  let potplayerInstances: PotPlayerInstance[] = []

  async function updatePotplayerInstances(): Promise<void> {
    if (potplayerInstancesDebounceTimeoutId) return
    potplayerInstancesDebounceTimeoutId = setTimeout(() => {
      potplayerInstancesDebounceTimeoutId = null
    }, 50)

    const instances = await getPotPlayerInstances()
    console.debug(`Found ${instances.length} PotPlayer instance(s)`)
    if (potplayerInstances !== instances) {
      potplayerInstances = instances

      // If the selected PotPlayer instance is not in the list, set it to null
      if (selectedPotplayerHwnd) {
        const exists = potplayerInstances.some((i) => i.hwnd === selectedPotplayerHwnd)
        if (!exists) selectedPotplayerHwnd = null
      }

      // If the last active instance is not in the list, remove it
      lastActivePotplayerHwnd.filter(potplayerInstances.map((i) => i.hwnd))

      // If there is only one instance, select it automatically
      if (potplayerInstances.length === 1 && selectedPotplayerHwnd === null)
        selectedPotplayerHwnd = potplayerInstances[0]!.hwnd

      await sendPotplayerInstancesChanged(potplayerInstances, selectedPotplayerHwnd)
    }

    if (potplayerIntervalId) clearTimeout(potplayerIntervalId)
    potplayerIntervalId = setTimeout(updatePotplayerInstances, 5 * 60 * 1000) // Update every 5 minutes
  }

  let currentTimeIntervalId: NodeJS.Timeout | null = null
  let potplayerIntervalId: NodeJS.Timeout | null = null
  let activePotplayerIntervalId: NodeJS.Timeout | null = null

  function startInterval(): void {
    if (!currentTimeIntervalId) {
      currentTimeIntervalId = setInterval(async () => {
        const potplayerHwnd = getPotplayerHwnd()
        if (potplayerHwnd) {
          const currentTime = await getCurrentTime(potplayerHwnd)
          mainWindow.webContents.send('set-current-time', currentTime)
        }
      }, 1000)
    }

    if (!potplayerIntervalId) {
      updatePotplayerInstances()
    }

    // Poll for active PotPlayer instance
    if (!activePotplayerIntervalId) {
      activePotplayerIntervalId = setInterval(async () => {
        const focusedWindow = await getForegroundWindow()
        if (!focusedWindow) return
        // Check if the focused window is a PotPlayer instance
        for (const instance of potplayerInstances) {
          if (focusedWindow === instance.hwnd) {
            if (lastActivePotplayerHwnd.getRecent() !== instance.hwnd) {
              lastActivePotplayerHwnd.add(instance.hwnd)

              // If the selected PotPlayer instance is not set, that means we are using the last active one
              if (selectedPotplayerHwnd === null)
                await sendPotplayerInstancesChanged(
                  potplayerInstances,
                  lastActivePotplayerHwnd.getRecent()
                )
            }
          }
        }
      }, 1000)
    }
  }

  function stopInterval(): void {
    if (currentTimeIntervalId) {
      clearInterval(currentTimeIntervalId)
      currentTimeIntervalId = null
    }
    if (potplayerIntervalId) {
      clearInterval(potplayerIntervalId)
      potplayerIntervalId = null
    }
    if (activePotplayerIntervalId) {
      clearInterval(activePotplayerIntervalId)
      activePotplayerIntervalId = null
    }
  }

  mainWindow.on('ready-to-show', startInterval)
  mainWindow.on('show', startInterval)
  mainWindow.on('restore', startInterval)
  mainWindow.on('hide', stopInterval)
  mainWindow.on('minimize', stopInterval)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ipcMain.handle('get-potplayers', async () => {
    await updatePotplayerInstances()
    return potplayerInstances
  })

  ipcMain.handle('get-current-time', async (_event, hwnd: HWND) => {
    return getCurrentTime(hwnd)
  })

  ipcMain.handle('get-total-time', async (_event, hwnd: HWND) => {
    return getTotalTime(hwnd)
  })

  ipcMain.handle('get-stream-history', async () => {
    return await getStreamHistory()
  })

  ipcMain.handle('open-url', async (_event, url: string) => {
    if (
      url &&
      typeof url === 'string' &&
      (url.startsWith('http://') || url.startsWith('https://'))
    ) {
      await shell.openExternal(url)
    } else {
      console.warn('Invalid URL provided to open-url handler:', url)
    }
  })

  ipcMain.handle('get-link-preview', async (_event, url: string) => {
    try {
      if (
        !url ||
        typeof url !== 'string' ||
        (!url.startsWith('http://') && !url.startsWith('https://'))
      ) {
        return null
      }

      const encodedUrl = encodeURIComponent(url)
      console.debug(`Fetching link preview for: ${url}`)
      const response = await fetch(`https://chatterino.alb11747.com/link_resolver/${encodedUrl}`)

      if (!response.ok) {
        console.warn(`Link preview failed for ${url}: HTTP ${response.status}`)
        return null
      }

      const data = await response.json()

      console.debug(`Link preview fetched for: ${url}`)

      return {
        status: data.status || 200,
        thumbnail: data.thumbnail,
        tooltip: decodeURIComponent(data.tooltip || ''),
        link: data.link || url
      }
    } catch (error) {
      console.warn('Failed to fetch link preview:', error)
      return null
    }
  })

  // Create search window
  function createSearchWindow(): BrowserWindow {
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
      searchWindow.show()
      searchWindow.focus()
    })

    searchWindow.on('closed', () => {
      // Window will be garbage collected
    })

    return searchWindow
  }

  ipcMain.handle('open-search-window', async () => {
    createSearchWindow()
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
