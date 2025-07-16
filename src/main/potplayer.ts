import type { HWND } from '@/types/globals'
import { RecentValue } from '@/utils/state'
import electron, { type BrowserWindow } from 'electron'
import type { PollingIntervals } from '@/types/preload'
import { isEqual } from '@/utils/objects'
import {
  getCurrentVideoTime,
  getPotPlayerInstances,
  getStreamHistory,
  getTotalVideoTime,
  type PotPlayerInstance
} from '@/core/os/potplayer'
import { getForegroundWindow } from '@/core/os/windows'

export function initPotplayerHandlers(mainWindow: BrowserWindow): void {
  const ipcMain = electron.ipcMain

  let selectedPotplayerHwnd: HWND | null = null
  const lastActivePotplayerHwnd = new RecentValue<HWND>()

  async function sendPotplayerInstancesChanged(
    potplayerInstances: { hwnd: HWND; title: string }[],
    selectedPotplayerHwnd: HWND | null
  ): Promise<void> {
    console.debug('Updating PotPlayer instances list')
    await mainWindow.webContents.send(
      'potplayerInstancesChanged',
      potplayerInstances.map((instance) => ({
        ...instance,
        selected: instance.hwnd === selectedPotplayerHwnd
      }))
    )
  }

  function getPotplayerHwnd(): HWND | null {
    return selectedPotplayerHwnd || lastActivePotplayerHwnd.getRecent()
  }

  ipcMain.handle('getPotplayerHwnd', async () => {
    return getPotplayerHwnd()
  })

  ipcMain.handle('setPotplayerHwnd', async (_event, hwnd: HWND) => {
    if (selectedPotplayerHwnd !== hwnd) {
      const lastSelected = getPotplayerHwnd()
      selectedPotplayerHwnd = hwnd
      if (lastSelected !== selectedPotplayerHwnd)
        await sendPotplayerInstancesChanged(potplayerInstances, selectedPotplayerHwnd)
    }
    await updatePotplayerInstances()
  })

  const pollingIntervals: PollingIntervals = {
    potplayerInstances: 5 * 60 * 1000,
    videoTime: 1000,
    activeWindow: 1000
  }

  ipcMain.handle('getPollingIntervals', () => pollingIntervals)
  ipcMain.handle('setPollingIntervals', (_event, args: Partial<PollingIntervals>) => {
    if (
      args.potplayerInstances &&
      args.potplayerInstances !== pollingIntervals.potplayerInstances
    ) {
      console.debug(
        `Updating pollingIntervals.potplayerInstances: ${pollingIntervals.potplayerInstances} -> ${args.potplayerInstances}`
      )
      pollingIntervals.potplayerInstances = args.potplayerInstances
      updatePotplayerInstances()
    }
    if (args.videoTime && args.videoTime !== pollingIntervals.videoTime) {
      console.debug(
        `Updating pollingIntervals.videoTime: ${pollingIntervals.videoTime} -> ${args.videoTime}`
      )
      pollingIntervals.videoTime = args.videoTime
      updateCurrentVideoTime()
    }
    if (args.activeWindow && args.activeWindow !== pollingIntervals.activeWindow) {
      console.debug(
        `Updating pollingIntervals.activeWindow: ${pollingIntervals.activeWindow} -> ${args.activeWindow}`
      )
      pollingIntervals.activeWindow = args.activeWindow
      updateActivePotplayerInstance()
    }
  })

  let potplayerInstancesDebounceTimeoutId: NodeJS.Timeout | null = null
  let potplayerInstances: PotPlayerInstance[] = []

  let potplayerIntervalId: NodeJS.Timeout | null = null
  async function updatePotplayerInstances(): Promise<void> {
    if (potplayerInstancesDebounceTimeoutId) return
    potplayerInstancesDebounceTimeoutId = setTimeout(() => {
      potplayerInstancesDebounceTimeoutId = null
    }, 50)

    const instances = await getPotPlayerInstances()
    console.debug(`Found ${instances.length} PotPlayer instance(s)`)
    if (!isEqual(potplayerInstances, instances)) {
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
    potplayerIntervalId = setTimeout(updatePotplayerInstances, pollingIntervals.potplayerInstances)
  }

  let lastCurrentTimeSend: number = 0
  let currentTimeTimeoutId: NodeJS.Timeout | null = null
  async function updateCurrentVideoTime(): Promise<void> {
    if (currentTimeTimeoutId) clearTimeout(currentTimeTimeoutId)
    const potplayerHwnd = getPotplayerHwnd()
    if (potplayerHwnd) {
      const currentTime = await getCurrentVideoTime(potplayerHwnd)
      const now = new Date().getTime()
      if (now - lastCurrentTimeSend > pollingIntervals.videoTime) {
        mainWindow.webContents.send('updateCurrentVideoTime', currentTime)
        lastCurrentTimeSend = now
      }
    }
    if (currentTimeTimeoutId) clearTimeout(currentTimeTimeoutId)
    currentTimeTimeoutId = setTimeout(updateCurrentVideoTime, pollingIntervals.videoTime)
  }

  let activePotplayerTimeoutId: NodeJS.Timeout | null = null
  async function updateActivePotplayerInstance(): Promise<void> {
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
    if (activePotplayerTimeoutId) clearTimeout(activePotplayerTimeoutId)
    activePotplayerTimeoutId = setTimeout(
      updateActivePotplayerInstance,
      pollingIntervals.activeWindow
    )
  }

  function startInterval(): void {
    if (!potplayerIntervalId) updatePotplayerInstances()
    if (!currentTimeTimeoutId) updateCurrentVideoTime()
    if (!activePotplayerTimeoutId) updateActivePotplayerInstance()
  }

  function stopInterval(): void {
    if (currentTimeTimeoutId) clearTimeout(currentTimeTimeoutId)
    currentTimeTimeoutId = null
    if (potplayerIntervalId) clearTimeout(potplayerIntervalId)
    potplayerIntervalId = null
    if (activePotplayerTimeoutId) clearTimeout(activePotplayerTimeoutId)
    activePotplayerTimeoutId = null
  }

  mainWindow.on('ready-to-show', startInterval)
  mainWindow.on('show', startInterval)
  mainWindow.on('restore', startInterval)
  mainWindow.on('hide', stopInterval)
  mainWindow.on('minimize', stopInterval)

  ipcMain.handle('getPotplayers', async () => {
    await updatePotplayerInstances()
    return potplayerInstances
  })

  ipcMain.handle('getCurrentVideoTime', async (_event, hwnd: HWND) => {
    return getCurrentVideoTime(hwnd)
  })

  ipcMain.handle('getTotalVideoTime', async (_event, hwnd: HWND) => {
    return getTotalVideoTime(hwnd)
  })

  ipcMain.handle('getStreamHistory', async () => {
    return await getStreamHistory()
  })
}
