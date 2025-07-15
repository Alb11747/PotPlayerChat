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

export type PollingIntervals = {
  potplayerInstances: number
  videoTime: number
  activeWindow: number
}

export interface WindowApi {
  loadDataFile: <T = unknown>(subpath: string) => Promise<T | null>
  saveDataFile: <T = unknown>(subpath: string, value: T) => Promise<boolean>
  loadKeys: () => Promise<{ twitch?: { clientId: string; clientSecret: string } }>
  getPollingIntervals: () => Promise<PollingIntervals>
  setPollingIntervals: (args: Partial<PollingIntervals>) => Promise<void>
  getSearchInfo: () => Promise<{
    potplayerInfo: PotPlayerInfo
    messages?: TwitchMessage[]
  } | null>
  getPotPlayers: () => Promise<PotPlayerInstance[]>
  getSelectedPotPlayerHWND: () => Promise<HWND | null>
  setSelectedPotPlayerHWND: (hwnd: HWND | null) => Promise<void>
  getCurrentVideoTime: (hwnd: HWND) => Promise<number>
  getTotalVideoTime: (hwnd: HWND) => Promise<number>
  getStreamHistory: () => Promise<({ url: string; title: string } | null)[]>
  openUrl: (url: string) => Promise<void>
  openSearchWindow: ({
    potplayerInfo,
    messages,
    initialSearch
  }: {
    potplayerInfo: PotPlayerInfo
    messages?: TwitchMessage[]
    initialSearch?: string
  }) => Promise<void>
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
