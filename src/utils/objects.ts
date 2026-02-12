import isDeepEqual from 'fast-deep-equal/es6'

export class NumberObject extends Number {
  constructor(private value: number) {
    super(value)
  }

  override valueOf(): number {
    return this.value
  }

  public setValue(value: number): void {
    this.value = value
  }

  static ensureObject(value: number | NumberObject): NumberObject {
    if (value instanceof NumberObject) return value
    return new NumberObject(value)
  }
}

export function isEqual<T>(a: T, b: T): boolean {
  return isDeepEqual(a, b)
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

export function isObjectClass(obj: unknown, className: string): boolean {
  if (obj === null || typeof obj !== 'object') return false
  const proto = Object.getPrototypeOf(obj)
  const ctor =
    (proto && typeof proto.constructor === 'function' ? proto.constructor : null) ||
    ('constructor' in obj && typeof (obj as { constructor?: unknown }).constructor === 'function'
      ? (obj as { constructor: { name?: unknown } }).constructor
      : null)
  return !!ctor && typeof ctor.name === 'string' && ctor.name === className
}
