import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { WindowApi } from '@/types/preload'
import type { TwitchMessage } from '@core/chat/twitch-msg'
import { electronAPI } from '@electron-toolkit/preload'
import { exposeConf } from 'electron-conf/preload'
import { contextBridge, ipcRenderer } from 'electron/renderer'

exposeConf()

type SearchInfo = {
  potplayerInfo: PotPlayerInfo
  messages?: TwitchMessage[]
  initialSearch?: string
}

let searchInfo: Promise<SearchInfo | null> | SearchInfo = new Promise((resolve) => {
  ipcRenderer.once('searchInfo', (_event, info: SearchInfo) => {
    console.debug('Preloaded search info:', info)
    resolve(info)
    ipcRenderer.on('searchInfo', (_event, info: SearchInfo) => {
      console.debug('Updated search info:', info)
      searchInfo = info
    })
  })
})

// Custom APIs for renderer
const api: WindowApi = {
  loadDataFile: (subpath: string) => ipcRenderer.invoke('loadDataFile', subpath),
  saveDataFile: (subpath: string, value: unknown) =>
    ipcRenderer.invoke('saveDataFile', subpath, value),
  loadKeys: () => ipcRenderer.invoke('loadKeys'),
  getPollingIntervals: () => ipcRenderer.invoke('getPollingIntervals'),
  setPollingIntervals: (args) => ipcRenderer.invoke('setPollingIntervals', args),
  getSearchInfo: async () => await searchInfo,
  getPotPlayers: () => ipcRenderer.invoke('getPotplayers'),
  getSelectedPotPlayerHWND: () => ipcRenderer.invoke('getPotplayerHwnd'),
  setSelectedPotPlayerHWND: (hwnd) => ipcRenderer.invoke('setPotplayerHwnd', hwnd),
  getCurrentVideoTime: (hwnd) => ipcRenderer.invoke('getCurrentVideoTime', hwnd),
  getTotalVideoTime: (hwnd) => ipcRenderer.invoke('getTotalVideoTime', hwnd),
  getStreamHistory: () => ipcRenderer.invoke('getStreamHistory'),
  openUrl: (url: string) => ipcRenderer.invoke('openUrl', url),
  openSearchWindow: (args) => ipcRenderer.invoke('openSearchWindow', args),
  getLinkPreview: (...args: unknown[]) => ipcRenderer.invoke('getLinkPreview', ...args),
  sanitizeHtml: (html: string) => ipcRenderer.invoke('sanitizeHtml', html),
  onSetOffset: (callback) => ipcRenderer.on('setOffset', callback as never),
  offSetOffset: (callback) => ipcRenderer.off('setOffset', callback as never),
  onSetCurrentTime: (callback) => ipcRenderer.on('updateCurrentVideoTime', callback as never),
  offSetCurrentTime: (callback) => ipcRenderer.off('updateCurrentVideoTime', callback as never),
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
