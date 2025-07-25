export function isEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  const keysA = Object.keys(a) as (keyof T)[]
  const keysB = Object.keys(b) as (keyof T)[]
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) if (!keysB.includes(key) || !isEqual(a[key], b[key])) return false
  return true
}

export function validatePropertiesExist(data: unknown, properties: string[]): boolean {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return properties.every((prop) => prop in d && d[prop] !== undefined && d[prop] !== null)
}

export function isSorted<T>(array: T[], compareFn: (a: T, b: T) => number): boolean {
  for (let i = 1; i < array.length; i++) {
    if (compareFn(array[i - 1]!, array[i]!) > 0) return false
  }
  return true
}

export function deleteNullishKeysInPlace<
  T extends Record<K, unknown>,
  K extends string | number | symbol
>(obj: T): Partial<T> {
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) delete obj[key as K]
  }
  return obj
}
