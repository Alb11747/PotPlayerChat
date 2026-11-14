import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ default: {} }))
import { findTwitchKeys, twitchKeyPaths } from './storage'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'potplayerchat-storage-'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function writeJson(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('Twitch keys', () => {
  it('looks in the bundled resources, the app data folder, then synced folders', () => {
    const home = join(dir, 'home')
    const oneDrive = join(home, 'OneDrive')
    const paths = twitchKeyPaths(home, join(dir, 'data'), {
      OneDrive: oneDrive,
      OneDriveConsumer: oneDrive
    })
    expect(paths.slice(1)).toEqual([
      join(dir, 'data', 'twitch-keys.json'),
      join(home, 'Sync', 'Config', 'PotPlayerChat', 'twitch-keys.json'),
      join(oneDrive, 'Config', 'PotPlayerChat', 'twitch-keys.json')
    ])
    expect(paths[0]).toMatch(/resources[\\/]twitch-keys\.json$/)
  })

  it('uses the first file that has a client id', async () => {
    const missing = join(dir, 'missing', 'twitch-keys.json')
    const empty = join(dir, 'empty.json')
    const synced = join(dir, 'Sync', 'twitch-keys.json')
    await writeJson(empty, '{}')
    await writeJson(synced, '{"clientId":"abc","clientSecret":"shh"}')
    await expect(findTwitchKeys([missing, empty, synced])).resolves.toEqual({
      clientId: 'abc',
      clientSecret: 'shh'
    })
  })

  it('falls back to the public client id', async () => {
    await expect(findTwitchKeys([join(dir, 'missing.json')])).resolves.toEqual({
      clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko'
    })
  })

  it('treats a configured folder that is a file as missing', async () => {
    const file = join(dir, 'OneDrive')
    await writeFile(file, '')
    await expect(findTwitchKeys([join(file, 'Config', 'twitch-keys.json')])).resolves.toEqual({
      clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko'
    })
  })

  it('logs and skips a broken keys file without printing its contents', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = join(dir, 'broken.json')
    const misspelled = join(dir, 'misspelled.json')
    const good = join(dir, 'good.json')
    await writeJson(broken, '{"clientId":"abc","clientSecret":hunter2}')
    await writeJson(misspelled, '{"clientID":"abc"}')
    await writeJson(good, '{"clientId":"def"}')
    await expect(findTwitchKeys([broken, misspelled, good])).resolves.toEqual({
      clientId: 'def',
      clientSecret: undefined
    })
    expect(error).toHaveBeenCalledWith(`Skipping Twitch keys file ${broken}: not valid JSON`)
    expect(warn).toHaveBeenCalledWith(
      `Skipping Twitch keys file ${misspelled}: it has no "clientId"`
    )
    expect(JSON.stringify([error.mock.calls, warn.mock.calls])).not.toContain('hunter2')
  })
})
