import regedit from 'regedit'
import { getWindowsByExe, sendMessage } from './windows'

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

export function getCurrentTime(hwnd: HWND): Promise<number> {
  return sendMessage(hwnd, WinMsgs.REQUEST_TYPE, PotPlayerWParams.GET_CURRENT_TIME, 0)
}

export function getTotalTime(hwnd: HWND): Promise<number> {
  return sendMessage(hwnd, WinMsgs.REQUEST_TYPE, PotPlayerWParams.GET_TOTAL_TIME, 0)
}

export async function getPotPlayerInstances(): Promise<{ pid: number; title: string }[]> {
  const hwnds: { pid: number; title: string }[] = []
  const potPlayerWindows = await getWindowsByExe('PotPlayerMini64.exe')
  for (const window of potPlayerWindows) {
    if (window.imageName === 'PotPlayerMini64.exe') {
      hwnds.push({ pid: window.pid, title: window.windowTitle })
    }
  }
  return hwnds
}

export enum PlayStatus {
  Stopped = 'Stopped',
  Paused = 'Paused',
  Running = 'Running',
  Undefined = 'Undefined'
}

export async function getPlayStatus(hwnd: HWND): Promise<PlayStatus> {
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

regedit.setExternalVBSLocation('resources/regedit/vbs')

export async function getStreamsHistory(): Promise<({ url: string; title: string } | null)[]> {
  const key = 'HKCU\\Software\\DAUM\\PotPlayerMini64\\UrlHistory'

  console.debug('Reading PotPlayer URL history from registry:', key)
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
}
