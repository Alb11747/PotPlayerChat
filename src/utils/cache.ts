export interface MutableConfigStore extends Iterable<[PropertyKey, unknown]> {
  delete(key: string): unknown
}

export function clearConfigEntriesByPrefix(config: MutableConfigStore, prefix: string): string[] {
  const keys = Array.from(config, ([key]) => String(key)).filter((key) => key.startsWith(prefix))
  for (const key of keys) config.delete(key)
  return keys
}
