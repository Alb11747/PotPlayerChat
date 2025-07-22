import type { HWND } from '@/types/globals'
import type { PotPlayerInstance } from '@/types/potplayer'
import { logTime } from '@/utils/debug'
import { removeSuffix } from '@/utils/strings'
import AsyncLock from 'async-lock'
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import regedit from 'regedit'
import {
  getHwndByPidAndTitle,
  getWindowsByExe,
  getWindowText,
  sendMessage
} from '@/core/os/windows'

const lock = new AsyncLock()

export enum WinMsgs {
  COMMAND_TYPE = 273,
  REQUEST_TYPE = 1024
}

export enum PotPlayerWParams {
  GET_VOLUME = 20480,
  SET_VOLUME = 20481,
  GET_TOTAL_TIME = 20482,
  GET_PROGRESS_TIME = 20483,
  GET_CURRENT_TIME = 20484,
  SET_CURRENT_TIME = 20485,
  GET_PLAY_STATUS = 20486,
  SEND_VIRTUAL_KEY = 20496
}

/**
 * Gets the current video time in milliseconds
 * @param hwnd The HWND of the PotPlayer window
 * @returns The current video time in milliseconds
 */
export function getCurrentVideoTime(hwnd: HWND): Promise<number> {
  return sendMessage(hwnd, WinMsgs.REQUEST_TYPE, PotPlayerWParams.GET_CURRENT_TIME, 0)
}

/**
 * Gets the total video time in milliseconds
 * @param hwnd The HWND of the PotPlayer window
 * @returns The total video time in milliseconds
 */
export function getTotalVideoTime(hwnd: HWND): Promise<number> {
  return sendMessage(hwnd, WinMsgs.REQUEST_TYPE, PotPlayerWParams.GET_TOTAL_TIME, 0)
}

export async function getPotPlayerInstances(): Promise<PotPlayerInstance[]> {
  return lock.acquire('potplayer-instances', async () => {
    const hwnds: PotPlayerInstance[] = []
    const potPlayerWindows = await getWindowsByExe('PotPlayerMini64.exe', true)
    for (const window of potPlayerWindows) {
      if (window.imageName !== 'PotPlayerMini64.exe' && window.sessionName == 'Console') continue
      const { hwnd = null } = (await getHwndByPidAndTitle(window.pid, window.windowTitle)) ?? {}
      if (hwnd === null) {
        console.warn(`No HWND found for PID ${window.pid} with title "${window.windowTitle}"`)
        continue
      }
      hwnds.push({
        pid: window.pid,
        hwnd,
        title: removeSuffix(await getWindowText(hwnd, true), ' - PotPlayer')
      })
    }
    return hwnds
  })
}

export enum PlayStatus {
  Stopped = 'Stopped',
  Paused = 'Paused',
  Running = 'Running',
  Undefined = 'Undefined'
}

export async function getVideoPlayStatus(hwnd: HWND): Promise<PlayStatus> {
  const i = await sendMessage(hwnd, WinMsgs.REQUEST_TYPE, PotPlayerWParams.GET_PLAY_STATUS, 0)
  switch (i) {
    case -1:
      return PlayStatus.Stopped
    case 1:
      return PlayStatus.Paused
    case 2:
      return PlayStatus.Running
    default:
      return PlayStatus.Undefined
  }
}

/**
 * Reads the files in %APPDATA%\PotPlayerMini64\Playlist\*.dpl
 * @returns A list of playlists with their name and URL
 */
export async function getPlaylists(): Promise<{ name: string; url: string }[]> {
  const appData = process.env['APPDATA']
  if (!appData) {
    console.error('APPDATA is not set')
    return []
  }
  const files = await readdir(path.join(appData, 'PotPlayerMini64', 'Playlist'), {
    withFileTypes: true
  })
  const playlistFiles = files.filter((file) => file.isFile() && file.name.endsWith('.dpl'))
  const playlists: Awaited<ReturnType<typeof getPlaylists>> = []
  for (const playlistFile of playlistFiles) {
    const playlistName = removeSuffix(playlistFile.name, '.dpl')
    const playlistPath = path.join(playlistFile.parentPath, playlistFile.name)
    const playlistRaw = await readFile(playlistPath)
    const lines = playlistRaw.toString().split('\n')

    if (lines[0]?.trim() !== 'DAUMPLAYLIST')
      console.warn(`Playlist ${playlistPath} is not a valid playlist file`)

    for (const line of lines) {
      const [key, value] = line.split('=', 2)
      if (value === undefined) continue
      if (key === 'playname') {
        if (value) playlists.push({ name: playlistName, url: value })
        else console.warn(`Playlist ${playlistPath} has no 'playname'`)
      }
    }
  }
  return playlists
}

regedit.setExternalVBSLocation('resources/regedit/vbs')

/**
 * Reads the URL history from the registry
 * @returns A list of URLs with their title
 */
export async function getStreamHistory(): Promise<({ url: string; title: string } | null)[]> {
  const key = 'HKCU\\Software\\DAUM\\PotPlayerMini64\\UrlHistory'

  return lock.acquire('potplayer-url-history', async () => {
    return await logTime(`Reading PotPlayer URL history from registry: ${key}`, async () => {
      const result = await regedit.promisified.list([key])
      const entry = result[key]
      if (!entry || !entry.exists || !entry.values) return []

      const values = entry.values
      const numericKeys = Object.keys(values)
        .filter((k) => /^\d+$/.test(k))
        .map(Number)
      if (numericKeys.length === 0) return []

      const maxKey = Math.max(...numericKeys)
      const arr: ({ url: string; title: string } | null)[] = []
      for (let i = 0; i <= maxKey; i++) {
        const urlValue = values[i]?.value
        const titleValue = values[`${i}_t`]?.value
        if (urlValue === undefined && titleValue === undefined) {
          arr.push(null)
        } else {
          arr.push({
            url: urlValue ? String(urlValue) : '',
            title: titleValue ? String(titleValue) : ''
          })
        }
      }
      return arr
    })
  })
}
