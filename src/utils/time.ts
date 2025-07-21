const timeUnitsToSeconds: Record<string, number> = {
  y: 365 * 24 * 60 * 60,
  M: 30 * 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
  ms: 1e-3,
  us: 1e-6,
  ns: 1e-9
}

const longTimeUnits: Record<string, { singular: string; plural: string }> = {
  y: { singular: 'year', plural: 'years' },
  M: { singular: 'month', plural: 'months' },
  w: { singular: 'week', plural: 'weeks' },
  d: { singular: 'day', plural: 'days' },
  h: { singular: 'hour', plural: 'hours' },
  m: { singular: 'minute', plural: 'minutes' },
  s: { singular: 'second', plural: 'seconds' },
  ms: { singular: 'millisecond', plural: 'milliseconds' },
  us: { singular: 'microsecond', plural: 'microseconds' },
  ns: { singular: 'nanosecond', plural: 'nanoseconds' }
}

export function millifyTimedelta(
  timeSeconds: number,
  {
    precision = 's',
    maxUnits = 2,
    excludedUnits = [],
    long = false
  }: { precision?: string; maxUnits?: number; excludedUnits?: string[]; long?: boolean } = {}
): string {
  let seconds = timeSeconds
  if (seconds < 0) {
    return '-' + millifyTimedelta(-seconds, { precision, maxUnits, excludedUnits, long })
  } else if (seconds === 0) {
    return long ? '0 seconds' : '0s'
  }

  const excluded = new Set(excludedUnits)
  const timeChunks: string[] = []
  const units = Object.entries(timeUnitsToSeconds)
  let i = 0

  // Find where to stop (precision)
  for (; i < units.length; i++) {
    const [unit] = units[i]!
    if (unit === precision) break
    if (excluded.has(unit)) continue
    const unitSeconds = units[i]![1]
    if (seconds >= unitSeconds) {
      const value = Math.floor(seconds / unitSeconds)
      if (long) {
        const unitName = value === 1 ? longTimeUnits[unit]!.singular : longTimeUnits[unit]!.plural
        timeChunks.push(`${value} ${unitName}`)
      } else {
        timeChunks.push(`${value}${unit}`)
      }
      seconds %= unitSeconds
    }
    if (timeChunks.length >= maxUnits) break
  }

  if (timeChunks.length) {
    if (seconds > 0) {
      const value = Math.floor(seconds / (timeUnitsToSeconds[precision] ?? 1))
      if (long) {
        const unitName =
          value === 1 ? longTimeUnits[precision]!.singular : longTimeUnits[precision]!.plural
        timeChunks.push(`${value} ${unitName}`)
      } else {
        timeChunks.push(`${value}${precision}`)
      }
    }
    return timeChunks.slice(0, maxUnits).join(' ')
  } else if (seconds > (timeUnitsToSeconds[precision] ?? 1)) {
    const value = parseFloat(seconds.toFixed(2))
    if (long) {
      const unitName =
        value === 1.0 ? longTimeUnits[precision]!.singular : longTimeUnits[precision]!.plural
      return `${value} ${unitName}`
    }
    return `${value}${precision}`
  }

  // Continue iterating for sub-precision units
  for (; i < units.length; i++) {
    const [unit, unitSeconds] = units[i]!
    if (excluded.has(unit)) continue
    if (seconds >= unitSeconds) {
      const value = parseFloat((seconds / unitSeconds).toPrecision(3))
      if (long) {
        const unitName = value === 1.0 ? longTimeUnits[unit]!.singular : longTimeUnits[unit]!.plural
        return `${value} ${unitName}`
      }
      return `${value}${unit}`
    }
    if (unit === precision) break
  }

  if (long) {
    return `${seconds.toExponential(3)} seconds`
  }
  return `${seconds.toExponential(3)}s`
}
export class CurrentVideoTimeHistory {
  private history: { time: number; timestamp: number }[] = []
  private lastPredictedTime: number | null = null

  addSample(time: number): void {
    const now = Date.now()
    this.history.push({ time, timestamp: now })
    if (this.history.length > 2) this.history.shift()
  }

  clear(): void {
    this.history = []
    this.lastPredictedTime = null
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
