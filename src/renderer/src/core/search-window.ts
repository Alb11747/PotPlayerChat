import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@/core/chat/twitch-msg'

export type SearchOptions = {
  potplayerInfo: PotPlayerInfo
  focusedMessage?: TwitchMessage
  initialSearch?: string
  searchRange?: {
    startTime: number
    endTime: number
  }
}

export type SearchContext = SearchOptions & {
  initialMessages: TwitchMessage[]
  loadedMessages: TwitchMessage[]
  focusMessage: (message: TwitchMessage) => void
}

type SearchContextEntry = {
  context: SearchContext
  timeoutId: ReturnType<typeof setTimeout>
}

export class SearchContextRegistry {
  private readonly contexts = new Map<string, SearchContextEntry>()

  constructor(private readonly timeoutMs: number = 60_000) {}

  register(context: SearchContext, token: string = crypto.randomUUID()): string {
    this.discard(token)
    const timeoutId = setTimeout(() => this.contexts.delete(token), this.timeoutMs)
    this.contexts.set(token, { context, timeoutId })
    return token
  }

  take(token: string): SearchContext | null {
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

type SearchContextProvider = {
  takeContext: (token: string) => SearchContext | null
}

type SearchWindowHost = Pick<Window, 'location' | 'open'> & {
  potPlayerChatSearch?: SearchContextProvider
}

declare global {
  interface Window {
    potPlayerChatSearch?: SearchContextProvider
  }
}

const searchContextRegistry = new SearchContextRegistry()

function exposeSearchContextProvider(
  hostWindow: SearchWindowHost,
  registry: SearchContextRegistry
): void {
  Object.defineProperty(hostWindow, 'potPlayerChatSearch', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      takeContext: (token: string) => registry.take(token)
    })
  })
}

export function openSearchPopup(
  context: SearchContext,
  hostWindow: SearchWindowHost = window,
  registry: SearchContextRegistry = searchContextRegistry
): Window | null {
  exposeSearchContextProvider(hostWindow, registry)

  const token = registry.register(context)
  const searchUrl = new URL('search.html', hostWindow.location.href)
  searchUrl.hash = token

  const searchWindow = hostWindow.open(searchUrl.href, '_blank')
  if (!searchWindow) {
    registry.discard(token)
    console.error('Failed to open the search window')
  }
  return searchWindow
}

export function takeSearchContext(searchWindow: Window = window): SearchContext | null {
  const token = searchWindow.location.hash.slice(1)
  const opener = searchWindow.opener as Window | null
  if (!token || !opener) return null

  try {
    return opener.potPlayerChatSearch?.takeContext(token) ?? null
  } catch (error) {
    console.error('Failed to access the search context:', error)
    return null
  }
}
