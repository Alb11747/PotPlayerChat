import type { TwitchMessage } from '@/core/chat/twitch-msg'

export type UsernameToIdFunc = (username: string) => Promise<string | null>

export interface Channel {
  name: string
  userID: string
}

export interface ChannelLogFile {
  day: number
  month: number
  year: number
}

export interface UserLogFile {
  month: number
  year: number
}

export interface JustLogChatMessage {
  channel: string
  displayName: string
  id: string
  raw: string
  systemText?: string
  tags: Record<string, string>
  text: string
  timestamp: string
  type: number // 1 for message, 2 for system message
  username: string
}

export interface AllChannelsJSON {
  channels: Channel[]
}

export interface ChannelConfigsJoinRequest {
  channels: string[] // List of UserIDs
}

export interface ChannelLogList {
  availableLogs: ChannelLogFile[]
}

export interface UserLogList {
  availableLogs: UserLogFile[]
}

export interface ChannelsDeleteRequest {
  channels: string[] // List of UserIDs
}

export interface JustLogChatLog {
  messages: JustLogChatMessage[]
}

export interface ChatLog {
  messages: TwitchMessage[]
}

export interface LogList {
  availableLogs: UserLogFile[]
}
