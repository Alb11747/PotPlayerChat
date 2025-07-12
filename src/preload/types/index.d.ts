import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { PotPlayerInstance } from '@/main/potplayer'
import type { HWND } from '@/types/globals'
import type { TwitchMessage } from '@core/chat/twitch-msg'
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
  getSearchInfo: () => Promise<{
    potplayerInfo: PotPlayerInfo
    messages: TwitchMessage[]
  } | null>
  getPotPlayers: () => Promise<PotPlayerInstance[]>
  getSelectedPotPlayerHWND: () => Promise<HWND | null>
  setSelectedPotPlayerHWND: (hwnd: HWND | null) => Promise<void>
  getCurrentVideoTime: (hwnd: HWND) => Promise<number>
  getTotalVideoTime: (hwnd: HWND) => Promise<number>
  getStreamHistory: () => Promise<({ url: string; title: string } | null)[]>
  openUrl: (url: string) => Promise<void>
  openSearchWindow: (potplayerInfo: PotPlayerInfo, messages?: TwitchMessage[]) => Promise<void>
  getLinkPreview: (
    url: string
  ) => Promise<{ status: number; thumbnail?: string; tooltip?: string; link: string } | null>
  onSetCurrentTime: (callback: (event: Event, time: number) => void) => void
  offSetCurrentTime: (callback: (event: Event, time: number) => void) => void
  onPotPlayerInstancesChanged: (
    callback: (event: Event, instances: (PotPlayerInstance & { selected?: boolean })[]) => void
  ) => void
  offPotPlayerInstancesChanged: (
    callback: (event: Event, instances: (PotPlayerInstance & { selected?: boolean })[]) => void
  ) => void
}

export {}
