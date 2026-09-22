import type { TwitchMessage } from '@/core/chat/twitch-msg'
import { CooperativeWork } from '@/utils/cooperative-work'
import { SEARCH_PREVIEW_LIMIT } from './search-preview'

export type SearchPageDirection = 'older' | 'newer'
export interface SearchHistoryRange {
  start: number
  end: number
}
export interface SearchPagingHistory {
  resolveRange(signal: AbortSignal): Promise<SearchHistoryRange | undefined>
  fetchRange(start: number, end: number, signal: AbortSignal): Promise<readonly TwitchMessage[]>
}
export interface SearchMessagePagerOptions {
  sources: readonly (readonly TwitchMessage[])[]
  preview: readonly TwitchMessage[]
  anchorTime?: number
  pageSize?: number
  history?: SearchPagingHistory
}

type Cursor = { positions: number[]; frontier: number; buffer: TwitchMessage[]; exhausted: boolean }
const INTERVAL = 5 * 60 * 1000

function lowerBound(rows: readonly TwitchMessage[], timestamp: number, after = false): number {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle]!.timestamp < timestamp || (after && rows[middle]!.timestamp === timestamp))
      low = middle + 1
    else high = middle
  }
  return low
}

/** Browses sorted, captured arrays without preparing their complete merged history.
 * Message IDs normally identify a single timestamp. Already admitted objects win if
 * malformed inputs reuse an ID at conflicting timestamps; normal duplicates use
 * first-source precedence, including when browsing backwards through a timestamp tie.
 */
export class SearchMessagePager {
  private readonly sources: readonly (readonly TwitchMessage[])[]
  private readonly coverage: SearchHistoryRange[]
  private readonly pageSize: number
  private readonly controller = new AbortController()
  private readonly history?: SearchPagingHistory
  private readonly cursors: Record<SearchPageDirection, Cursor>
  private readonly admitted = new Set<string>()
  private rows: readonly TwitchMessage[] = []
  private range: SearchHistoryRange | undefined
  private rangeResolved = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly pending = new Map<SearchPageDirection, Promise<readonly TwitchMessage[]>>()

  constructor(options: SearchMessagePagerOptions) {
    this.pageSize = Math.max(1, Math.floor(options.pageSize ?? SEARCH_PREVIEW_LIMIT))
    this.history = options.history
    const focused = options.preview[Math.floor(options.preview.length / 2)]
    const anchor = focused?.timestamp ?? options.anchorTime ?? Date.now()
    const sources = [...options.sources]
    // A popup may be opened on a row outside both captured arrays.
    if (focused && !sources.some((source) => this.findAtTimestamp(source, focused) >= 0)) {
      sources.push(options.preview)
    }
    this.sources = sources
    this.coverage = sources
      .filter((source) => source.length > 0)
      .map((source) => ({ start: source[0]!.timestamp, end: source.at(-1)!.timestamp }))
      .sort((a, b) => a.start - b.start)
    const covered: SearchHistoryRange[] = []
    for (const range of this.coverage) {
      const previous = covered.at(-1)
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
      else covered.push({ ...range })
    }
    const initialRange = this.history
      ? (covered.find((range) => range.start <= anchor && anchor <= range.end) ?? {
          start: anchor,
          end: anchor
        })
      : undefined
    const focusedSource = focused
      ? sources.findIndex((source) => this.findAtTimestamp(source, focused) >= 0)
      : -1
    const pivot = sources.map((source, index) => {
      if (index === focusedSource) return this.findAtTimestamp(source, focused!)
      // Split the total (timestamp, source, source-index) ordering exactly once.
      // Later sources at the target timestamp all follow the focused source.
      return lowerBound(source, anchor, index < focusedSource)
    })
    this.cursors = {
      older: {
        positions: pivot.map((index) => index - 1),
        frontier: anchor,
        buffer: [],
        exhausted: false
      },
      newer: { positions: pivot, frontier: anchor, buffer: [], exhausted: false }
    }
    const older: TwitchMessage[] = []
    const newer: TwitchMessage[] = []
    this.takeLocal(
      'older',
      this.cursors.older,
      older,
      Math.floor(this.pageSize / 2),
      this.admitted,
      initialRange
    )
    this.takeLocal(
      'newer',
      this.cursors.newer,
      newer,
      this.pageSize - older.length,
      this.admitted,
      initialRange
    )
    this.takeLocal(
      'older',
      this.cursors.older,
      older,
      this.pageSize - newer.length,
      this.admitted,
      initialRange
    )
    this.rows = [...older.reverse(), ...newer]
    this.cursors.older.frontier = this.rows[0]?.timestamp ?? anchor
    this.cursors.newer.frontier = this.rows.at(-1)?.timestamp ?? anchor
    this.updateExhaustion('older', this.cursors.older)
    this.updateExhaustion('newer', this.cursors.newer)
  }

  get messages(): readonly TwitchMessage[] {
    return this.rows
  }

  isExhausted(direction: SearchPageDirection): boolean {
    return this.cursors[direction].exhausted
  }

  dispose(): void {
    this.controller.abort()
  }

  page(direction: SearchPageDirection, signal?: AbortSignal): Promise<readonly TwitchMessage[]> {
    const pending = this.pending.get(direction)
    if (pending) return pending
    const combined = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
    const operation = this.queue.then(() => this.loadPage(direction, combined))
    this.pending.set(direction, operation)
    this.queue = operation.catch(() => undefined)
    void operation
      .finally(() => {
        if (this.pending.get(direction) === operation) this.pending.delete(direction)
      })
      .catch(() => undefined)
    return operation
  }

  private findAtTimestamp(source: readonly TwitchMessage[], target: TwitchMessage): number {
    const start = lowerBound(source, target.timestamp)
    for (
      let index = start;
      index < source.length && source[index]!.timestamp === target.timestamp;
      index++
    ) {
      if (source[index] === target || source[index]!.getId() === target.getId()) return index
    }
    return -1
  }

  private owns(sourceIndex: number, rowIndex: number): boolean {
    const row = this.sources[sourceIndex]![rowIndex]!
    for (let index = 0; index <= sourceIndex; index++) {
      const owner = this.findAtTimestamp(this.sources[index]!, row)
      if (owner >= 0) return index === sourceIndex && owner === rowIndex
    }
    return true
  }

  private candidate(
    direction: SearchPageDirection,
    cursor: Cursor
  ): { source: number; message: TwitchMessage } | undefined {
    let result: { source: number; message: TwitchMessage } | undefined
    const backwards = direction === 'older'
    for (let source = 0; source < this.sources.length; source++) {
      const message = this.sources[source]![cursor.positions[source]!]
      if (!message) continue
      if (
        !result ||
        (backwards
          ? message.timestamp > result.message.timestamp ||
            (message.timestamp === result.message.timestamp && source > result.source)
          : message.timestamp < result.message.timestamp)
      )
        result = { source, message }
    }
    return result
  }

  private takeLocal(
    direction: SearchPageDirection,
    cursor: Cursor,
    output: TwitchMessage[],
    limit: number,
    ids: Set<string>,
    range?: SearchHistoryRange
  ): void {
    while (output.length < limit) {
      const next = this.candidate(direction, cursor)
      if (!next) break
      if (range && (next.message.timestamp < range.start || next.message.timestamp > range.end))
        break
      const position = cursor.positions[next.source]!
      cursor.positions[next.source] = position + (direction === 'older' ? -1 : 1)
      const id = next.message.getId()
      if (ids.has(id) || !this.owns(next.source, position)) continue
      ids.add(id)
      output.push(next.message)
    }
  }

  private hasHistory(direction: SearchPageDirection, cursor: Cursor): boolean {
    if (!this.history) return false
    if (!this.rangeResolved) return true
    if (!this.range) return false
    return direction === 'older'
      ? cursor.frontier > this.range.start
      : cursor.frontier < this.range.end
  }

  private updateExhaustion(direction: SearchPageDirection, cursor: Cursor): void {
    cursor.exhausted =
      !this.candidate(direction, cursor) &&
      !cursor.buffer.length &&
      !this.hasHistory(direction, cursor)
  }

  private skipCoveredHistory(direction: SearchPageDirection, cursor: Cursor): void {
    // Captured histories use the same contiguous timestamp coverage semantics as
    // the full-search loader. Checking their endpoints costs O(source count).
    const ranges = direction === 'older' ? this.coverage.toReversed() : this.coverage
    for (const range of ranges) {
      if (range.start <= cursor.frontier && cursor.frontier <= range.end) {
        cursor.frontier = direction === 'older' ? range.start : range.end
      }
    }
  }

  private publish(direction: SearchPageDirection, added: TwitchMessage[]): void {
    const left = direction === 'older' ? added.reverse() : this.rows
    const right = direction === 'older' ? this.rows : added
    const timestamp = left.at(-1)?.timestamp
    if (timestamp === undefined || timestamp !== right[0]?.timestamp) {
      this.rows = [...left, ...right]
      return
    }
    let start = left.length - 1
    let end = 0
    while (start > 0 && left[start - 1]!.timestamp === timestamp) start--
    while (end < right.length && right[end]!.timestamp === timestamp) end++
    const tied = [...left.slice(start), ...right.slice(0, end)]
    const ranks = new Map<TwitchMessage, number>()
    for (const row of tied) {
      const source = this.sources.findIndex((rows) => this.findAtTimestamp(rows, row) >= 0)
      ranks.set(row, source < 0 ? this.sources.length : source)
    }
    // Inclusive API endpoints can introduce remote rows at an already visible
    // timestamp. Captured sources still precede remote rows at that timestamp.
    tied.sort((a, b) => ranks.get(a)! - ranks.get(b)!)
    this.rows = [...left.slice(0, start), ...tied, ...right.slice(end)]
  }

  private async loadPage(
    direction: SearchPageDirection,
    signal: AbortSignal
  ): Promise<readonly TwitchMessage[]> {
    signal.throwIfAborted()
    const current = this.cursors[direction]
    if (current.exhausted) return this.rows
    const cursor = { ...current, positions: [...current.positions], buffer: [...current.buffer] }
    const ids = new Set(this.admitted)
    const added: TwitchMessage[] = []
    const backwards = direction === 'older'
    const work = new CooperativeWork(signal)
    while (added.length < this.pageSize) {
      signal.throwIfAborted()
      this.skipCoveredHistory(direction, cursor)
      const local = this.candidate(direction, cursor)
      const remote = cursor.buffer[0]
      const next =
        !remote ||
        (local &&
          (backwards
            ? local.message.timestamp > remote.timestamp
            : local.message.timestamp <= remote.timestamp))
          ? local?.message
          : remote
      // Do not jump over missing time between captured slices. Scan only the next
      // five-minute interval, buffering busy intervals for subsequent page calls.
      const needsHistory =
        this.hasHistory(direction, cursor) &&
        (!next ||
          (backwards
            ? next.timestamp < Math.min(cursor.frontier, this.range?.end ?? Infinity)
            : next.timestamp > Math.max(cursor.frontier, this.range?.start ?? -Infinity)))
      if (needsHistory) {
        if (!this.rangeResolved) {
          const range = await this.history!.resolveRange(signal)
          signal.throwIfAborted()
          this.range = range && range.end > range.start ? range : undefined
          this.rangeResolved = true
          continue
        }
        const start = backwards
          ? Math.max(this.range!.start, Math.min(cursor.frontier, this.range!.end) - INTERVAL)
          : Math.max(cursor.frontier, this.range!.start)
        const end = backwards
          ? Math.min(cursor.frontier, this.range!.end)
          : Math.min(this.range!.end, start + INTERVAL)
        const rows = await this.history!.fetchRange(start, end, signal)
        signal.throwIfAborted()
        cursor.frontier = backwards ? start : end
        const boundary = backwards ? this.rows[0]?.timestamp : this.rows.at(-1)?.timestamp
        const fresh = rows.filter(
          (row) =>
            row.timestamp >= start &&
            row.timestamp <= end &&
            (boundary === undefined ||
              (backwards ? row.timestamp <= boundary : row.timestamp >= boundary))
        )
        if (backwards) fresh.reverse()
        cursor.buffer.push(...fresh)
        cursor.buffer.sort((a, b) =>
          backwards ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
        )
        continue
      }
      if (!next) break
      let owned = true
      if (next === local?.message) {
        const position = cursor.positions[local.source]!
        cursor.positions[local.source] = position + (backwards ? -1 : 1)
        owned = this.owns(local.source, position)
      } else {
        cursor.buffer.shift()
        owned = !this.sources.some((source) => this.findAtTimestamp(source, next) >= 0)
      }
      const id = next.getId()
      if (owned && !ids.has(id)) {
        ids.add(id)
        added.push(next)
      }
      const pause = work.checkpoint()
      if (pause) await pause
    }
    signal.throwIfAborted()
    this.updateExhaustion(direction, cursor)
    this.cursors[direction] = cursor
    for (const row of added) this.admitted.add(row.getId())
    this.publish(direction, added)
    return this.rows
  }
}
