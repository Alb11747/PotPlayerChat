import type { TwitchMessage } from '@core/chat/twitch-msg'
import type { PotPlayerInstance } from '@/main/potplayer'
import type { HWND } from '@/types/globals'
import { IpcRenderer } from 'electron/renderer'

declare global {
  interface Window {
    electron: {
      ipcRenderer: IpcRenderer
    }
    api: WindowApi
  }
}

export interface WindowApi {
  loadDataFile: <T = unknown>(subpath: string) => Promise<T | null>
  saveDataFile: <T = unknown>(subpath: string, value: T) => Promise<boolean>
  loadKeys: () => Promise<{ twitch?: { clientId: string; clientSecret: string } }>
  getPreloadedMessages: () => Promise<TwitchMessage[] | null>
  getPotPlayers: () => Promise<PotPlayerInstance[]>
  getSelectedPotPlayerHWND: () => Promise<HWND | null>
  setSelectedPotPlayerHWND: (hwnd: HWND | null) => Promise<void>
  getCurrentTime: (hwnd: HWND) => Promise<number>
  getTotalTime: (hwnd: HWND) => Promise<number>
  getStreamHistory: () => Promise<({ url: string; title: string } | null)[]>
  openUrl: (url: string) => Promise<void>
  openSearchWindow: (messages?: TwitchMessage[]) => Promise<void>
  getLinkPreview: (
    url: string
  ) => Promise<{ status: number; thumbnail?: string; tooltip?: string; link: string } | null>
  onSetCurrentTime: (callback: (event: Event, time: number) => void) => void
  offSetCurrentTime: (callback: (event: Event, time: number) => void) => void
  onPotPlayerInstancesChanged: (
    callback: (event: Event, instances: { hwnd: HWND; title: string; selected?: boolean }[]) => void
  ) => void
  offPotPlayerInstancesChanged: (
    callback: (event: Event, instances: { hwnd: HWND; title: string; selected?: boolean }[]) => void
  ) => void
}

export {}
