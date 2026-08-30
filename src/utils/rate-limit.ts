interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export interface RateLimiterClock {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void
}

const systemClock: RateLimiterClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timeout) => clearTimeout(timeout)
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * Runs immediately when eligible and coalesces every request made during the
 * cooldown or active callback into one trailing run.
 */
export class TrailingRateLimiter<T> {
  private readonly clock: RateLimiterClock
  private nextAllowedAt = Number.NEGATIVE_INFINITY
  private running = false
  private timeout: ReturnType<typeof setTimeout> | null = null
  private queued: Deferred<T> | null = null

  public constructor(
    private readonly cooldownMs: number,
    private readonly callback: () => Promise<T>,
    clock: RateLimiterClock = systemClock
  ) {
    this.clock = clock
  }

  public request(): Promise<T> {
    if (!this.running && !this.timeout && this.clock.now() >= this.nextAllowedAt) {
      return this.startRun()
    }

    if (!this.queued) this.queued = createDeferred<T>()
    this.scheduleTrailingRun()
    return this.queued.promise
  }

  private startRun(deferred?: Deferred<T>): Promise<T> {
    this.running = true
    this.nextAllowedAt = this.clock.now() + this.cooldownMs

    const runPromise = Promise.resolve().then(this.callback)
    void runPromise.then(
      (value) => {
        deferred?.resolve(value)
        this.finishRun()
      },
      (error: unknown) => {
        deferred?.reject(error)
        this.finishRun()
      }
    )
    return deferred?.promise ?? runPromise
  }

  private finishRun(): void {
    this.running = false
    if (this.queued) this.scheduleTrailingRun()
  }

  private scheduleTrailingRun(): void {
    if (this.running || this.timeout || !this.queued) return

    const delayMs = Math.max(0, this.nextAllowedAt - this.clock.now())
    this.timeout = this.clock.setTimeout(() => {
      this.timeout = null
      if (this.running || !this.queued) {
        this.scheduleTrailingRun()
        return
      }
      if (this.clock.now() < this.nextAllowedAt) {
        this.scheduleTrailingRun()
        return
      }

      const queued = this.queued
      this.queued = null
      this.startRun(queued)
    }, delayMs)
  }
}
