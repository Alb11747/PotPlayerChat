import type { UpdateState } from '@/types/update'

export type UpdateButtonAction = 'download' | 'install' | 'none'

export interface UpdateButton {
  label: string
  /** Full sentence for the tooltip and accessible name. */
  title: string
  action: UpdateButtonAction
}

function version(state: UpdateState): string {
  return state.downloadedVersion ?? state.availableVersion ?? 'update'
}

/** The toolbar control for an update, or null while there is nothing to offer. */
export function getUpdateButton(state: UpdateState | null): UpdateButton | null {
  if (!state) return null
  const target = version(state)
  const retryingFailedInstall =
    state.notAppliedVersion !== null && target === state.notAppliedVersion
  switch (state.status) {
    case 'available':
      return {
        label: 'Update',
        title: retryingFailedInstall
          ? `Update ${target} did not apply. Click to download it again.`
          : `Update ${target} is available. Click to download.`,
        action: 'download'
      }
    case 'checking':
      // Keep an offered update in place during the brief re-check instead of reflowing the toolbar.
      if (state.downloadedVersion)
        return { label: 'Restart', title: 'Checking for a newer update…', action: 'none' }
      if (state.availableVersion)
        return { label: 'Update', title: 'Checking for a newer update…', action: 'none' }
      return null
    case 'downloading':
      return {
        label: `${state.downloadPercent ?? 0}%`,
        title: `Downloading update ${target} (${state.downloadPercent ?? 0}%)`,
        action: 'none'
      }
    case 'downloaded':
      return {
        label: 'Restart',
        title: retryingFailedInstall
          ? `Update ${target} did not apply. Click to restart and try again.`
          : `Update ${target} is ready. Click to restart PotPlayerChat and install it.`,
        action: 'install'
      }
    case 'error':
      if (state.errorContext === 'download' && state.availableVersion)
        return {
          label: 'Retry',
          title: `Downloading update ${target} failed: ${state.message}. Click to retry.`,
          action: 'download'
        }
      if (state.errorContext === 'install' && state.downloadedVersion)
        return {
          label: 'Retry',
          title: `Installing update ${target} failed: ${state.message}. Click to retry.`,
          action: 'install'
        }
      // Failed background checks stay out of the toolbar; Settings reports them.
      return null
    default:
      return null
  }
}

function clock(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** One-line updater status for Settings. */
export function getUpdateStatusText(state: UpdateState | null): string {
  if (!state) return 'Loading update status…'
  const target = version(state)
  switch (state.status) {
    case 'disabled':
      return 'Updates are available in installed builds only.'
    case 'idle':
      return 'The first update check runs shortly after launch.'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return `Up to date. Last checked at ${clock(state.checkedAt)}.`
    case 'available':
      return `Version ${target} is available. Use Update in the toolbar to download it.`
    case 'downloading':
      return `Downloading version ${target} (${state.downloadPercent ?? 0}%)…`
    case 'downloaded':
      return `Version ${target} is ready. Use Restart in the toolbar to install it.`
    case 'error':
      if (state.errorContext === 'download') return `Downloading ${target} failed: ${state.message}`
      if (state.errorContext === 'install') return `Installing ${target} failed: ${state.message}`
      return `Could not check for updates: ${state.message}`
  }
}

export function canCheckForUpdates(state: UpdateState | null): boolean {
  return (
    state !== null &&
    state.status !== 'disabled' &&
    state.status !== 'checking' &&
    state.status !== 'downloading'
  )
}
