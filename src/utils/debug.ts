import { millifyTimedelta } from './time'

export async function logTime<T>(label: string, fn: () => T): Promise<Awaited<T>> {
  console.debug(label)
  const startTime = performance.now()
  try {
    return await fn()
  } finally {
    const endTime = performance.now()
    const duration = endTime - startTime
    console.debug(`${label}: ${millifyTimedelta(duration / 1000, { precision: 'ms' })}`)
  }
}
