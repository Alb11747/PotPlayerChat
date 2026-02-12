import lodashDebounce from 'lodash.debounce'

export function debounce<T extends (...args: Parameters<T>) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  return lodashDebounce(function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    func.apply(this, args)
  }, wait)
}
