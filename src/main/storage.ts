import AsyncLock from 'async-lock'
import electron from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'

const DATA_DIR = join(__dirname, '../../resources')

type StorageErrorCode = 'invalid_json' | 'read_failed' | 'write_failed'

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * Loads a JSON file from the data directory by subpath.
 * Returns the parsed object or null if not found or invalid.
 */
export async function loadDataFile<T = unknown>(subpath: string): Promise<T | null> {
  const filePath = join(DATA_DIR, subpath)
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    try {
      return JSON.parse(data) as T
    } catch (error) {
      throw new StorageError('invalid_json', `Invalid JSON in data file: ${subpath}`, error)
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw new StorageError('read_failed', `Failed to read data file: ${subpath}`, error)
  }
}

/**
 * Saves a JSON-serializable object to a file in the data directory by subpath.
 */
export async function saveDataFile<T = unknown>(subpath: string, value: T): Promise<void> {
  try {
    const filePath = join(DATA_DIR, subpath)
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
  } catch (error) {
    throw new StorageError('write_failed', `Failed to write data file: ${subpath}`, error)
  }
}

const lock = new AsyncLock()
const keysCache: { twitch?: { clientId: string; clientSecret?: string } | null } = {}

export function initStorage(): void {
  const ipcMain = electron.ipcMain

  ipcMain.handle('loadDataFile', async (_event, subpath: string) => {
    try {
      return await loadDataFile(subpath)
    } catch (error) {
      console.error('loadDataFile failed:', error)
      throw error
    }
  })

  ipcMain.handle('saveDataFile', async (_event, subpath: string, value: unknown) => {
    try {
      await saveDataFile(subpath, value)
    } catch (error) {
      console.error('saveDataFile failed:', error)
      throw error
    }
    return true
  })

  ipcMain.handle('loadKeys', async () => {
    const twitchClientId = process.env['TWITCH_CLIENT_ID']
    const twitchClientSecret = process.env['TWITCH_CLIENT_SECRET']
    if (twitchClientId) {
      keysCache.twitch = {
        clientId: twitchClientId,
        clientSecret: twitchClientSecret
      }
      return keysCache
    }

    return await lock.acquire('keysCache', async () => {
      if (keysCache.twitch === undefined) {
        const twitchKeys = await loadDataFile<{ clientId?: string; clientSecret?: string }>(
          'twitch-keys.json'
        )
        if (twitchKeys?.clientId)
          keysCache.twitch = {
            clientId: twitchKeys.clientId,
            clientSecret: twitchKeys.clientSecret
          }
        else
          keysCache.twitch = {
            clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko'
          }
      }
      return keysCache
    })
  })
}
