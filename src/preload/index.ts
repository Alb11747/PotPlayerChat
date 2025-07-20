import type { SearchInfo, WindowApi } from '@/types/preload'
import { electronAPI } from '@electron-toolkit/preload'
import { exposeConf } from 'electron-conf/preload'
import { contextBridge, ipcRenderer } from 'electron/renderer'

exposeConf()

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
  loadDataFile: (...args) => ipcRenderer.invoke('loadDataFile', ...args),
  saveDataFile: (...args) => ipcRenderer.invoke('saveDataFile', ...args),
  loadKeys: (...args) => ipcRenderer.invoke('loadKeys', ...args),
  getDefaultPollingIntervals: (...args) =>
    ipcRenderer.invoke('getDefaultPollingIntervals', ...args),
  getPollingIntervals: (...args) => ipcRenderer.invoke('getPollingIntervals', ...args),
  setPollingIntervals: (...args) => ipcRenderer.invoke('setPollingIntervals', ...args),
  getSearchInfo: async () => await searchInfo,
  getPotPlayers: (...args) => ipcRenderer.invoke('getPotplayers', ...args),
  getSelectedPotPlayerHWND: (...args) => ipcRenderer.invoke('getPotplayerHwnd', ...args),
  setSelectedPotPlayerHWND: (...args) => ipcRenderer.invoke('setPotplayerHwnd', ...args),
  getCurrentVideoTime: (...args) => ipcRenderer.invoke('getCurrentVideoTime', ...args),
  getTotalVideoTime: (...args) => ipcRenderer.invoke('getTotalVideoTime', ...args),
  getPlaylists: (...args) => ipcRenderer.invoke('getPlaylists', ...args),
  getStreamHistory: (...args) => ipcRenderer.invoke('getStreamHistory', ...args),
  getPotplayerExtraInfo: (...args) => ipcRenderer.invoke('getPotplayerExtraInfo', ...args),
  openUrl: (...args) => ipcRenderer.invoke('openUrl', ...args),
  openSearchWindow: (...args) => ipcRenderer.invoke('openSearchWindow', ...args),
  getLinkPreview: (...args) => ipcRenderer.invoke('getLinkPreview', ...args),
  sanitizeHtml: (...args) => ipcRenderer.invoke('sanitizeHtml', ...args),
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
