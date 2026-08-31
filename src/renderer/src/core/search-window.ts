import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@/core/chat/twitch-msg'
import {
  openPopupContext,
  PopupContextRegistry,
  type PopupWindowHost,
  takePopupContext
} from './popup-window'

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

export class SearchContextRegistry extends PopupContextRegistry<SearchContext> {}

export function openSearchPopup(
  context: SearchContext,
  hostWindow: PopupWindowHost = window,
  registry?: PopupContextRegistry<SearchContext>
): Window | null {
  return openPopupContext('search.html', context, 'search', hostWindow, registry)
}

export function takeSearchContext(searchWindow: Window = window): SearchContext | null {
  return takePopupContext<SearchContext>(searchWindow)
}
