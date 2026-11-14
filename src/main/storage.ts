import AsyncLock from 'async-lock'
import electron from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'

const DATA_DIR = join(__dirname, '../../resources')

const TWITCH_KEYS_FILE = 'twitch-keys.json'
/** Twitch's own public web client id, used when no personal keys are found. */
const PUBLIC_TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export type TwitchKeys = { clientId: string; clientSecret?: string }

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
  if (!(error instanceof Error) || error instanceof StorageError) return false
  const errnoError = error as NodeJS.ErrnoException
  return (
    typeof errnoError.code === 'string' &&
    ('errno' in errnoError || typeof errnoError.syscall === 'string')
  )
}

/**
 * Loads a JSON file from the data directory by subpath.
 * Returns the parsed object or null if not found.
 * Throws `StorageError` with code `'invalid_json'` when the file contains invalid JSON.
 */
export async function loadDataFile<T = unknown>(subpath: string): Promise<T | null> {
  return readJsonFile<T>(join(DATA_DIR, subpath), subpath)
}

async function readJsonFile<T>(filePath: string, label: string): Promise<T | null> {
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    try {
      return JSON.parse(data) as T
    } catch (error) {
      throw new StorageError('invalid_json', `Invalid JSON in data file: ${label}`, error)
    }
  } catch (error) {
    if (error instanceof StorageError) throw error
    // ENOTDIR (POSIX): a folder on the path is a file. Windows reports ENOENT for that.
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
      return null
    throw new StorageError('read_failed', `Failed to read data file: ${label}`, error)
  }
}

/**
 * Files that may hold personal Twitch keys, in the order they are tried. Release builds ship
 * without keys (the installer is public), so they find them outside the install: in the app's
 * data folder, or in `Config/PotPlayerChat` of a synced folder (~/Sync or OneDrive), which lets
 * every machine and every update pick them up without setup. Local builds also bundle
 * `resources/twitch-keys.json`, which comes first so a checkout can use its own keys.
 */
export function twitchKeyPaths(home: string, userData: string, env: NodeJS.ProcessEnv): string[] {
  const syncRoots = [
    join(home, 'Sync'),
    env['OneDrive'],
    env['OneDriveConsumer'],
    env['OneDriveCommercial']
  ].filter((root): root is string => !!root)
  const paths = [
    join(DATA_DIR, TWITCH_KEYS_FILE),
    join(userData, TWITCH_KEYS_FILE),
    ...syncRoots.map((root) => join(root, 'Config', 'PotPlayerChat', TWITCH_KEYS_FILE))
  ]
  // OneDrive and OneDriveConsumer usually name the same folder.
  return [...new Set(paths)]
}

/**
 * Returns the keys from the first file in `paths` with a client id, or the public client id.
 * A file that cannot be used is logged and skipped rather than thrown: the renderer requests keys
 * once per session, so a throw (say, from a half-synced file) would disable every Twitch feature
 * until a restart. The log names the file and the problem but never its contents, because a JSON
 * parse error quotes the text around the mistake, which may be the secret.
 */
export async function findTwitchKeys(paths: string[]): Promise<TwitchKeys> {
  for (const path of paths) {
    let keys: Partial<TwitchKeys> | null
    try {
      keys = await readJsonFile<Partial<TwitchKeys>>(path, path)
    } catch (error) {
      const reason =
        error instanceof StorageError &&
        error.code === 'read_failed' &&
        isErrnoException(error.cause)
          ? error.cause.code
          : 'not valid JSON'
      console.error(`Skipping Twitch keys file ${path}: ${reason}`)
      continue
    }
    if (!keys) continue
    if (typeof keys.clientId === 'string' && keys.clientId) {
      console.info(`Using Twitch keys from ${path}`)
      return { clientId: keys.clientId, clientSecret: keys.clientSecret }
    }
    console.warn(`Skipping Twitch keys file ${path}: it has no "clientId"`)
  }
  return { clientId: PUBLIC_TWITCH_CLIENT_ID }
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
const keysCache: { twitch?: TwitchKeys } = {}

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
      keysCache.twitch ??= await findTwitchKeys(
        twitchKeyPaths(electron.app.getPath('home'), electron.app.getPath('userData'), process.env)
      )
      return keysCache
    })
  })
}
