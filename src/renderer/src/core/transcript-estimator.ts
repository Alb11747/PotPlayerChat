import { CooperativeWork } from '@/utils/cooperative-work'

interface TranscriptEstimatorOptions<T> {
  getKey: (item: T) => string
  measure: (item: T) => number
  publish: (keys: readonly string[]) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  now?: () => number
}

interface Estimate<T> {
  item: T
  height: number
  valid: boolean
}

/** Measures offscreen rows without making transcript mounting wait for the full history. */
export class TranscriptEstimator<T> {
  private readonly options: TranscriptEstimatorOptions<T>
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly now: () => number
  private readonly yieldAfterFrame: boolean
  private data: readonly T[] | undefined
  private version: unknown
  private keys: string[] = []
  private estimates = new Map<string, Estimate<T>>()
  private dirty = new Set<string>()
  private dirtyIterator = this.dirty.values()
  private priorityStart = 0
  private priorityEnd = 0
  private priorityCursor = 0
  private generation = 0
  private frame: number | undefined
  private postFrameTask: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private replacement = 0
  private replacementDirty: Set<string> | undefined

  constructor(options: TranscriptEstimatorOptions<T>) {
    this.options = options
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle))
    this.now = options.now ?? (() => performance.now())
    this.yieldAfterFrame = options.requestFrame === undefined
  }

  replace(data: readonly T[], version: unknown): void {
    if (this.disposed) return
    this.replacement++
    const wasPreparing = this.replacementDirty !== undefined
    this.replacementDirty = undefined
    if (this.data === data && Object.is(this.version, version)) {
      // Returning to the published dataset also supersedes an in-flight replacement.
      if (wasPreparing) {
        this.cancel()
        this.schedule()
      }
      return
    }
    this.cancel()
    const sameVersion = Object.is(this.version, version)
    const estimates = new Map<string, Estimate<T>>()
    const dirty = new Set<string>()
    const keys: string[] = []
    for (const item of data) {
      const key = this.options.getKey(item)
      const previous = this.estimates.get(key)
      const estimate =
        previous && sameVersion && previous.item === item
          ? previous
          : { item, height: previous?.height ?? 48, valid: false }
      estimates.set(key, estimate)
      keys.push(key)
      if (!estimate.valid) dirty.add(key)
    }
    this.data = data
    this.version = version
    this.keys = keys
    this.estimates = estimates
    this.dirty = dirty
    this.dirtyIterator = dirty.values()
    this.priorityCursor = this.priorityStart
    this.schedule()
  }

  async replaceCooperatively(
    data: readonly T[],
    version: unknown,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.disposed) return
    signal?.throwIfAborted()
    if (this.data === data && Object.is(this.version, version)) {
      this.replace(data, version)
      return
    }
    const replacement = ++this.replacement
    const invalidated = new Set<string>()
    this.replacementDirty = invalidated
    this.cancel()
    try {
      const work = new CooperativeWork(signal)
      const sameVersion = Object.is(this.version, version)
      const estimates = new Map<string, Estimate<T>>()
      const dirty = new Set<string>()
      const keys: string[] = []
      for (const item of data) {
        const key = this.options.getKey(item)
        const previous = this.estimates.get(key)
        const estimate =
          previous && sameVersion && previous.item === item
            ? previous
            : { item, height: previous?.height ?? 48, valid: false }
        estimates.set(key, estimate)
        keys.push(key)
        if (!estimate.valid) dirty.add(key)
        const pause = work.checkpoint()
        if (pause) await pause
        if (replacement !== this.replacement || this.disposed) return
      }
      for (const key of invalidated) {
        const estimate = estimates.get(key)
        if (estimate) {
          estimate.valid = false
          dirty.add(key)
        }
        const pause = work.checkpoint()
        if (pause) await pause
        if (replacement !== this.replacement || this.disposed) return
      }
      work.throwIfAborted()
      if (replacement !== this.replacement || this.disposed) return
      this.cancel()
      this.data = data
      this.version = version
      this.keys = keys
      this.estimates = estimates
      this.dirty = dirty
      this.dirtyIterator = dirty.values()
      this.priorityCursor = this.priorityStart
    } finally {
      // Abort/failure keeps the published dataset usable and resumes its pending
      // measurements. An obsolete preparation must never resume a newer one's work.
      if (replacement === this.replacement) {
        this.replacementDirty = undefined
        this.schedule()
      }
    }
  }
  /** Retain the last height until its replacement is ready, avoiding a fallback-height jump. */
  invalidate(keys?: Iterable<string>): void {
    if (this.disposed) return
    this.cancel()
    for (const key of keys ?? this.estimates.keys()) {
      this.replacementDirty?.add(key)
      const estimate = this.estimates.get(key)
      if (!estimate) continue
      estimate.valid = false
      this.dirty.add(key)
    }
    this.priorityCursor = this.priorityStart
    this.schedule()
  }

  /** The range includes start and excludes end, matching the virtual transcript's range. */
  prioritize(start: number, end: number): void {
    if (this.disposed) return
    this.priorityStart = Math.max(0, Math.floor(start))
    this.priorityEnd = Math.max(this.priorityStart, Math.ceil(end))
    this.priorityCursor = this.priorityStart
    this.schedule()
  }

  get(key: string): number {
    return this.estimates.get(key)?.height ?? 48
  }

  dispose(): void {
    this.replacement++
    this.disposed = true
    this.replacementDirty = undefined
    this.cancel()
    this.data = undefined
    this.keys = []
    this.estimates.clear()
    this.dirty.clear()
  }

  private cancel(): void {
    this.generation++
    if (this.frame !== undefined) this.cancelFrame(this.frame)
    if (this.postFrameTask !== undefined) clearTimeout(this.postFrameTask)
    this.frame = undefined
    this.postFrameTask = undefined
  }

  private schedule(): void {
    // Keep shared estimate validity stable until the replacement journal is replayed.
    if (this.disposed || this.replacementDirty || this.frame !== undefined || !this.dirty.size)
      return
    const generation = this.generation
    const measure = (): void => {
      // A cancelled callback may already have been dispatched; it must not touch a newer frame.
      if (generation !== this.generation || this.disposed) return
      this.frame = undefined
      this.postFrameTask = undefined
      this.flush(generation)
    }
    this.frame = this.requestFrame(() => {
      if (generation !== this.generation || this.disposed) return
      // Let this frame paint and queued foreground tasks run before background shaping.
      // The frame stays pending through this task, preserving the once-per-frame limit.
      if (this.yieldAfterFrame) this.postFrameTask = setTimeout(measure, 0)
      else measure()
    })
  }

  private nextKey(): string | undefined {
    const end = Math.min(this.priorityEnd, this.keys.length)
    while (this.priorityCursor < end) {
      const key = this.keys[this.priorityCursor++]!
      if (this.dirty.has(key)) return key
    }
    let next = this.dirtyIterator.next()
    // Reuse the iterator so consumed/deleted entries are not scanned again for every row.
    // A completed iterator cannot see newly invalidated keys, so restart it only then.
    if (next.done && this.dirty.size) {
      this.dirtyIterator = this.dirty.values()
      next = this.dirtyIterator.next()
    }
    return next.value
  }

  private flush(generation: number): void {
    const started = this.now()
    const pending: { key: string; estimate: Estimate<T>; height: number }[] = []
    let committed = false
    try {
      while (pending.length < 64 && (pending.length === 0 || this.now() - started < 4)) {
        const key = this.nextKey()
        if (key === undefined) break
        const estimate = this.estimates.get(key)!
        this.dirty.delete(key)
        const result = { key, estimate, height: estimate.height }
        pending.push(result)
        result.height = this.options.measure(estimate.item)
        if (this.disposed || generation !== this.generation) return
      }
      for (const { estimate, height } of pending) {
        estimate.height = Number.isFinite(height) && height > 0 ? height : 48
        estimate.valid = true
      }
      committed = true
      if (pending.length) this.options.publish(pending.map(({ key }) => key))
    } finally {
      if (!committed) {
        // Replacement/invalidation can happen inside a measuring callback. Requeue only entries
        // still owned by the current transcript, and never publish results from the old generation.
        for (const { key, estimate } of pending) {
          if (this.estimates.get(key) === estimate && !estimate.valid) this.dirty.add(key)
        }
      }
      this.schedule()
    }
  }
}
