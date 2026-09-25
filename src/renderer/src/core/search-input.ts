/** Keep native editing available while the heavier Search module is loading. */
export function prepareSearchInput(
  input: HTMLInputElement,
  initialValue: string
): {
  finishComposition(): Promise<void>
  dispose(): void
} {
  let composing = false
  const startComposition = (): void => {
    composing = true
  }
  const endComposition = (): void => {
    composing = false
  }
  input.addEventListener('compositionstart', startComposition)
  input.addEventListener('compositionend', endComposition)
  // Autofocus can run before this entry module. Never overwrite an early edit.
  if (input.value === input.defaultValue) input.value = initialValue
  if (document.activeElement === document.body) input.focus({ preventScroll: true })

  return {
    async finishComposition(): Promise<void> {
      while (composing) {
        await new Promise<void>((resolve) => {
          input.addEventListener(
            'compositionend',
            () => {
              // The final input event can follow compositionend in the same task.
              setTimeout(resolve, 0)
            },
            { once: true }
          )
        })
      }
    },
    dispose(): void {
      input.removeEventListener('compositionstart', startComposition)
      input.removeEventListener('compositionend', endComposition)
    }
  }
}
