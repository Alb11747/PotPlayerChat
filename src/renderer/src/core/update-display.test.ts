import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@/types/update'
import { canCheckForUpdates, getUpdateButton, getUpdateStatusText } from './update-display'

function state(value: Partial<UpdateState>): UpdateState {
  return {
    status: 'idle',
    currentVersion: '1.0.10',
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    notAppliedVersion: null,
    ...value
  }
}

describe('update toolbar button', () => {
  it('stays hidden while there is nothing to act on', () => {
    expect(getUpdateButton(null)).toBeNull()
    for (const status of ['disabled', 'idle', 'checking', 'up-to-date'] as const)
      expect(getUpdateButton(state({ status }))).toBeNull()
    expect(
      getUpdateButton(state({ status: 'error', errorContext: 'check', message: 'x' }))
    ).toBeNull()
  })

  it('walks through download, progress and restart', () => {
    expect(getUpdateButton(state({ status: 'available', availableVersion: '1.0.12' }))).toEqual({
      label: 'Update',
      title: 'Update 1.0.12 is available. Click to download.',
      action: 'download'
    })
    expect(
      getUpdateButton(
        state({ status: 'downloading', availableVersion: '1.0.12', downloadPercent: 41 })
      )
    ).toMatchObject({ label: '41%', action: 'none' })
    expect(
      getUpdateButton(
        state({ status: 'downloaded', availableVersion: '1.0.12', downloadedVersion: '1.0.12' })
      )
    ).toMatchObject({ label: 'Restart', action: 'install' })
  })

  it('keeps an offered update in place, disabled, during a re-check', () => {
    expect(
      getUpdateButton(state({ status: 'checking', availableVersion: '1.0.12' }))
    ).toMatchObject({ label: 'Update', action: 'none' })
    expect(
      getUpdateButton(
        state({ status: 'checking', availableVersion: '1.0.12', downloadedVersion: '1.0.12' })
      )
    ).toMatchObject({ label: 'Restart', action: 'none' })
  })

  it('offers retries for failed downloads and installs', () => {
    expect(
      getUpdateButton(
        state({
          status: 'error',
          errorContext: 'download',
          availableVersion: '1.0.12',
          message: 'timeout'
        })
      )
    ).toMatchObject({ label: 'Retry', action: 'download' })
    expect(
      getUpdateButton(
        state({
          status: 'error',
          errorContext: 'install',
          downloadedVersion: '1.0.12',
          message: 'spawn EACCES'
        })
      )
    ).toEqual({
      label: 'Retry',
      title: 'Installing update 1.0.12 failed: spawn EACCES. Click to retry.',
      action: 'install'
    })
  })

  it('says when the same update failed to apply last time', () => {
    expect(
      getUpdateButton(
        state({
          status: 'downloaded',
          downloadedVersion: '1.0.12',
          notAppliedVersion: '1.0.12'
        })
      )?.title
    ).toBe('Update 1.0.12 did not apply. Click to restart and try again.')
  })
})

describe('update status text', () => {
  it('explains builds that cannot update and failed checks', () => {
    expect(getUpdateStatusText(state({ status: 'disabled' }))).toBe(
      'Updates are available in installed builds only.'
    )
    expect(
      getUpdateStatusText(state({ status: 'error', errorContext: 'check', message: 'offline' }))
    ).toBe('Could not check for updates: offline')
  })

  it('allows manual checks only when the updater is free', () => {
    expect(canCheckForUpdates(null)).toBe(false)
    expect(canCheckForUpdates(state({ status: 'disabled' }))).toBe(false)
    expect(canCheckForUpdates(state({ status: 'downloading' }))).toBe(false)
    expect(canCheckForUpdates(state({ status: 'up-to-date' }))).toBe(true)
    expect(canCheckForUpdates(state({ status: 'downloaded' }))).toBe(true)
  })
})
