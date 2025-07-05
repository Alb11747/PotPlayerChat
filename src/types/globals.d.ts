declare const tag: unique symbol

// Opaque pointer type for HWND
type HWND = {
  readonly [tag]: 'HWND'
}

export type { HWND }
