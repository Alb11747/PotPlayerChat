import type { UsernameClickInfo } from './username-click'
import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import type { TwitchMessage } from '@/core/chat/twitch-msg'
import type { SearchTextCache } from './search-messages'
import { SharedSearchDataCache } from './search-data'
import type { SearchPreview } from './search-preview'
import { capturePopupSearchRange } from './popup-search-range'
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

export interface SharedSearchData {
  readonly textCache: SearchTextCache
  prepare(
    initial: readonly TwitchMessage[],
    loaded: readonly TwitchMessage[],
    signal?: AbortSignal
  ): Promise<readonly TwitchMessage[]>
}

export type SearchContext = SearchOptions & {
  preview?: SearchPreview
  initialMessages: readonly TwitchMessage[]
  loadedMessages: readonly TwitchMessage[]
  sharedData?: SharedSearchData
  focusMessage: (message: TwitchMessage) => void
  onUsernameClick: (info: UsernameClickInfo) => void
}

export class SearchContextRegistry extends PopupContextRegistry<SearchContext> {}

const defaultSharedData = new SharedSearchDataCache()

export function openSearchPopup(
  context: SearchContext,
  hostWindow: PopupWindowHost = window,
  registry?: PopupContextRegistry<SearchContext>
): Window | null {
  context.sharedData ??= defaultSharedData
  context.searchRange = capturePopupSearchRange(context)
  return openPopupContext('search.html', context, 'search', hostWindow, registry)
}

export function takeSearchContext(searchWindow: Window = window): SearchContext | null {
  return takePopupContext<SearchContext>(searchWindow)
}
