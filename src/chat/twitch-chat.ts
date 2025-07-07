import { getMessagesBetween, getMessagesForTime } from '@/chat/chat'
import type { WindowApi } from '@/preload/types/index.d.ts'
import type { HWND } from '@/types/globals'
import { JustLogAPI } from './justlog'
import type { TwitchMessage } from './twitch-msg'

export interface ChatSettings {
  getJustlogUrl: () => string
  getChatMessageLimit: () => number
}

// A placeholder for settings
const settings: ChatSettings = {
  getJustlogUrl: () => 'https://justlog.alb11747.com',
  getChatMessageLimit: () => 200
}

export interface PotPlayerInfo {
  hwnd: HWND
  channel: string
  title: string
  startTime: number
}

export interface LoadingState {
  state: 'idle' | 'loading' | 'loaded' | 'error' | 'channel-not-found'
  errorMessage: string
}

export class ChatService {
  private api: WindowApi
  private justLogApi: JustLogAPI
  public lastPotPlayerInfo: PotPlayerInfo | null = null

  private currentChatData: TwitchMessage[] = []

  // Caching chat data per day
  private chatCache: Record<string, { messages: TwitchMessage[]; complete: boolean }> = {}

  // state for UI
  public state: LoadingState

  constructor(api: WindowApi, state: LoadingState) {
    this.api = api
    this.state = state

    this.justLogApi = new JustLogAPI()
  }

  public async updateVideoInfo(newPotPlayerInfo: PotPlayerInfo): Promise<void> {
    if (this.lastPotPlayerInfo === newPotPlayerInfo) return

    this.lastPotPlayerInfo = { ...newPotPlayerInfo }
    this.currentChatData = []
    this.state.state = 'idle'
    this.state.errorMessage = ''

    await this.loadChat()
  }

  async loadChat(): Promise<void> {
    if (!this.lastPotPlayerInfo) {
      this.state.state = 'idle'
      this.state.errorMessage = 'No PotPlayer info available for chat loading.'
      console.warn('No PotPlayer info available for chat loading.')
      return
    }

    try {
      const { hwnd, channel, startTime: videoStartTime } = this.lastPotPlayerInfo

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

      const today = new Date()
      const isSameUTCDate = (d1: Date, d2: Date): boolean =>
        d1.getUTCFullYear() === d2.getUTCFullYear() &&
        d1.getUTCMonth() === d2.getUTCMonth() &&
        d1.getUTCDate() === d2.getUTCDate()
      const isMsgEqual = (msg1: TwitchMessage, msg2: TwitchMessage): boolean => {
        if (msg1.id || msg2.id) return msg1.id === msg2.id
        return (
          msg1.timestamp === msg2.timestamp &&
          msg1.channel === msg2.channel &&
          msg1.username === msg2.username &&
          msg1.message === msg2.message
        )
      }

      const fetchPromises = datesToFetch.map(async (date: Date): Promise<TwitchMessage[]> => {
        const year = date.getUTCFullYear()
        const month = date.getUTCMonth() + 1
        const day = date.getUTCDate()
        const cacheKey = `${channel}:${year}-${month}-${day}`
        const cached = this.chatCache[cacheKey]
        let cachedMessages: TwitchMessage[] | null = null
        let lastTimestamp: number | null = null
        if (cached) {
          cachedMessages = cached.messages
          lastTimestamp =
            cachedMessages.length > 0 ? cachedMessages[cachedMessages.length - 1].timestamp : null
        }

        if (cachedMessages !== null && cached.complete) {
          return cachedMessages
        }

        try {
          // Check for new data if the cached data is incomplete (fetched on the same day)
          const complete = !isSameUTCDate(date, today)

          this.justLogApi.baseApiUrl = settings.getJustlogUrl()
          console.debug(`Fetching chat for ${channel} on ${year}/${month}/${day}`)
          const timeLabel = `Fetched chat data for ${channel} on ${year}/${month}/${day}`
          console.time(timeLabel)
          const data = await this.justLogApi.getChannelLogsByDate({
            channelStr: channel,
            year,
            month,
            day
          })
          console.timeEnd(timeLabel)
          if (data == null) {
            console.warn(`Failed to fetch chat for ${year}/${month}/${day}`)
            return cachedMessages || []
          }

          const newMessages = data.messages
          let messages: TwitchMessage[]
          if (cachedMessages && lastTimestamp !== null) {
            const filteredNew = newMessages.filter((msg) => msg.timestamp > lastTimestamp)

            // If there are new messages with the same timestamp as the last cached message,
            // we need to ensure we don't duplicate them
            let overlappedNew = newMessages.filter((msg) => msg.timestamp === lastTimestamp)
            if (overlappedNew.length > 0) {
              const overlappedOld = cachedMessages.filter((msg) => msg.timestamp === lastTimestamp)
              // Remove old messages with the same timestamp
              overlappedNew = overlappedNew.filter(
                (msg) => !overlappedOld.some((oldMsg) => isMsgEqual(msg, oldMsg))
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

  public getMessagesAroundTime(
    currentVideoTime: number,
    beforeTime: number,
    afterTime: number
  ): TwitchMessage[] {
    if (this.lastPotPlayerInfo === null) {
      return []
    }
    const startTime = this.lastPotPlayerInfo.startTime + currentVideoTime - beforeTime
    const endTime = this.lastPotPlayerInfo.startTime + currentVideoTime + afterTime
    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesForTime(
    currentVideoTime: number,
    next?: boolean
  ): Promise<TwitchMessage[]> {
    if (this.lastPotPlayerInfo === null) {
      return []
    }

    return getMessagesForTime(
      this.currentChatData,
      this.lastPotPlayerInfo.startTime + currentVideoTime,
      settings.getChatMessageLimit(),
      next
    )
  }
}
