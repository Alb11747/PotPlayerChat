export async function logTime<T>(label: string, fn: () => T): Promise<Awaited<T>> {
  console.debug(label)
  console.time(label)
  try {
    return await fn()
  } finally {
    console.timeEnd(label)
  }
}
