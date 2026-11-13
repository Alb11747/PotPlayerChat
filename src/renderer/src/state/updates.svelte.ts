import type { UpdateActionResult, UpdateState } from '@/types/update'

/** The main process owns update state; every view in this window reads this mirror of it. */
export const updates = $state<{ state: UpdateState | null }>({ state: null })

let watching = false

export function watchUpdates(): void {
  if (watching) return
  watching = true
  window.api.onUpdateStateChanged((state) => (updates.state = state))
  void window.api
    .getUpdateState()
    .then((state) => {
      // A broadcast that arrived first is newer than this snapshot.
      if (state && !updates.state) updates.state = state
    })
    .catch((error: unknown) => console.error('Could not read the update state:', error))
}

export async function runUpdateAction(
  action: 'checkForUpdates' | 'downloadUpdate' | 'installUpdate'
): Promise<void> {
  try {
    const result: UpdateActionResult = await window.api[action]()
    updates.state = result.state
  } catch (error) {
    console.error(`Update action ${action} failed:`, error)
  }
}
