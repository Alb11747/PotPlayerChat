import type { UsernameClickInfo } from './username-click'
import type { PotPlayerInfo } from '@/core/chat/twitch-chat'
import { TwitchChatMessage, type TwitchMessage } from '@/core/chat/twitch-msg'
import {
  openPopupContext,
  PopupContextRegistry,
  type PopupWindowHost,
  takePopupContext
} from './popup-window'

export type UserWindowContext = {
  username: string
  clickedMessage: TwitchMessage
  potplayerInfo: PotPlayerInfo
  initialMessages: TwitchMessage[]
  loadedMessages: TwitchMessage[]
  focusMessage: (message: TwitchMessage) => void
  onUsernameClick: (info: UsernameClickInfo) => void
  searchUsername: (username: string) => void
  searchRange?: {
    startTime: number
    endTime: number
  }
}

export class UserContextRegistry extends PopupContextRegistry<UserWindowContext> {}

export function openUserPopup(
  context: UserWindowContext,
  hostWindow: PopupWindowHost = window,
  registry?: PopupContextRegistry<UserWindowContext>
): Window | null {
  return openPopupContext('user.html', context, 'user', hostWindow, registry)
}

export function takeUserContext(userWindow: Window = window): UserWindowContext | null {
  return takePopupContext<UserWindowContext>(userWindow)
}

export function isMessageFromUser(
  message: TwitchMessage,
  username: string
): message is TwitchChatMessage {
  return message.type === 'chat' && message.username.toLowerCase() === username.toLowerCase()
}

export function getMessagesFromUser(
  messages: TwitchMessage[],
  username: string
): TwitchChatMessage[] {
  return messages.filter((message) => isMessageFromUser(message, username))
}
