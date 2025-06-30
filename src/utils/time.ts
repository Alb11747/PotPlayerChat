export class CurrentVideoTimeHistory {
  private history: { time: number; timestamp: number }[] = []

  addSample(time: number): void {
    const now = Date.now()
    this.history.push({ time, timestamp: now })
    if (this.history.length > 2) this.history.shift()
  }

  getPredictedCurrentVideoTime(): number | null {
    if (this.history.length === 0) return null
    if (this.history.length === 1) return this.history[0].time
    const [prev, curr] = this.history
    const dt = curr.timestamp - prev.timestamp
    if (dt === 0) return curr.time
    const dv = curr.time - prev.time
    const rate = dv / dt

    // If time jumps backward or is >32x real time, just return the most recent sample
    if (dv < 0 || Math.abs(rate) > 32) return curr.time

    const now = Date.now()
    const futureDt = now - curr.timestamp
    return curr.time + rate * futureDt
  }
}
