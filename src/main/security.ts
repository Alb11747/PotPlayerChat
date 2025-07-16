import { isDescendantWindow } from '@/utils/electron'
import electron, { type BrowserWindow } from 'electron'

function setAccessControlHeaders(window: BrowserWindow): void {
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details
    if (responseHeaders) {
      for (const header of Object.keys(responseHeaders)) {
        if (header.toLowerCase() === 'access-control-allow-origin') delete responseHeaders[header]
      }
      // Add custom headers
      responseHeaders['Access-Control-Allow-Origin'] = ['*']
      callback({
        responseHeaders
      })
    } else {
      callback({})
    }
  })
}

export function initSecurity(mainWindow: BrowserWindow): void {
  setAccessControlHeaders(mainWindow)

  electron.app.on('browser-window-created', (_, window) => {
    if (isDescendantWindow(mainWindow, window)) setAccessControlHeaders(window)
  })
}
