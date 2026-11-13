/** Updater state shared by the main process and the renderer. */
export type UpdateStatus =
  /** This build cannot update itself (development or directory builds). */
  | 'disabled'
  /** Waiting for the first check. */
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateErrorContext = 'check' | 'download' | 'install'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  downloadPercent: number | null
  /** ISO timestamp of the last check that started. */
  checkedAt: string | null
  message: string | null
  errorContext: UpdateErrorContext | null
  /** A version the previous session tried to install that did not take effect. */
  notAppliedVersion: string | null
}

export interface UpdateActionResult {
  accepted: boolean
  state: UpdateState
}
