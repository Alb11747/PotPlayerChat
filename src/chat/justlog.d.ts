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

export interface ChatMessage {
  channel: string
  displayName: string
  id: string
  raw: string
  tags: Record<string, string>
  text: string
  timestamp: string
  type: number // MessageType
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

export interface ChatLog {
  messages: ChatMessage[]
}

export interface LogList {
  availableLogs: UserLogFile[]
}
