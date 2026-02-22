import lodashDebounce from 'lodash.debounce'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DebouncedFunc<T extends (...args: any) => unknown> = ReturnType<
  typeof lodashDebounce<T>
>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any) => unknown>(
  func: T,
  wait: number
): DebouncedFunc<T> {
  return lodashDebounce(function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    return func.apply(this, args)
  }, wait)
}
