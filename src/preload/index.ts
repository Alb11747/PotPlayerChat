import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron/renderer'
import type { WindowApi } from './types'

// Custom APIs for renderer
const api: WindowApi = {
  getPotPlayers: () => ipcRenderer.invoke('get-potplayers'),
  getSelectedPotPlayer: () => ipcRenderer.invoke('get-potplayer-hwnd'),
  setSelectedPotPlayer: (hwnd) => ipcRenderer.invoke('set-potplayer-hwnd', hwnd),
  getCurrentTime: (hwnd) => ipcRenderer.invoke('get-current-time', hwnd),
  getTotalTime: (hwnd) => ipcRenderer.invoke('get-total-time', hwnd),
  getStreamHistory: () => ipcRenderer.invoke('get-stream-history'),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  onSetCurrentTime: (callback) => ipcRenderer.on('set-current-time', callback as never),
  offSetCurrentTime: (callback) => ipcRenderer.off('set-current-time', callback as never),
  onPotPlayerInstancesChanged: (callback) => {
    ipcRenderer.on('potplayer-instances-changed', callback as never)
  },
  offPotPlayerInstancesChanged: (callback) => {
    ipcRenderer.off('potplayer-instances-changed', callback as never)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('Buffer', Buffer)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.Buffer = Buffer
}
