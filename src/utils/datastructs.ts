/**
 * TimelineMap is a key-value store with time-travel semantics.
 *
 * - set(key, value, timestamp?): Sets `value` for `key` at `timestamp`.
 *   If `timestamp` is omitted, it is treated as -Infinity (baseline/default).
 *
 * - get(key, timestamp?): Gets the value of `key` at `timestamp`.
 *   If `timestamp` is omitted, it is treated as +Infinity (latest).
 *
 * For any timestamp T, get(key, T) returns the value from the most recent set
 * whose set timestamp is <= T. If none exists, returns undefined.
 */
export class TimelineMap<Key, Value> {
  private readonly equals: (a: Value, b: Value) => boolean
  private readonly keyToTimeline: Map<Key, Array<{ timestamp: number; value: Value }>> = new Map()

  /**
   * Optional equality comparator can be supplied. Defaults to Object.is.
   */
  constructor(equals?: (a: Value, b: Value) => boolean) {
    this.equals = equals ?? Object.is
  }

  /**
   * Sets a value for a key at the specified timestamp. If timestamp is omitted,
   * it is treated as -Infinity.
   */
  public set(key: Key, value: Value, timestamp?: number): void {
    const effectiveTimestamp: number = timestamp ?? Number.NEGATIVE_INFINITY
    const timeline: Array<{ timestamp: number; value: Value }> = this.ensureTimeline(key)

    if (timeline.length === 0) {
      timeline.push({ timestamp: effectiveTimestamp, value })
      return
    }

    // Fast path for appending in sorted order
    const lastEntry = timeline[timeline.length - 1]!
    if (effectiveTimestamp > lastEntry.timestamp) {
      timeline.push({ timestamp: effectiveTimestamp, value })
      return
    }

    // Find insertion point (first index with timestamp >= effectiveTimestamp)
    const insertionIndex: number = this.findFirstIndexGreaterOrEqual(timeline, effectiveTimestamp)

    const existingAtInsertion = timeline[insertionIndex]
    if (
      insertionIndex < timeline.length &&
      existingAtInsertion &&
      existingAtInsertion.timestamp === effectiveTimestamp
    ) {
      // Overwrite existing value at the exact timestamp
      existingAtInsertion.value = value
    } else {
      // Insert while keeping ascending order by timestamp
      timeline.splice(insertionIndex, 0, { timestamp: effectiveTimestamp, value })
    }
  }

  /**
   * Gets the value for a key at the specified timestamp. If timestamp is omitted,
   * it is treated as +Infinity (latest available).
   */
  public get(key: Key, timestamp?: number): Value | undefined {
    const timeline: Array<{ timestamp: number; value: Value }> | undefined =
      this.keyToTimeline.get(key)
    if (!timeline || timeline.length === 0) {
      return undefined
    }

    const effectiveTimestamp: number = timestamp ?? Number.POSITIVE_INFINITY
    const index: number = this.findLastIndexLessOrEqual(timeline, effectiveTimestamp)
    if (index === -1) return undefined

    return timeline[index]!.value
  }

  /** Returns number of versions stored for a key. */
  public versionCount(key: Key): number {
    const timeline: Array<{ timestamp: number; value: Value }> | undefined =
      this.keyToTimeline.get(key)
    return timeline ? timeline.length : 0
  }

  /** Clears all versions for all keys. */
  public clear(): void {
    this.keyToTimeline.clear()
  }

  /**
   * Removes redundant entries so that only change points are kept per key.
   * After condense(), get(key, t) returns the same value as before for all t,
   * given the current timelines.
   *
   * Important: This preservation holds for the existing data only. If you later
   * call set() with a timestamp that falls between entries that were removed by
   * condense(), future get() results could differ compared to the pre-condense
   * history because the removed entries acted as change boundaries. If you need
   * to backfill older timestamps, either avoid condensing until those sets are
   * applied or run condense() again afterwards.
   */
  public condense(): void {
    for (const [key, timeline] of this.keyToTimeline.entries()) {
      if (!timeline || timeline.length <= 1) continue

      const condensed: Array<{ timestamp: number; value: Value }> = []
      let lastKeptValue: Value | undefined
      let hasLast = false

      for (let i = 0; i < timeline.length; i++) {
        const entry = timeline[i]!
        if (!hasLast || !this.equals(entry.value, lastKeptValue as Value)) {
          condensed.push(entry)
          lastKeptValue = entry.value
          hasLast = true
        }
      }

      if (condensed.length !== timeline.length) {
        timeline.length = 0
        timeline.push(...condensed)
        this.keyToTimeline.set(key, timeline)
      }
    }
  }

  /** Ensures a timeline exists for key and returns it. */
  private ensureTimeline(key: Key): Array<{ timestamp: number; value: Value }> {
    let timeline: Array<{ timestamp: number; value: Value }> | undefined =
      this.keyToTimeline.get(key)
    if (!timeline) {
      timeline = []
      this.keyToTimeline.set(key, timeline)
    }
    return timeline
  }

  /**
   * Binary search: returns index of the rightmost entry with timestamp <= target,
   * or -1 if all timestamps are greater than target.
   */
  private findLastIndexLessOrEqual(
    timeline: Array<{ timestamp: number; value: Value }>,
    target: number
  ): number {
    let low: number = 0
    let high: number = timeline.length - 1
    let answer: number = -1
    while (low <= high) {
      const mid: number = (low + high) >>> 1
      const midEntry = timeline[mid]!
      if (midEntry.timestamp <= target) {
        answer = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return answer
  }

  /**
   * Binary search: returns the first index whose timestamp >= target.
   * If all timestamps are less than target, returns timeline.length.
   */
  private findFirstIndexGreaterOrEqual(
    timeline: Array<{ timestamp: number; value: Value }>,
    target: number
  ): number {
    let low: number = 0
    let high: number = timeline.length - 1
    let answer: number = timeline.length
    while (low <= high) {
      const mid: number = (low + high) >>> 1
      const midEntry = timeline[mid]!
      if (midEntry.timestamp >= target) {
        answer = mid
        high = mid - 1
      } else {
        low = mid + 1
      }
    }
    return answer
  }
}

/**
 * BoundedSet is a Set-like collection with a maximum capacity.
 * When the capacity is exceeded the oldest entry (in insertion order)
 * is evicted. Adding an existing item refreshes its recency (moves it
 * to the newest position).
 */
export class BoundedSet<T> extends Set<T> {
  /** Maximum number of items to keep. */
  public readonly capacity: number

  constructor(capacity: number, iterable?: Iterable<T>) {
    super()
    // Normalize capacity: negative -> 0, non-integer -> floor, Infinity supported
    this.capacity = Number.isFinite(capacity)
      ? Math.max(0, Math.floor(capacity))
      : Number.POSITIVE_INFINITY

    if (iterable) for (const item of iterable) this.add(item)
  }

  /**
   * Adds `value`, refreshing recency if it already existed. If adding a new
   * value would exceed capacity, evicts the oldest entry first.
   */
  public override add(value: T): this {
    if (this.capacity === 0) return this

    if (this.has(value)) {
      // Refresh recency: move to newest position
      super.delete(value)
      super.add(value)
      return this
    }

    if (this.size >= this.capacity) {
      // Evict oldest (first in insertion order)
      const oldest = this.values().next()
      if (!oldest.done) super.delete(oldest.value as T)
    }

    super.add(value)
    return this
  }
}
