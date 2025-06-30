import type { WindowApi } from '@/preload/types/index.d.ts'
import { getMessagesForTime } from '@/chat/chat'

export interface TwitchChatMessage {
  timestamp: number
  username: string
  message: string

  id: string
  userColor: string
}

export interface ChatSettings {
  getJustlogUrl: () => string
  getChatMessageLimit: () => number
}

// A placeholder for settings
const settings: ChatSettings = {
  getJustlogUrl: () => 'https://justlog.alb11747.com',
  getChatMessageLimit: () => 25
}

export interface PotPlayerInfo {
  hwnd: HWND
  channel: string
  videoName: string
  videoStartTime: number
}

export interface LoadingState {
  state: 'idle' | 'loading' | 'loaded' | 'error' | 'channel-not-found'
  errorMessage: string
}

export class ChatService {
  private api: WindowApi
  private lastPotPlayerInfo: PotPlayerInfo | null = null

  private currentChatData: TwitchChatMessage[] = []

  // Caching chat data per day
  private chatCache: Record<string, { messages: TwitchChatMessage[]; complete: boolean }> = {}

  // state for UI
  public state: LoadingState

  constructor(api: WindowApi, state: LoadingState) {
    this.api = api
    this.state = state
  }

  public updateVideoInfo(newPotPlayerInfo: PotPlayerInfo): void {
    if (this.lastPotPlayerInfo === newPotPlayerInfo) return

    this.lastPotPlayerInfo = { ...newPotPlayerInfo }
    this.currentChatData = []
    this.state.state = 'idle'
    this.state.errorMessage = ''

    this.loadChat()
  }

  async loadChat(): Promise<void> {
    if (!this.lastPotPlayerInfo) {
      this.state.state = 'idle'
      this.state.errorMessage = 'No PotPlayer info available for chat loading.'
      console.warn('No PotPlayer info available for chat loading.')
      return
    }

    try {
      const { hwnd, channel, videoStartTime } = this.lastPotPlayerInfo

      const datePadding = 8 * 60 * 60 * 1000 // 8 hours in milliseconds
      const startDate = new Date(videoStartTime - datePadding)
      const endDate = new Date(videoStartTime + (await this.api.getTotalTime(hwnd)) + datePadding)

      const datesToFetch: Date[] = []
      const currentDate = new Date(startDate)
      while (currentDate <= endDate) {
        datesToFetch.push(new Date(currentDate))
        currentDate.setUTCDate(currentDate.getUTCDate() + 1)
      }
      if (datesToFetch[datesToFetch.length - 1].getUTCDate() !== endDate.getUTCDate()) {
        datesToFetch.push(new Date(currentDate))
      }

      const baseJustlogUrl = settings.getJustlogUrl()

      const today = new Date()
      const isSameUTCDate = (d1: Date, d2: Date): boolean =>
        d1.getUTCFullYear() === d2.getUTCFullYear() &&
        d1.getUTCMonth() === d2.getUTCMonth() &&
        d1.getUTCDate() === d2.getUTCDate()

      const fetchPromises = datesToFetch.map(async (date: Date): Promise<TwitchChatMessage[]> => {
        const year = date.getUTCFullYear()
        const month = date.getUTCMonth() + 1
        const day = date.getUTCDate()
        const cacheKey = `${channel}:${year}-${month}-${day}`
        const cached = this.chatCache[cacheKey]
        let cachedMessages: TwitchChatMessage[] | null = null
        let lastTimestamp: number | null = null
        if (cached) {
          cachedMessages = cached.messages
          lastTimestamp =
            cachedMessages.length > 0 ? cachedMessages[cachedMessages.length - 1].timestamp : null
        }

        if (cachedMessages !== null && cached.complete) {
          return cachedMessages
        }

        // Check for new data if the cached data is incomplete (fetched on the same day)

        const complete = !isSameUTCDate(date, today)
        let justlogUrl = `${baseJustlogUrl}/channel/${encodeURIComponent(channel)}/${year}/${month}/${day}?raw`
        if (lastTimestamp !== null) justlogUrl += `&from=${lastTimestamp}`

        console.debug(`Fetching chat data from: ${justlogUrl}`)
        try {
          const response = await window.fetch(justlogUrl)
          if (response.ok) {
            const data = await response.text()
            const newMessages = this.parseChatData(data)
            let messages: TwitchChatMessage[]
            if (cachedMessages && lastTimestamp !== null) {
              const filteredNew = newMessages.filter((msg) => msg.timestamp > lastTimestamp)

              // If there are new messages with the same timestamp as the last cached message,
              // we need to ensure we don't duplicate them
              let overlappedNew = newMessages.filter((msg) => msg.timestamp === lastTimestamp)
              if (overlappedNew.length > 0) {
                const overlappedOld = cachedMessages.filter(
                  (msg) => msg.timestamp === lastTimestamp
                )
                // Remove old messages with the same timestamp
                overlappedNew = overlappedNew.filter(
                  (msg) => !overlappedOld.some((oldMsg) => oldMsg.id === msg.id)
                )
              }

              messages = [...cachedMessages, ...overlappedNew, ...filteredNew]
              console.debug(
                `Fetched ${filteredNew.length} new lines from ${year}/${month}/${day} (total: ${messages.length})`
              )
            } else {
              messages = newMessages
              console.debug(`Fetched ${newMessages.length} lines from ${year}/${month}/${day}`)
            }
            this.chatCache[cacheKey] = { messages, complete }
            return messages
          } else if (response.status === 404) {
            console.log(`No chat data found for ${year}/${month}/${day}`)
            this.chatCache[cacheKey] = { messages: [], complete: false }
            return []
          } else {
            console.warn(`Failed to fetch chat for ${year}/${month}/${day}: ${response.status}`)
            return cachedMessages || []
          }
        } catch (error) {
          console.warn(`Error fetching chat for ${year}/${month}/${day}:`, error)
          return cachedMessages || []
        }
      })

      this.state.state = 'loading'
      console.debug(`Loading chat for ${channel} starting from ${new Date(videoStartTime)}`)
      const chatDataArrays = await Promise.all(fetchPromises)
      const allMessages = chatDataArrays.flat().sort((a, b) => a.timestamp - b.timestamp)

      this.currentChatData = allMessages
      this.state.state = 'loaded'
      console.debug(
        `Loaded ${this.currentChatData.length} chat messages for ${channel} across ${datesToFetch.length} day(s)`
      )
    } catch (error: unknown) {
      console.error('Error loading chat:', error)
      this.state.state = 'error'
      if (error && typeof error === 'object' && 'message' in error) {
        this.state.errorMessage = `Failed to load chat: ${(error as { message: string }).message}`
      } else {
        this.state.errorMessage = 'Failed to load chat: Unknown error'
      }
    }
  }

  private parseChatData(rawData: string): TwitchChatMessage[] {
    const lines = rawData.split('\n')
    const messages: TwitchChatMessage[] = []

    for (const line of lines) {
      if (line.trim() === '') continue

      try {
        // Parse Twitch IRC format
        // Example: @badge-info=subscriber/8;badges=subscriber/6;client-nonce=abc123;color=#FF69B4;display-name=Username;emotes=;first-msg=0;flags=;id=12345678-1234-1234-1234-123456789012;mod=0;returning-chatter=0;room-id=12345678;subscriber=1;tmi-sent-ts=1698765432123;turbo=0;user-id=87654321;user-type= :username!username@username.tmi.twitch.tv PRIVMSG #channelname :Hello world!

        const tmiMatch = line.match(/tmi-sent-ts=(\d+)/)
        const usernameMatch = line.match(/display-name=([^;]*)/)
        const messageMatch = line.match(/PRIVMSG #\w+ :(.+)$/)
        const idMatch = line.match(/id=([a-zA-Z0-9-]+)/)
        const colorMatch = line.match(/color=(#[A-Fa-f0-9]{6}|)/)

        if (tmiMatch && messageMatch) {
          const timestamp = parseInt(tmiMatch[1])
          const message = messageMatch[1]
          const username = usernameMatch ? usernameMatch[1] : 'Unknown'
          const color = colorMatch && colorMatch[1] ? colorMatch[1] : '#FFFFFF'
          const id = idMatch ? idMatch[1] : `${username}-${timestamp}`

          messages.push({
            timestamp: timestamp,
            username: username,
            message: message,
            id: `tw-${id}`,
            userColor: color
          })
        }
      } catch (parseError) {
        console.warn('Failed to parse chat line:', line, parseError)
      }
    }

    // Sort messages by timestamp
    return messages.sort((a, b) => a.timestamp - b.timestamp)
  }

  public async getMessagesForTime(currentVideoTime: number): Promise<TwitchChatMessage[]> {
    if (this.lastPotPlayerInfo === null) {
      return []
    }

    return getMessagesForTime(
      this.currentChatData,
      this.lastPotPlayerInfo.videoStartTime + currentVideoTime,
      settings.getChatMessageLimit()
    )
  }
}
