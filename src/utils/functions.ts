import lodashDebounce from 'lodash.debounce'

export type DebouncedFunc<T extends (...args: unknown[]) => unknown> = ReturnType<
  typeof lodashDebounce<T>
>

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): DebouncedFunc<T> {
  return lodashDebounce(function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    func.apply(this, args)
  }, wait)
}
