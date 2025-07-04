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
  getPotPlayers: () => Promise<{ hwnd: HWND; title: string }[]>
  getSelectedPotPlayer: () => Promise<HWND | null>
  setSelectedPotPlayer: (hwnd: HWND | null) => Promise<void>
  getCurrentTime: (hwnd: HWND) => Promise<number>
  getTotalTime: (hwnd: HWND) => Promise<number>
  getStreamHistory: () => Promise<({ url: string; title: string } | null)[]>
  openUrl: (url: string) => Promise<void>
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
