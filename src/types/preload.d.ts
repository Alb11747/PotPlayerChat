import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type {
  getCurrentVideoTime,
  getPlaylists,
  getStreamHistory,
  getTotalVideoTime
} from '@/core/os/potplayer'
import type { getPotplayerExtraInfo } from '@/core/potplayer/potplayer'
import type { getLinkPreview } from '@/main/links'
import type { HWND } from '@/types/globals'
import type { PotPlayerInstance } from '@/types/potplayer'
import { IpcRenderer } from 'electron/renderer'
import type sanitizeHtml from 'sanitize-html'

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

export type SearchInfo = {
  potplayerInfo: PotPlayerInfo
  messagesRaw?: string
  initialMessagesRaw?: string
  initialSearch?: string
  searchRange?: {
    startTime: number
    endTime: number
  }
}

export interface WindowApi {
  loadDataFile: <T = unknown>(subpath: string) => Promise<T | null>
  saveDataFile: <T = unknown>(subpath: string, value: T) => Promise<boolean>
  loadKeys: () => Promise<{ twitch?: { clientId: string; clientSecret: string } }>
  getDefaultPollingIntervals: () => Promise<PollingIntervals>
  getPollingIntervals: () => Promise<PollingIntervals>
  setPollingIntervals: (args: Partial<PollingIntervals>) => Promise<void>
  getSearchInfo: () => Promise<SearchInfo | null>
  getPotPlayers: () => Promise<PotPlayerInstance[]>
  getSelectedPotPlayerHWND: () => Promise<HWND | null>
  setSelectedPotPlayerHWND: (hwnd: HWND | null) => Promise<void>
  getCurrentVideoTime: typeof getCurrentVideoTime
  getTotalVideoTime: typeof getTotalVideoTime
  getPlaylists: typeof getPlaylists
  getStreamHistory: typeof getStreamHistory
  getPotplayerExtraInfo: typeof getPotplayerExtraInfo
  openUrl: (url: string) => Promise<void>
  openSearchWindow: (args: SearchInfo) => Promise<void>
  getLinkPreview: typeof getLinkPreview
  sanitizeHtml: (
    ...args: Parameters<typeof sanitizeHtml>
  ) => Promise<ReturnType<typeof sanitizeHtml>>
  onSetOffset: (callback: (event: Event, args: { targetTimestamp: number }) => void) => void
  offSetOffset: (callback: (event: Event, args: { targetTimestamp: number }) => void) => void
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
