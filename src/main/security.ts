import { isDescendantWindow } from '@/utils/electron'
import electron, { type BrowserWindow } from 'electron'

export const headerOverrides = {
  'Access-Control-Allow-Origin': ['*']
} as Record<string, string[]>

function setAccessControlHeaders(window: BrowserWindow): void {
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details
    if (!responseHeaders) {
      callback({})
      return
    }

    const newHeaders: Map<string, [string, string[]]> = new Map()
    for (const [key, value] of Object.entries(headerOverrides)) {
      newHeaders.set(key.toLowerCase(), [key, value])
    }

    for (const header of Object.keys(responseHeaders)) {
      const headerData = newHeaders.get(header.toLowerCase())
      if (headerData) {
        const [, value] = headerData
        responseHeaders[header] = value
        newHeaders.delete(header.toLowerCase())
      }
    }

    for (const [, [key, value]] of newHeaders) {
      responseHeaders[key] = value
    }

    callback({
      responseHeaders
    })
  })
}

export function initSecurity(mainWindow: BrowserWindow): void {
  setAccessControlHeaders(mainWindow)

  electron.app.on('browser-window-created', (_, window) => {
    if (isDescendantWindow(mainWindow, window)) setAccessControlHeaders(window)
  })
}
