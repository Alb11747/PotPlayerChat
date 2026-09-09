type PopupContextEntry<T> = {
  context: T
  timeoutId: ReturnType<typeof setTimeout>
}

export class PopupContextRegistry<T> {
  private readonly contexts = new Map<string, PopupContextEntry<T>>()

  constructor(private readonly timeoutMs: number = 60_000) {}

  register(context: T, token: string = crypto.randomUUID()): string {
    this.discard(token)
    const timeoutId = setTimeout(() => this.contexts.delete(token), this.timeoutMs)
    this.contexts.set(token, { context, timeoutId })
    return token
  }

  take(token: string): T | null {
    const entry = this.contexts.get(token)
    if (!entry) return null
    clearTimeout(entry.timeoutId)
    this.contexts.delete(token)
    return entry.context
  }

  discard(token: string): boolean {
    const entry = this.contexts.get(token)
    if (!entry) return false
    clearTimeout(entry.timeoutId)
    return this.contexts.delete(token)
  }
}

type PopupContextProvider = {
  takeContext: (token: string) => unknown | null
}

export type PopupWindowHost = Pick<Window, 'location' | 'open'> & {
  potPlayerChatPopup?: PopupContextProvider
}

declare global {
  interface Window {
    potPlayerChatPopup?: PopupContextProvider
  }
}

const popupContextRegistry = new PopupContextRegistry<unknown>()

function exposePopupContextProvider(
  hostWindow: PopupWindowHost,
  registry: PopupContextRegistry<unknown>
): void {
  Object.defineProperty(hostWindow, 'potPlayerChatPopup', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      takeContext: (token: string) => registry.take(token)
    })
  })
}

export function openPopupContext<T>(
  page: 'search.html' | 'user.html' | 'preview.html',
  context: T,
  label: string,
  hostWindow: PopupWindowHost = window,
  registry: PopupContextRegistry<T> = popupContextRegistry as PopupContextRegistry<T>
): Window | null {
  exposePopupContextProvider(hostWindow, registry as PopupContextRegistry<unknown>)

  const token = registry.register(context)
  const popupUrl = new URL(page, hostWindow.location.href)
  popupUrl.hash = token

  const popupWindow = hostWindow.open(popupUrl.href, '_blank')
  if (!popupWindow) {
    registry.discard(token)
    console.error(`Failed to open the ${label} window`)
  }
  return popupWindow
}

export function takePopupContext<T>(popupWindow: Window = window): T | null {
  const token = popupWindow.location.hash.slice(1)
  const opener = popupWindow.opener as Window | null
  if (!token || !opener) return null

  try {
    return (opener.potPlayerChatPopup?.takeContext(token) as T | null | undefined) ?? null
  } catch (error) {
    console.error('Failed to access the popup context:', error)
    return null
  }
}
