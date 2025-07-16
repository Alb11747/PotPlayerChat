import { isDescendantWindow } from '@/utils/electron'
import type { BrowserWindow } from 'electron'
import electron from 'electron'
import contextMenuModule from 'electron-context-menu'

// Fix interop issue with contextMenu module
const contextMenu =
  '__esModule' in contextMenuModule && 'default' in contextMenuModule
    ? (contextMenuModule.default as typeof contextMenuModule)
    : contextMenuModule

function createContextMenu(mainWindow: BrowserWindow, window: BrowserWindow): void {
  contextMenu({
    window: window,
    showSaveImageAs: true,
    showCopyImage: true,
    showCopyImageAddress: true,
    showSaveImage: true,
    showCopyLink: true,
    append: async (_, parameters) => {
      if (!parameters.frame) return []

      function getTimestamp(parameters: { x: number; y: number }): string | null {
        const elements = document.elementsFromPoint(parameters.x, parameters.y)
        const chatMessages = elements.filter((element) =>
          element.classList.contains('chat-message')
        )
        return chatMessages.length === 1 ? chatMessages[0]!.getAttribute('timestamp') : null
      }

      const timestamp = (await parameters.frame.executeJavaScript(
        `(${getTimestamp.toString()})({x: ${parameters.x}, y: ${parameters.y}})`
      )) as ReturnType<typeof getTimestamp>

      if (timestamp === null) return []

      const timestampNumber = Number(timestamp)
      if (isNaN(timestampNumber)) {
        console.debug('Context menu called with invalid timestamp')
        return []
      }

      return [
        {
          label: 'Set offset to Timestamp',
          click: async () => {
            if (!mainWindow) return
            console.debug(`Setting offset to ${new Date(timestampNumber).toISOString()}`)
            await mainWindow.webContents.send('setOffset', { targetTimestamp: timestampNumber })
          }
        }
      ]
    }
  })
}

export function initContextMenus(mainWindow: BrowserWindow): void {
  createContextMenu(mainWindow, mainWindow)

  electron.app.on('browser-window-created', (_, window) => {
    if (isDescendantWindow(mainWindow, window)) createContextMenu(mainWindow, window)
  })
}
