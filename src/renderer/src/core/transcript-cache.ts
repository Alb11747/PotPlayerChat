import { CooperativeWork } from '@/utils/cooperative-work'

/**
 * Imperative measurement caches. Only the committed TranscriptGeometry is
 * reactive: allocating a reactive source for every offscreen estimate makes
 * large transcripts expensive without contributing any UI subscriptions.
 */
export function createTranscriptCaches(): {
  measurements: Map<string, { height: number; estimate: number; version?: unknown }>
  estimates: Map<string, number>
  elements: Map<string, HTMLElement>
} {
  return {
    measurements: new Map(),
    estimates: new Map(),
    elements: new Map()
  }
}

/** Reverse dependencies let an asset update invalidate rows without reparsing history. */
interface LayoutDependencies {
  channels: Map<string, Set<string>>
  urls: Map<string, Set<string>>
  versions: Map<string, number>
  retain(data: readonly { getId(): string; channel?: string | null }[]): void
  record(key: string, dependencies: Set<string>): void
  invalidate(key: string): void
  has(key: string): boolean
  completeFork(): Promise<void>
  add(message: { getId(): string; channel?: string | null }): void
  fork(
    data: readonly { getId(): string; channel?: string | null }[],
    signal?: AbortSignal
  ): Promise<LayoutDependencies>
}

export function createMessageLayoutDependencies(): LayoutDependencies {
  const messages = new Map<string, object>()
  const channels = new Map<string, Set<string>>()
  const urls = new Map<string, Set<string>>()
  const rowUrls = new Map<string, Set<string>>()
  const versions = new Map<string, number>()
  const journals = new Set<Set<string>>()
  const changed = (key: string): void => {
    for (const journal of journals) journal.add(key)
  }
  function forgetUrls(key: string): void {
    for (const url of rowUrls.get(key) ?? []) {
      const rows = urls.get(url)!
      rows.delete(key)
      if (!rows.size) urls.delete(url)
    }
    rowUrls.delete(key)
  }
  return {
    channels,
    urls,
    versions,
    invalidate(key): void {
      versions.set(key, (versions.get(key) ?? 0) + 1)
      changed(key)
    },
    has: (key) => messages.has(key),
    async completeFork(): Promise<void> {
      return
    },
    async fork(data, signal): Promise<LayoutDependencies> {
      const work = new CooperativeWork(signal)
      const next = createMessageLayoutDependencies()
      const retained = new Map<string, object>()
      const journal = new Set<string>()
      journals.add(journal)
      // Release both on abort and successful publication. Keeping this one-time
      // closure would retain the old index and every preceding recording.
      const release = (): void => {
        journals.delete(journal)
        signal?.removeEventListener('abort', release)
        retained.clear()
        journal.clear()
        next.completeFork = async (): Promise<void> => {
          return
        }
      }
      signal?.addEventListener('abort', release, { once: true })
      const copy = (key: string, message: object): void => {
        if (messages.get(key) === message) {
          const dependencies = rowUrls.get(key)
          if (dependencies) next.record(key, dependencies)
          const version = versions.get(key)
          if (version !== undefined) next.versions.set(key, version)
        } else if (messages.has(key)) {
          next.versions.set(key, (versions.get(key) ?? 0) + 1)
        }
      }
      try {
        // Keep the old index live until publication. Asset callbacks can update
        // already-copied rows, so retain their journal through the final handoff.
        for (const message of data) {
          const key = message.getId()
          retained.set(key, message)
          next.add(message)
          copy(key, message)
          const pause = work.checkpoint()
          if (pause) await pause
        }
        work.throwIfAborted()
        next.completeFork = async (): Promise<void> => {
          try {
            for (const key of journal) {
              journal.delete(key)
              const message = retained.get(key)
              if (message) copy(key, message)
              const pause = work.checkpoint()
              if (pause) await pause
            }
            work.throwIfAborted()
          } finally {
            release()
          }
        }
        return next
      } catch (error) {
        release()
        throw error
      }
    },
    add(message): void {
      const key = message.getId()
      messages.set(key, message)
      const channel = message.channel ?? ''
      let rows = channels.get(channel)
      if (!rows) channels.set(channel, (rows = new Set()))
      rows.add(key)
    },
    retain(data: readonly { getId(): string; channel?: string | null }[]): void {
      const keep = new Set<string>()
      channels.clear()
      for (const message of data) {
        const key = message.getId()
        keep.add(key)
        if (messages.has(key) && messages.get(key) !== message) {
          forgetUrls(key)
          versions.set(key, (versions.get(key) ?? 0) + 1)
        }
        messages.set(key, message)
        const channel = message.channel ?? ''
        let rows = channels.get(channel)
        if (!rows) channels.set(channel, (rows = new Set()))
        rows.add(key)
      }
      for (const key of messages.keys()) {
        if (keep.has(key)) continue
        messages.delete(key)
        versions.delete(key)
        forgetUrls(key)
      }
    },
    record(key: string, dependencies: Set<string>): void {
      changed(key)
      const previous = rowUrls.get(key)
      // A mounted row may have been measured before these media dependencies
      // were known. Its old DOM size cannot vouch for assets that resolved unseen.
      if (
        !previous ||
        previous.size !== dependencies.size ||
        [...dependencies].some((url) => !previous.has(url))
      )
        versions.set(key, (versions.get(key) ?? 0) + 1)
      forgetUrls(key)
      rowUrls.set(key, dependencies)
      for (const url of dependencies) {
        let rows = urls.get(url)
        if (!rows) urls.set(url, (rows = new Set()))
        rows.add(key)
      }
    }
  }
}
