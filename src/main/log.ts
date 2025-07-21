import { ipcMain, type BrowserWindow } from 'electron'

export function initLog(mainWindow: BrowserWindow): void {
  const consoleMap = {
    debug: console.debug,
    info: console.log,
    warn: console.warn,
    error: console.error
  }

  for (const [level, origFn] of Object.entries(consoleMap)) {
    // @ts-expect-error - console[level] is not typed
    console[level] = (...args) => {
      ipcMain.emit(level, ...args)
    }

    ipcMain.on(level, (...args) => {
      if (args.length === 0) return
      origFn(...args)
      mainWindow.webContents.send('log', { messages: args, level })
    })
  }
}
