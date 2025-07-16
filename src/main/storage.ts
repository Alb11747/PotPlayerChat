import AsyncLock from 'async-lock'
import electron from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const DATA_DIR = join(__dirname, '../../resources')

/**
 * Loads a JSON file from the data directory by subpath.
 * Returns the parsed object or null if not found or invalid.
 */
export async function loadDataFile<T = unknown>(subpath: string): Promise<T | null> {
  try {
    const filePath = join(DATA_DIR, subpath)
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

/**
 * Saves a JSON-serializable object to a file in the data directory by subpath.
 */
export async function saveDataFile<T = unknown>(subpath: string, value: T): Promise<void> {
  const filePath = join(DATA_DIR, subpath)
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

const lock = new AsyncLock()
const keysCache: { twitch?: { clientId: string; clientSecret: string } | null } = {}

export function initStorage(): void {
  const ipcMain = electron.ipcMain

  ipcMain.handle('loadDataFile', async (_event, subpath: string) => {
    return await loadDataFile(subpath)
  })

  ipcMain.handle('saveDataFile', async (_event, subpath: string, value: unknown) => {
    await saveDataFile(subpath, value)
    return true
  })

  ipcMain.handle('loadKeys', async () => {
    return await lock.acquire('keysCache', async () => {
      if (keysCache.twitch === undefined) {
        const twitchKeys = (await loadDataFile<{ clientId: string; clientSecret: string }>(
          'twitch-keys.json'
        )) || {
          clientId: '',
          clientSecret: ''
        }
        if (twitchKeys.clientId) keysCache.twitch = twitchKeys
        else keysCache.twitch = null
      }
      return keysCache
    })
  })
}
