export function updateArray<T>(array: T[], newItems: T[]): void {
  const oldLen = array.length
  const newLen = newItems.length
  let start = 0
  let endOld = oldLen - 1
  let endNew = newLen - 1

  // Find common prefix
  while (start <= endOld && start <= endNew && array[start] === newItems[start]) {
    start++
  }
  if (start > endOld && start > endNew) return // Everything is the same

  // Find common suffix
  while (endOld >= start && endNew >= start && array[endOld] === newItems[endNew]) {
    endOld--
    endNew--
  }

  // Slice the array to keep only the common part
  array.splice(start, endOld - start + 1, ...newItems.slice(start, endNew + 1))
}

export function updateCache<K extends string | number | symbol, V>(
  cache: Record<K, V | null>,
  key: K,
  data: V,
  collisionMsg?: string
): void {
  const existing = cache[key]
  if (existing) {
    if (existing === data) return
    if (collisionMsg) console.warn(collisionMsg, key, existing, data)
    cache[key] = null
  } else if (existing !== null) {
    cache[key] = data
  }
}
