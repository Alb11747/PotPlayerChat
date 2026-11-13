// In-app updates, modelled on T3 Code's desktop updater: check in the background, offer the
// update in the toolbar, download it on request, and install it only when the user restarts.
// Nothing downloads or installs on its own, so a session is never interrupted mid-stream.
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { UpdateActionResult, UpdateState } from '@/types/update'

export const STARTUP_CHECK_DELAY_MS = 15_000
export const POLL_INTERVAL_MS = 4 * 60_000
const INSTALL_RECORD_FILE = 'update-install.json'

/** The part of electron-updater's AppUpdater that the controller uses. */
export type Updater = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
  | 'on'
>

interface InstallRecord {
  fromVersion: string
  targetVersion: string
}

export function createInitialUpdateState(currentVersion: string): UpdateState {
  return {
    status: 'disabled',
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    notAppliedVersion: null
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // electron-updater appends whole HTTP responses to its messages; the first line is enough.
  return message.split('\n')[0]!.trim() || 'Unknown error'
}

export class UpdateController {
  private state: UpdateState
  /** One updater operation at a time: electron-updater's state is shared across them. */
  private action: 'check' | 'download' | 'install' | null = null
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(
    private readonly updater: Updater,
    private readonly installRecordPath: string,
    currentVersion: string,
    private readonly publish: (state: UpdateState) => void,
    private readonly now: () => Date = () => new Date()
  ) {
    this.state = createInitialUpdateState(currentVersion)
  }

  getState(): UpdateState {
    return this.state
  }

  /** Enables updates for this build and reports an install from the last session that did not apply. */
  async configure(): Promise<void> {
    const { updater } = this
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.on('update-available', (info) => this.onAvailable(info.version))
    updater.on('update-not-available', () => this.onNotAvailable())
    updater.on('download-progress', (progress) => this.onProgress(progress.percent))
    updater.on('update-downloaded', (info) => this.onDownloaded(info.version))
    updater.on('error', (error) => this.onError(error))
    const notAppliedVersion = await this.takeNotAppliedVersion()
    if (notAppliedVersion) {
      console.warn(`Update ${notAppliedVersion} did not apply; still running ${this.version}.`)
    }
    this.set({ ...this.state, status: 'idle', notAppliedVersion })
  }

  start(): void {
    this.timers.push(
      setTimeout(() => void this.check('background'), STARTUP_CHECK_DELAY_MS),
      setInterval(() => void this.check('background'), POLL_INTERVAL_MS)
    )
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  async check(reason: 'background' | 'manual' = 'manual'): Promise<UpdateActionResult> {
    if (this.state.status === 'disabled' || this.action) return this.result(false)
    // Every push to main is a release, so a background check would often replace a finished
    // download with a newer one to download again. Install what is ready; a manual check or the
    // next launch finds anything newer.
    if (reason === 'background' && this.state.status === 'downloaded') return this.result(false)
    this.action = 'check'
    const previous = this.state
    const hasDownload = previous.downloadedVersion !== null
    this.set({
      ...previous,
      status: 'checking',
      checkedAt: this.now().toISOString(),
      downloadPercent: hasDownload ? 100 : null,
      message: null,
      errorContext: null
    })
    try {
      // The available/not-available events update the state before this resolves.
      const result = await this.updater.checkForUpdates()
      if (result === null && this.state.status === 'checking') this.set(previous)
    } catch (error) {
      console.error('Update check failed:', error)
      // A failed check must not hide an update that is already downloaded.
      this.set(
        hasDownload
          ? { ...this.state, status: 'downloaded', downloadPercent: 100 }
          : {
              ...this.state,
              status: 'error',
              downloadPercent: null,
              message: describeError(error),
              errorContext: 'check'
            }
      )
    } finally {
      this.action = null
    }
    return this.result(true)
  }

  async download(): Promise<UpdateActionResult> {
    const state = this.state
    const canDownload =
      state.availableVersion !== null &&
      (state.status === 'available' ||
        (state.status === 'error' && state.errorContext === 'download'))
    if (!canDownload || this.action) return this.result(false)
    this.action = 'download'
    this.set({
      ...state,
      status: 'downloading',
      downloadPercent: 0,
      message: null,
      errorContext: null
    })
    try {
      await this.updater.downloadUpdate()
      // update-downloaded normally arrives first; never leave the button stuck on "downloading".
      if (this.state.status === 'downloading') this.onDownloaded(state.availableVersion!)
    } catch (error) {
      console.error('Update download failed:', error)
      this.set({
        ...this.state,
        status: 'error',
        downloadPercent: null,
        message: describeError(error),
        errorContext: 'download'
      })
    } finally {
      this.action = null
    }
    return this.result(true)
  }

  async install(): Promise<UpdateActionResult> {
    const state = this.state
    const canInstall =
      state.downloadedVersion !== null &&
      (state.status === 'downloaded' ||
        (state.status === 'error' && state.errorContext === 'install'))
    if (!canInstall || this.action) return this.result(false)
    this.action = 'install'
    this.set({ ...state, status: 'downloaded', message: null, errorContext: null })
    await this.writeInstallRecord(state.downloadedVersion!)
    // electron-updater reports a missing download through its error event during this call. A
    // failure to spawn the installer arrives later, possibly while the app is already quitting;
    // the install record then reports on the next launch that the update did not apply.
    try {
      // Silent install, then relaunch; build/installer.nsh keeps the app's elevation.
      this.updater.quitAndInstall(true, true)
    } catch (error) {
      this.failInstall(describeError(error))
    }
    return this.result(true)
  }

  private get version(): string {
    return this.state.currentVersion
  }

  private result(accepted: boolean): UpdateActionResult {
    return { accepted, state: this.state }
  }

  private set(state: UpdateState): void {
    this.state = state
    this.publish(state)
  }

  private onAvailable(version: string): void {
    const state = this.state
    const isDownloaded = state.downloadedVersion === version
    this.set({
      ...state,
      status: isDownloaded ? 'downloaded' : 'available',
      availableVersion: version,
      downloadedVersion: isDownloaded ? version : null,
      downloadPercent: isDownloaded ? 100 : null,
      message: null,
      errorContext: null
    })
  }

  private onNotAvailable(): void {
    const state = this.state
    if (state.downloadedVersion !== null) {
      this.set({ ...state, status: 'downloaded', downloadPercent: 100 })
      return
    }
    this.set({
      ...state,
      status: 'up-to-date',
      availableVersion: null,
      downloadPercent: null,
      message: null,
      errorContext: null
    })
  }

  private onProgress(percent: number): void {
    const state = this.state
    if (state.status !== 'downloading') return
    // Progress events arrive many times per second; publish whole percentages only.
    const rounded = Math.floor(percent)
    if (rounded !== state.downloadPercent) this.set({ ...state, downloadPercent: rounded })
  }

  private onDownloaded(version: string): void {
    this.set({
      ...this.state,
      status: 'downloaded',
      availableVersion: version,
      downloadedVersion: version,
      downloadPercent: 100,
      message: null,
      errorContext: null
    })
  }

  private onError(error: unknown): void {
    if (this.action === 'install') {
      this.failInstall(describeError(error))
      return
    }
    // Checks and downloads report their own failures when their promise rejects.
    if (this.action) return
    console.error('Updater error:', error)
    this.set({
      ...this.state,
      status: this.state.downloadedVersion !== null ? 'downloaded' : 'error',
      message: describeError(error),
      downloadPercent: this.state.downloadedVersion !== null ? 100 : null
    })
  }

  private failInstall(message: string): void {
    if (this.action !== 'install') return
    console.error('Update install failed:', message)
    // The install record stays: if the app quits anyway, the next launch reports the failure,
    // and a retry overwrites it.
    this.action = null
    this.set({ ...this.state, status: 'error', message, errorContext: 'install' })
  }

  private async writeInstallRecord(targetVersion: string): Promise<void> {
    const record: InstallRecord = { fromVersion: this.version, targetVersion }
    try {
      await writeFile(this.installRecordPath, JSON.stringify(record), 'utf8')
    } catch (error) {
      // Only the "did not apply" notice depends on the record; the install can still proceed.
      console.warn('Could not record the update install:', error)
    }
  }

  private async removeInstallRecord(): Promise<void> {
    await rm(this.installRecordPath, { force: true }).catch((error: unknown) => {
      console.warn('Could not remove the update install record:', error)
    })
  }

  /** Reads and clears the record of the last install; returns its version if it did not apply. */
  private async takeNotAppliedVersion(): Promise<string | null> {
    let text: string
    try {
      text = await readFile(this.installRecordPath, 'utf8')
    } catch {
      return null
    }
    await this.removeInstallRecord()
    try {
      const record = JSON.parse(text) as Partial<InstallRecord>
      return record.fromVersion === this.version &&
        typeof record.targetVersion === 'string' &&
        record.targetVersion !== this.version
        ? record.targetVersion
        : null
    } catch {
      return null
    }
  }
}

let controller: UpdateController | null = null

/** Registers the update IPC handlers and, in installed builds, starts background checks. */
export function initAutoUpdater(): void {
  if (controller) return
  const currentVersion = app.getVersion()
  const updater = electronUpdater.autoUpdater
  controller = new UpdateController(
    updater,
    join(app.getPath('userData'), INSTALL_RECORD_FILE),
    currentVersion,
    (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('updateStateChanged', state)
      }
    }
  )
  const active = controller
  ipcMain.handle('getUpdateState', () => active.getState())
  ipcMain.handle('checkForUpdates', () => active.check())
  ipcMain.handle('downloadUpdate', () => active.download())
  ipcMain.handle('installUpdate', () => active.install())

  // Development and directory builds have no update feed (app-update.yml); they stay disabled.
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    console.debug('Automatic updates are off: this build has no update configuration.')
    return
  }
  void active.configure().then(
    () => active.start(),
    (error: unknown) => console.error('Could not start automatic updates:', error)
  )
}
