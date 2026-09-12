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
export function createMessageLayoutDependencies(): {
  channels: Map<string, Set<string>>
  urls: Map<string, Set<string>>
  versions: Map<string, number>
  retain(data: readonly { getId(): string; channel?: string | null }[]): void
  record(key: string, dependencies: Set<string>): void
} {
  const messages = new Map<string, object>()
  const channels = new Map<string, Set<string>>()
  const urls = new Map<string, Set<string>>()
  const rowUrls = new Map<string, Set<string>>()
  const versions = new Map<string, number>()
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
