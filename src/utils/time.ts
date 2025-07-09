export class CurrentVideoTimeHistory {
  private history: { time: number; timestamp: number }[] = []
  private lastPredictedTime: number | null = null

  addSample(time: number): void {
    const now = Date.now()
    this.history.push({ time, timestamp: now })
    if (this.history.length > 2) this.history.shift()
  }

  getPredictedRate(): number | null {
    const history = this.history
    const prev = history[history.length - 2]
    const curr = history[history.length - 1]
    if (!prev || !curr) return null
    const dt = curr.timestamp - prev.timestamp
    return dt === 0 ? null : (curr.time - prev.time) / dt
  }

  getPredictedCurrentVideoTime(): number | null {
    const history = this.history
    if (history.length === 0) return null
    if (history.length === 1) return history[0]?.time ?? null
    const rate = this.getPredictedRate()
    const curr = history[history.length - 1]
    if (!curr) return null
    if (rate === null) return curr.time

    // If time jumps backward, is paused, or, is >32x real time, just return the most recent sample
    if (rate <= 0 || Math.abs(rate) > 32) {
      this.lastPredictedTime = null
      return curr.time
    }

    const now = Date.now()
    const futureDt = now - curr.timestamp
    const predictedTime = curr.time + rate * futureDt

    // Prevent erratic backward jumps in predicted time
    if (
      this.lastPredictedTime !== null &&
      this.lastPredictedTime > predictedTime &&
      this.lastPredictedTime - predictedTime < 2000
    ) {
      return this.lastPredictedTime
    }

    this.lastPredictedTime = predictedTime
    return predictedTime
  }

  getPredictedTimeUntil(timestamp: number): number | null {
    const currentTime = this.getPredictedCurrentVideoTime()
    if (currentTime === null) return null
    const dt = timestamp - currentTime
    if (dt < 0) return 0
    const rate = this.getPredictedRate()
    if (rate === null || rate <= 0) return null
    return dt / rate
  }
}
