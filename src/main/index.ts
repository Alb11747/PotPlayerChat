import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron/main'

import { join } from 'path'
import { getCurrentTime, getStreamsHistory, getTotalTime } from './potplayer'
import { getForegroundWindow, getHwndByPidAndTitle, getWindowsByExe } from './windows'
import { removeSuffix } from '@/utils/strings'

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

  let potplayerHwnd: HWND | null = null
  let lastPotplayerHwnd: HWND | null = null

  ipcMain.handle('get-potplayer-hwnd', async () => {
    return potplayerHwnd || lastPotplayerHwnd
  })

  ipcMain.handle('set-potplayer-hwnd', async (_event, hwnd: HWND) => {
    if (potplayerHwnd !== null) lastPotplayerHwnd = potplayerHwnd
    potplayerHwnd = hwnd
  })

  let potplayerInstances: { hwnd: HWND; title: string }[] = []

  async function updatePotplayerInstances(): Promise<void> {
    const windows = await getWindowsByExe('PotPlayerMini64.exe')
    const windowsWithTitles = windows.map((win) => ({
      pid: win.pid,
      title: removeSuffix(win.windowTitle, ' - PotPlayer')
    }))
    const instances: { hwnd: HWND; title: string }[] = []
    for (const win of windowsWithTitles) {
      const hwnd = await getHwndByPidAndTitle(win.pid, win.title)
      if (hwnd) {
        instances.push({ hwnd, title: win.title })
      } else {
        console.warn(
          `Could not find hwnd for PotPlayer instance with PID ${win.pid} and title "${win.title}"`
        )
      }
    }
    if (potplayerInstances !== instances) {
      potplayerInstances = instances
      mainWindow.webContents.send('potplayer-instances-changed', potplayerInstances)
    }
    console.debug(`Found ${potplayerInstances.length} PotPlayer instances`)

    if (potplayerIntervalId) clearTimeout(potplayerIntervalId)
    potplayerIntervalId = setTimeout(updatePotplayerInstances, 5 * 60 * 1000) // Update every 5 minutes
  }

  let currentTimeIntervalId: NodeJS.Timeout | null = null
  let potplayerIntervalId: NodeJS.Timeout | null = null
  let activePotplayerIntervalId: NodeJS.Timeout | null = null

  function startInterval(): void {
    if (!currentTimeIntervalId) {
      currentTimeIntervalId = setInterval(async () => {
        if (potplayerHwnd) {
          const currentTime = await getCurrentTime(potplayerHwnd)
          mainWindow.webContents.send('set-current-time', currentTime)
        }
      }, 1000)
    }
    if (!potplayerIntervalId) {
      updatePotplayerInstances()
    }
    if (!activePotplayerIntervalId) {
      activePotplayerIntervalId = setInterval(async () => {
        const focusedWindow = await getForegroundWindow()
        if (!focusedWindow) return
        for (const instance of potplayerInstances) {
          if (focusedWindow === instance.hwnd) {
            if (potplayerHwnd !== instance.hwnd) {
              potplayerHwnd = instance.hwnd
              if (potplayerHwnd === null) {
                mainWindow.webContents.send('potplayer-instances-changed', potplayerInstances)
              }
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
    return await getStreamsHistory()
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
