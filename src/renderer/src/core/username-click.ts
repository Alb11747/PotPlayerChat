import type { TwitchMessage } from '@/core/chat/twitch-msg'

export type UsernameClickInfo = {
  username: string
  message: TwitchMessage
  altKey: boolean
}

export type UsernameClickAction = { kind: 'search'; initialSearch: string } | { kind: 'user' }

export function getUsernameClickAction(username: string, altKey: boolean): UsernameClickAction {
  return altKey ? { kind: 'search', initialSearch: username } : { kind: 'user' }
}
