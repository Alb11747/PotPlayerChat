import type { TwitchMessage } from '@/core/chat/twitch-msg'
import { CooperativeWork } from '@/utils/cooperative-work'
import { SearchPreviewTexts, SearchTextCache } from './search-messages'
import type { SharedSearchData } from './search-window'

/** Inputs are timestamp-ordered snapshots. Existing rows win even when a duplicate
 * arrival has an earlier timestamp, and equal timestamps retain source order. */
export async function mergeSearchMessages(
  existing: readonly TwitchMessage[],
  incoming: readonly TwitchMessage[],
  signal?: AbortSignal
): Promise<readonly TwitchMessage[]> {
  const work = new CooperativeWork(signal)
  work.throwIfAborted()
  const owners = new Map<string, TwitchMessage>()
  for (const source of [existing, incoming]) {
    for (const message of source) {
      const id = message.getId()
      if (!owners.has(id)) owners.set(id, message)
      const pause = work.checkpoint()
      if (pause) await pause
    }
  }
  const result: TwitchMessage[] = []
  let left = 0
  let right = 0
  while (left < existing.length || right < incoming.length) {
    const message =
      right === incoming.length ||
      (left < existing.length && existing[left]!.timestamp <= incoming[right]!.timestamp)
        ? existing[left++]!
        : incoming[right++]!
    const id = message.getId()
    if (owners.get(id) === message) {
      result.push(message)
      owners.delete(id)
    }
    const pause = work.checkpoint()
    if (pause) await pause
  }
  work.throwIfAborted()
  return result
}

type SnapshotEntry = {
  controller: AbortController
  promise: Promise<readonly TwitchMessage[]>
  consumers: number
  complete: boolean
}

/** Lives in the source renderer. Weak array keys keep old recordings collectible. */
export class SharedSearchDataCache implements SharedSearchData {
  readonly previewTexts = new SearchPreviewTexts()
  readonly textCache = new SearchTextCache(this.previewTexts)
  private readonly snapshots = new WeakMap<
    readonly TwitchMessage[],
    WeakMap<readonly TwitchMessage[], SnapshotEntry>
  >()

  prepare(
    initial: readonly TwitchMessage[],
    loaded: readonly TwitchMessage[],
    signal?: AbortSignal
  ): Promise<readonly TwitchMessage[]> {
    signal?.throwIfAborted()
    let byLoaded = this.snapshots.get(initial)
    if (!byLoaded) {
      byLoaded = new WeakMap()
      this.snapshots.set(initial, byLoaded)
    }
    let entry = byLoaded.get(loaded)
    if (!entry) {
      const controller = new AbortController()
      entry = {
        controller,
        promise: mergeSearchMessages(initial, loaded, controller.signal),
        consumers: 0,
        complete: false
      }
      byLoaded.set(loaded, entry)
    }
    const shared = entry
    const cache = byLoaded
    shared.consumers++
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (): boolean => {
        if (settled) return false
        settled = true
        signal?.removeEventListener('abort', abort)
        shared.consumers--
        return true
      }
      const abort = (): void => {
        if (!finish()) return
        reject(signal!.reason)
        if (!shared.complete && shared.consumers === 0) {
          cache.delete(loaded)
          shared.controller.abort()
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      shared.promise.then(
        (messages) => {
          shared.complete = true
          if (finish()) resolve(messages)
        },
        (error: unknown) => {
          if (cache.get(loaded) === shared) cache.delete(loaded)
          if (finish()) reject(error)
        }
      )
    })
  }
}
