import { electronAPI } from '@electron-toolkit/preload'
import { exposeConf } from 'electron-conf/preload'
import { contextBridge, ipcRenderer } from 'electron/renderer'
import type { WindowApi } from './types'

exposeConf()

// Custom APIs for renderer
const api: WindowApi = {
  loadDataFile: (subpath: string) => ipcRenderer.invoke('load-data-file', subpath),
  saveDataFile: (subpath: string, value: unknown) =>
    ipcRenderer.invoke('save-data-file', subpath, value),
  loadKeys: () => ipcRenderer.invoke('load-keys'),
  getPotPlayers: () => ipcRenderer.invoke('get-potplayers'),
  getSelectedPotPlayerHWND: () => ipcRenderer.invoke('get-potplayer-hwnd'),
  setSelectedPotPlayerHWND: (hwnd) => ipcRenderer.invoke('set-potplayer-hwnd', hwnd),
  getCurrentTime: (hwnd) => ipcRenderer.invoke('get-current-time', hwnd),
  getTotalTime: (hwnd) => ipcRenderer.invoke('get-total-time', hwnd),
  getStreamHistory: () => ipcRenderer.invoke('get-stream-history'),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  openSearchWindow: () => ipcRenderer.invoke('open-search-window'),
  getLinkPreview: (url: string) => ipcRenderer.invoke('get-link-preview', url),
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
  window.api = api
  window.Buffer = Buffer
}
