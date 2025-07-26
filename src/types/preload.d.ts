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
  focusedMessageRaw?: string
  initialMessagesRaw?: ArrayBufferLike
  initialSearch?: string
  searchRange?: {
    startTime: number
    endTime: number
  }
}

export interface WindowApi {
  loadDataFile: <T = unknown>(subpath: string) => Promise<T | null>
  saveDataFile: <T = unknown>(subpath: string, value: T) => Promise<boolean>
  loadKeys: () => Promise<{ twitch?: { clientId: string; clientSecret?: string } }>
  getDefaultPollingIntervals: () => Promise<PollingIntervals>
  getPollingIntervals: () => Promise<PollingIntervals>
  setPollingIntervals: (args: Partial<PollingIntervals>) => Promise<void>
  getSearchInfo: () => Promise<SearchInfo | null>
  getMessagesRaw: () => Promise<ArrayBufferLike | null>
  setMessagesRaw: (messagesRaw: ArrayBufferLike) => Promise<void>
  getPotPlayers: () => Promise<PotPlayerInstance[]>
  getSelectedPotPlayerHWND: () => Promise<HWND | null>
  setSelectedPotPlayerHWND: (hwnd: HWND | null) => Promise<void>
  getCurrentVideoTime: typeof getCurrentVideoTime
  getTotalVideoTime: typeof getTotalVideoTime
  getPlaylists: typeof getPlaylists
  getStreamHistory: typeof getStreamHistory
  getPotplayerExtraInfo: typeof getPotplayerExtraInfo
  isUrlSeen: (url: string) => Promise<boolean>
  addUrlSeen: (url: string) => Promise<void>
  clearUrlSeen: () => Promise<void>
  isUrlClicked: (url: string) => Promise<boolean>
  addUrlClicked: (url: string) => Promise<void>
  clearUrlClicked: () => Promise<void>
  openUrl: (url: string) => Promise<void>
  openSearchWindow: (args: SearchInfo) => Promise<void>
  focusMessage: (messageRaw: string) => Promise<void>
  getLinkPreview: typeof getLinkPreview
  clearLinkPreviewCache: () => Promise<void>
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
  onFocusMessage: (callback: (event: Event, messageRaw: string) => void) => void
  offFocusMessage: (callback: (event: Event, messageRaw: string) => void) => void
}

export {}
