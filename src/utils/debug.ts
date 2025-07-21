import { millifyTimedelta } from './time'

export async function logTime<T>(label: string, fn: () => T): Promise<Awaited<T>> {
  console.debug(label)
  const now = new Date().getTime()
  const start = performance.mark(`${label}-start-${now}`)
  try {
    return await fn()
  } finally {
    const end = performance.mark(`${label}-end-${now}`)
    const duration = performance.measure(label, start.name, end.name)
    console.debug(`${label}: ${millifyTimedelta(duration.duration / 1000, { precision: 'ms' })}`)
  }
}
