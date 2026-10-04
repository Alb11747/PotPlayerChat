import { ipcMain, type BrowserWindow } from 'electron'

export function initLog(mainWindow: BrowserWindow): void {
  const consoleMap = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
  }

  const webContents = mainWindow.webContents
  const disposers: (() => void)[] = []
  let disposed = false

  for (const level of Object.keys(consoleMap) as (keyof typeof consoleMap)[]) {
    const origFn = consoleMap[level]
    const log = (...args: unknown[]): void => {
      origFn(...args)
      if (!disposed && !mainWindow.isDestroyed() && !webContents.isDestroyed()) {
        webContents.send('log', { messages: args, level })
      }
    }

    console[level] = log
    ipcMain.on(level, log)
    disposers.push(() => {
      if (console[level] === log) console[level] = origFn
      ipcMain.removeListener(level, log)
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const cleanup of disposers) cleanup()
    mainWindow.removeListener('closed', dispose)
    webContents.removeListener('destroyed', dispose)
  }

  mainWindow.once('closed', dispose)
  webContents.once('destroyed', dispose)
}
