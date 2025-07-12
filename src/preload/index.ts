import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@core/chat/twitch-msg'
import { electronAPI } from '@electron-toolkit/preload'
import { exposeConf } from 'electron-conf/preload'
import { contextBridge, ipcRenderer } from 'electron/renderer'
import type { WindowApi } from './types'

exposeConf()

const searchInfo: Promise<{
  potplayerInfo: PotPlayerInfo
  messages: TwitchMessage[]
} | null> = new Promise((resolve) => {
  setTimeout(() => resolve(null), 1000) // Fallback to null after 1 second
  ipcRenderer.on(
    'searchInfo',
    (_event, potplayerInfo: PotPlayerInfo, messages: TwitchMessage[]) => {
      resolve({ potplayerInfo, messages })
    }
  )
})

// Custom APIs for renderer
const api: WindowApi = {
  loadDataFile: (subpath: string) => ipcRenderer.invoke('loadDataFile', subpath),
  saveDataFile: (subpath: string, value: unknown) =>
    ipcRenderer.invoke('saveDataFile', subpath, value),
  loadKeys: () => ipcRenderer.invoke('loadKeys'),
  getSearchInfo: () => searchInfo,
  getPotPlayers: () => ipcRenderer.invoke('getPotplayers'),
  getSelectedPotPlayerHWND: () => ipcRenderer.invoke('getPotplayerHwnd'),
  setSelectedPotPlayerHWND: (hwnd) => ipcRenderer.invoke('setPotplayerHwnd', hwnd),
  getCurrentVideoTime: (hwnd) => ipcRenderer.invoke('getCurrentTime', hwnd),
  getTotalVideoTime: (hwnd) => ipcRenderer.invoke('getTotalTime', hwnd),
  getStreamHistory: () => ipcRenderer.invoke('getStreamHistory'),
  openUrl: (url: string) => ipcRenderer.invoke('openUrl', url),
  openSearchWindow: (potplayerInfo: PotPlayerInfo, messages?: TwitchMessage[]) =>
    ipcRenderer.invoke('openSearchWindow', potplayerInfo, messages),
  getLinkPreview: (url: string) => ipcRenderer.invoke('getLinkPreview', url),
  onSetCurrentTime: (callback) => ipcRenderer.on('setCurrentTime', callback as never),
  offSetCurrentTime: (callback) => ipcRenderer.off('setCurrentTime', callback as never),
  onPotPlayerInstancesChanged: (callback) => {
    ipcRenderer.on('potplayerInstancesChanged', callback as never)
  },
  offPotPlayerInstancesChanged: (callback) => {
    ipcRenderer.off('potplayerInstancesChanged', callback as never)
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
