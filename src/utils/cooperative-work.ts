/** Keep large renderer preparation interruptible without allocating a promise for every row. */
export class CooperativeWork {
  private deadline = performance.now() + 4

  constructor(private readonly signal?: AbortSignal) {}

  throwIfAborted(): void {
    this.signal?.throwIfAborted()
  }

  checkpoint(): Promise<void> | undefined {
    this.throwIfAborted()
    if (performance.now() < this.deadline) return
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      this.throwIfAborted()
      this.deadline = performance.now() + 4
    })
  }
}
