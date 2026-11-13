import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateCheckResult } from 'electron-updater'
import type { UpdateState } from '@/types/update'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, ipcMain: {} }))
vi.mock('electron-updater', () => ({ default: {} }))
import { POLL_INTERVAL_MS, STARTUP_CHECK_DELAY_MS, UpdateController, type Updater } from './update'

// The controller reads state from events; the resolved result only needs to be non-null.
const checkResult = {} as UpdateCheckResult

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn(async (): Promise<UpdateCheckResult | null> => checkResult)
  downloadUpdate = vi.fn(async (): Promise<string[]> => [])
  quitAndInstall = vi.fn()

  /** Resolves a check with the given release, as electron-updater does: event, then promise. */
  offer(version: string | null): void {
    this.checkForUpdates.mockImplementationOnce(async () => {
      if (version) this.emit('update-available', { version })
      else this.emit('update-not-available', {})
      return checkResult
    })
  }
}

let dir: string
let updater: FakeUpdater
let published: UpdateState[]
let controller: UpdateController

function make(currentVersion = '1.0.10'): UpdateController {
  return new UpdateController(
    // Only on()'s return type differs: EventEmitter returns the fake, not an AppUpdater.
    updater as unknown as Updater,
    join(dir, 'update-install.json'),
    currentVersion,
    (state) => published.push(state),
    () => new Date('2026-11-13T12:00:00.000Z')
  )
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'potplayerchat-update-'))
  updater = new FakeUpdater()
  published = []
  controller = make()
})

afterEach(async () => {
  controller.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('update controller', () => {
  it('stays disabled until configured and refuses every action', async () => {
    expect(controller.getState().status).toBe('disabled')
    expect((await controller.check()).accepted).toBe(false)
    expect((await controller.download()).accepted).toBe(false)
    expect((await controller.install()).accepted).toBe(false)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('leaves downloading and installing to the user', async () => {
    await controller.configure()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(controller.getState().status).toBe('idle')
  })

  it('checks after the startup delay and then on every poll', async () => {
    vi.useFakeTimers()
    await controller.configure()
    controller.start()
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS - 1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('moves from available through downloading to downloaded', async () => {
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'available',
      availableVersion: '1.0.12',
      checkedAt: '2026-11-13T12:00:00.000Z'
    })

    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('download-progress', { percent: 41.7 })
      updater.emit('download-progress', { percent: 41.9 })
      updater.emit('update-downloaded', { version: '1.0.12' })
      return []
    })
    expect((await controller.download()).accepted).toBe(true)
    const percents = published
      .filter((s) => s.status === 'downloading')
      .map((s) => s.downloadPercent)
    // Fractional progress within one percent is not republished.
    expect(percents).toEqual([0, 41])
    expect(controller.getState()).toMatchObject({
      status: 'downloaded',
      downloadedVersion: '1.0.12',
      downloadPercent: 100
    })
  })

  it('reports up to date and keeps a downloaded update across later checks', async () => {
    await controller.configure()
    updater.offer(null)
    await controller.check()
    expect(controller.getState().status).toBe('up-to-date')

    updater.offer('1.0.12')
    await controller.check()
    await controller.download()
    updater.offer('1.0.12')
    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'downloaded',
      downloadedVersion: '1.0.12'
    })

    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline\nfull response'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await controller.check()
    expect(controller.getState()).toMatchObject({ status: 'downloaded', message: null })
  })

  it('a manual check offers a newer release in place of an older download', async () => {
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    await controller.download()
    updater.offer('1.0.13')
    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'available',
      availableVersion: '1.0.13',
      downloadedVersion: null
    })
  })

  it('background polls leave a finished download alone', async () => {
    vi.useFakeTimers()
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    await controller.download()
    controller.start()
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS + POLL_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(controller.getState().status).toBe('downloaded')
  })

  it('reports a failed check with the first line of its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await controller.configure()
    updater.checkForUpdates.mockImplementationOnce(async () => {
      // electron-updater emits the error and also rejects; only one report should result.
      updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED\nheaders'))
      throw new Error('net::ERR_INTERNET_DISCONNECTED\nheaders')
    })
    await controller.check()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      errorContext: 'check',
      message: 'net::ERR_INTERNET_DISCONNECTED'
    })
  })

  it('allows retrying a failed download', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('timeout'))
    await controller.download()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      errorContext: 'download',
      availableVersion: '1.0.12'
    })
    expect((await controller.download()).accepted).toBe(true)
    expect(controller.getState().status).toBe('downloaded')
  })

  it('ignores checks while a download runs', async () => {
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    let finish!: () => void
    updater.downloadUpdate.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve([])))
    )
    const download = controller.download()
    expect((await controller.check()).accepted).toBe(false)
    finish()
    await download
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('installs silently, relaunches, and records the attempt', async () => {
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    await controller.download()
    expect((await controller.install()).accepted).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(JSON.parse(await readFile(join(dir, 'update-install.json'), 'utf8'))).toEqual({
      fromVersion: '1.0.10',
      targetVersion: '1.0.12'
    })
    // The app is quitting; nothing else may start.
    expect((await controller.check()).accepted).toBe(false)
  })

  it('recovers when the installer cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await controller.configure()
    updater.offer('1.0.12')
    await controller.check()
    await controller.download()
    updater.quitAndInstall.mockImplementationOnce(() => {
      updater.emit('error', new Error('spawn EACCES'))
    })
    await controller.install()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      errorContext: 'install',
      message: 'spawn EACCES'
    })
    // Kept so the next launch can report the failure if the app quits anyway.
    await expect(readFile(join(dir, 'update-install.json'), 'utf8')).resolves.toContain('1.0.12')
    expect((await controller.install()).accepted).toBe(true)
  })

  it('reports an install from the last session that did not apply', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = join(dir, 'update-install.json')
    await writeFile(record, JSON.stringify({ fromVersion: '1.0.10', targetVersion: '1.0.12' }))
    await controller.configure()
    expect(controller.getState().notAppliedVersion).toBe('1.0.12')
    await expect(readFile(record)).rejects.toThrow()
  })

  it('forgets an install record once the update applied', async () => {
    const record = join(dir, 'update-install.json')
    await writeFile(record, JSON.stringify({ fromVersion: '1.0.10', targetVersion: '1.0.12' }))
    controller = make('1.0.12')
    await controller.configure()
    expect(controller.getState().notAppliedVersion).toBeNull()
    await expect(readFile(record)).rejects.toThrow()
  })
})
