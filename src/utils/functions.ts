export function debounce<T extends (...args: Parameters<T>) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return function (this: ThisType<T>, ...args: Parameters<T>) {
    if (timeout !== null) clearTimeout(timeout)
    timeout = setTimeout(() => {
      func.apply(this, args)
      timeout = null
    }, wait)
  }
}
