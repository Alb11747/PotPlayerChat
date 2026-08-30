import {
  discoverPotPlayerInstances,
  getCurrentVideoTime,
  getPlaylists,
  getStreamHistory,
  getTotalVideoTime
} from '@/core/os/potplayer'
import { getForegroundWindow, getLiveWindowText } from '@/core/os/windows'
import { getPotplayerExtraInfo, initCache } from '@/core/potplayer/potplayer'
import { PotPlayerInstanceManager } from '@/main/potplayer-manager'
import type { HWND } from '@/types/globals'
import type { PollingIntervals } from '@/types/preload'
import { removeSuffix } from '@/utils/strings'
import electron, { type BrowserWindow } from 'electron'
import type { Conf } from 'electron-conf/main'

export function initPotplayerHandlers(mainWindow: BrowserWindow, conf: Conf): void {
  const ipcMain = electron.ipcMain
  const manager = new PotPlayerInstanceManager({
    discoverInstances: discoverPotPlayerInstances,
    readTitle: async (hwnd) => removeSuffix(await getLiveWindowText(hwnd), ' - PotPlayer'),
    readCurrentTime: getCurrentVideoTime,
    readTotalTime: getTotalVideoTime,
    onInstancesChanged: (instances) => {
      console.debug('Updating PotPlayer instances list')
      mainWindow.webContents.send('potplayerInstancesChanged', instances)
    }
  })

  ipcMain.handle('getPotplayerHwnd', async () => manager.getSelectedHwnd())
  ipcMain.handle('setPotplayerHwnd', async (_event, hwnd: HWND | null) => {
    await manager.setSelectedHwnd(hwnd)
  })

  const defaultPollingIntervals: PollingIntervals = {
    potplayerInstances: 5 * 60 * 1000,
    videoTime: 1000,
    activeWindow: 1000
  }
  const pollingIntervals: PollingIntervals = { ...defaultPollingIntervals }

  ipcMain.handle('getDefaultPollingIntervals', () => defaultPollingIntervals)
  ipcMain.handle('getPollingIntervals', () => pollingIntervals)
  ipcMain.handle('setPollingIntervals', (_event, args: Partial<PollingIntervals>) => {
    if (
      args.potplayerInstances &&
      args.potplayerInstances !== pollingIntervals.potplayerInstances
    ) {
      args.potplayerInstances = Math.max(args.potplayerInstances, 500)
      console.debug(
        `Updating pollingIntervals.potplayerInstances: ${pollingIntervals.potplayerInstances} -> ${args.potplayerInstances}`
      )
      pollingIntervals.potplayerInstances = args.potplayerInstances
      manager.requestVerificationBackground('polling-interval-changed')
    }
    if (args.videoTime && args.videoTime !== pollingIntervals.videoTime) {
      args.videoTime = Math.max(args.videoTime, 500)
      console.debug(
        `Updating pollingIntervals.videoTime: ${pollingIntervals.videoTime} -> ${args.videoTime}`
      )
      pollingIntervals.videoTime = args.videoTime
      void updateCurrentVideoTime()
    }
    if (args.activeWindow && args.activeWindow !== pollingIntervals.activeWindow) {
      args.activeWindow = Math.max(args.activeWindow, 100)
      console.debug(
        `Updating pollingIntervals.activeWindow: ${pollingIntervals.activeWindow} -> ${args.activeWindow}`
      )
      pollingIntervals.activeWindow = args.activeWindow
      void updateActivePotplayerInstance()
    }
  })

  let pollingActive = false
  let potplayerTimeoutId: NodeJS.Timeout | null = null
  let currentTimeTimeoutId: NodeJS.Timeout | null = null
  let activePotplayerTimeoutId: NodeJS.Timeout | null = null
  let currentTimeUpdateRunning = false
  let currentTimeUpdateQueued = false
  let activeWindowUpdateRunning = false
  let activeWindowUpdateQueued = false

  async function updatePotplayerInstances(): Promise<void> {
    if (!pollingActive) return
    if (potplayerTimeoutId) clearTimeout(potplayerTimeoutId)
    potplayerTimeoutId = null
    try {
      await manager.requestVerification('periodic-instance-poll')
    } catch (error) {
      console.error('Periodic PotPlayer verification failed:', error)
    } finally {
      if (pollingActive) {
        potplayerTimeoutId = setTimeout(
          updatePotplayerInstances,
          pollingIntervals.potplayerInstances
        )
      }
    }
  }

  async function updateCurrentVideoTime(): Promise<void> {
    if (!pollingActive) return
    if (currentTimeUpdateRunning) {
      currentTimeUpdateQueued = true
      return
    }
    currentTimeUpdateRunning = true
    if (currentTimeTimeoutId) clearTimeout(currentTimeTimeoutId)
    currentTimeTimeoutId = null
    try {
      const currentTime = await manager.pollCurrentTime()
      if (currentTime !== null) {
        mainWindow.webContents.send('updateCurrentVideoTime', currentTime)
      }
    } catch (error) {
      console.error('Periodic PotPlayer current-time update failed:', error)
    } finally {
      currentTimeUpdateRunning = false
      if (pollingActive) {
        const delayMs = currentTimeUpdateQueued ? 0 : pollingIntervals.videoTime
        currentTimeUpdateQueued = false
        currentTimeTimeoutId = setTimeout(updateCurrentVideoTime, delayMs)
      }
    }
  }

  async function updateActivePotplayerInstance(): Promise<void> {
    if (!pollingActive) return
    if (activeWindowUpdateRunning) {
      activeWindowUpdateQueued = true
      return
    }
    activeWindowUpdateRunning = true
    if (activePotplayerTimeoutId) clearTimeout(activePotplayerTimeoutId)
    activePotplayerTimeoutId = null
    try {
      const focusedWindow = await getForegroundWindow()
      if (focusedWindow) await manager.noteActiveHwnd(focusedWindow)
    } catch (error) {
      console.error('Periodic PotPlayer active-window update failed:', error)
    } finally {
      activeWindowUpdateRunning = false
      if (pollingActive) {
        const delayMs = activeWindowUpdateQueued ? 0 : pollingIntervals.activeWindow
        activeWindowUpdateQueued = false
        activePotplayerTimeoutId = setTimeout(updateActivePotplayerInstance, delayMs)
      }
    }
  }

  function startPolling(): void {
    if (pollingActive) return
    pollingActive = true
    void updatePotplayerInstances()
    void updateCurrentVideoTime()
    void updateActivePotplayerInstance()
  }

  function stopPolling(): void {
    pollingActive = false
    currentTimeUpdateQueued = false
    activeWindowUpdateQueued = false
    if (currentTimeTimeoutId) clearTimeout(currentTimeTimeoutId)
    currentTimeTimeoutId = null
    if (potplayerTimeoutId) clearTimeout(potplayerTimeoutId)
    potplayerTimeoutId = null
    if (activePotplayerTimeoutId) clearTimeout(activePotplayerTimeoutId)
    activePotplayerTimeoutId = null
  }

  mainWindow.on('ready-to-show', startPolling)
  mainWindow.on('show', startPolling)
  mainWindow.on('restore', startPolling)
  mainWindow.on('focus', startPolling)
  mainWindow.on('hide', stopPolling)
  mainWindow.on('minimize', stopPolling)
  mainWindow.on('close', stopPolling)

  ipcMain.handle('getPotplayers', async () => manager.getInstances())
  ipcMain.handle('getCurrentVideoTime', async (_event, hwnd: HWND) => {
    return manager.getCurrentTime(hwnd)
  })
  ipcMain.handle('getTotalVideoTime', async (_event, hwnd: HWND) => {
    return manager.getTotalTime(hwnd)
  })
  ipcMain.handle('getPlaylists', async () => getPlaylists())
  ipcMain.handle('getStreamHistory', async () => getStreamHistory())

  initCache(conf)
  ipcMain.handle('getPotplayerExtraInfo', async (_event, args) => {
    return manager.resolveExtraInfo(args, getPotplayerExtraInfo)
  })
}
