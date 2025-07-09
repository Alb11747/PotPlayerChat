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
