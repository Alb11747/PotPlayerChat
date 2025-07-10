import { getMessagesBetween, getMessagesForTime } from '@core/chat/chat'
import type { WindowApi } from '@/preload/types/index.d.ts'
import type { HWND } from '@/types/globals'
import { JustLogAPI } from './justlog'
import type { TwitchMessage } from './twitch-msg'
import AsyncLock from 'async-lock'

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
  endTime?: number
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
  private lastPrefetchRange: {
    channel: string
    startTime: number
    endTime: number
  } | null = null

  // Lock to prevent concurrent fetches for the same cache key
  private fetchLock = new AsyncLock()

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
    this.state.state = 'loading'
    this.state.errorMessage = ''

    // Delay loading to allow prefetching
    setTimeout(this.loadChat.bind(this), 1000)
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

      const datePadding = 1 * 60 * 60 * 1000 // 1 hour in milliseconds
      const startDate = new Date(videoStartTime - datePadding)
      const endDate = new Date(videoStartTime + (await this.api.getTotalTime(hwnd)) + datePadding)

      const datesToFetch: Date[] = this.generateDatesInRange(startDate, endDate)
      const fetchPromises = datesToFetch.map(async (date: Date): Promise<TwitchMessage[]> => {
        const cacheKey = this.getCacheKey(channel, date)
        const year = date.getUTCFullYear()
        const month = date.getUTCMonth() + 1
        const day = date.getUTCDate()

        return await this.fetchLock.acquire(cacheKey, async () => {
          const cached = this.chatCache[cacheKey]
          let cachedMessages: TwitchMessage[] | null = null
          let lastTimestamp: number | null = null
          if (cached && cached.messages) {
            cachedMessages = cached.messages
            lastTimestamp =
              cachedMessages.length > 0
                ? (cachedMessages[cachedMessages.length - 1]?.timestamp ?? null)
                : null
          }

          if (cachedMessages !== null && cached?.complete) return cachedMessages

          try {
            // Check for new data if the cached data is incomplete (fetched on the same day)
            const complete = !this.isSameUTCDate(date, new Date())

            console.debug(`Fetching chat for ${channel} on ${year}/${month}/${day}`)
            const timeLabel = `Fetched chat data for ${channel} on ${year}/${month}/${day}`
            console.time(timeLabel)
            const data = await this.justLogApi.getChannelLogsByDate(
              {
                channelStr: channel,
                year,
                month,
                day
              },
              { baseUrl: settings.getJustlogUrl() }
            )
            console.timeEnd(timeLabel)
            if (data == null) {
              console.warn(`Failed to fetch chat for ${year}/${month}/${day}`)
              return cachedMessages || []
            }

            const newMessages = data.messages
            let messages: TwitchMessage[]
            if (cachedMessages && lastTimestamp !== null) {
              messages = this.mergeMessageArrays(cachedMessages, newMessages, lastTimestamp)
              const newCount = messages.length - cachedMessages.length
              console.debug(
                `Fetched ${newCount} new lines from ${year}/${month}/${day} (total: ${messages.length})`
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

  /**
   * Generates an array of dates in UTC from startDate to endDate.
   * @param startDate - The start date in UTC.
   * @param endDate - The end date in UTC.
   * @returns An array of Date objects representing each day in the range.
   */
  private generateDatesInRange(startDate: Date, endDate: Date, includeEndDate = true): Date[] {
    const datesToFetch: Date[] = []
    const currentDate = new Date(startDate)
    while (currentDate < endDate) {
      datesToFetch.push(new Date(currentDate))
      currentDate.setUTCDate(currentDate.getUTCDate() + 1)
    }
    if (includeEndDate) datesToFetch.push(new Date(currentDate))
    return datesToFetch
  }

  private getCacheKey(channel: string, date: Date): string {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1 // Months are 0-indexed
    const day = date.getUTCDate()
    return `${channel}:${year}-${month}-${day}`
  }

  private isSameUTCDate(d1: Date, d2: Date): boolean {
    return (
      d1.getUTCFullYear() === d2.getUTCFullYear() &&
      d1.getUTCMonth() === d2.getUTCMonth() &&
      d1.getUTCDate() === d2.getUTCDate()
    )
  }

  private mergeMessageArrays(
    cachedMessages: TwitchMessage[],
    newMessages: TwitchMessage[],
    lastTimestamp: number
  ): TwitchMessage[] {
    const filteredNew = newMessages.filter((msg) => msg.timestamp > lastTimestamp)

    // If there are new messages with the same timestamp as the last cached message,
    // we need to ensure we don't duplicate them
    let overlappedNew = newMessages.filter((msg) => msg.timestamp === lastTimestamp)
    if (overlappedNew.length > 0) {
      const overlappedOld = cachedMessages.filter((msg) => msg.timestamp === lastTimestamp)
      // Remove old messages with the same timestamp
      overlappedNew = overlappedNew.filter(
        (msg) => !overlappedOld.some((oldMsg) => msg.getId() === oldMsg.getId())
      )
    }

    return [...cachedMessages, ...overlappedNew, ...filteredNew]
  }

  private async prefetchMessagesForTime(
    channel: string,
    startTime: number,
    endTime: number
  ): Promise<void> {
    if (endTime - startTime > 8 * 60 * 60 * 1000) return // Avoid fetching too large ranges

    const padding = 5 * 60 * 1000 // 5 minutes padding
    const startDate = new Date(startTime - padding)
    const startDateNoPadding = new Date(startTime)
    const endDate = new Date(endTime + padding)
    const endDateNoPadding = new Date(endTime)

    const datesToFetch = this.generateDatesInRange(startDateNoPadding, endDateNoPadding, false)
    const isCached = (): boolean =>
      datesToFetch.every((d) => {
        const cacheKey = this.getCacheKey(channel, d)
        return this.chatCache[cacheKey] && this.chatCache[cacheKey].complete
      })
    if (isCached()) return

    const cacheKey = `${channel}:prefetch`
    await this.fetchLock.acquire(cacheKey, async () => {
      if (isCached()) return

      // If the last prefetch range overlaps with the current range, skip prefetching
      if (
        this.lastPrefetchRange &&
        this.lastPrefetchRange.channel === channel &&
        this.lastPrefetchRange.startTime <= startTime &&
        this.lastPrefetchRange.endTime >= endTime
      ) {
        console.debug(
          `Messages for ${channel} from ${startDate} to ${endDate} are already prefetched`
        )
        return
      }

      console.debug(`Prefetching messages for ${channel} from ${startDate} to ${endDate}`)
      const timeLabel = `Prefetched messages for ${channel} from ${startDate} to ${endDate}`
      console.time(timeLabel)
      const prefetchedMessages = await this.justLogApi.getChannelLogs(
        {
          channelStr: channel,
          fromTime: startDate,
          toTime: endDate
        },
        { baseUrl: settings.getJustlogUrl() }
      )
      console.timeEnd(timeLabel)
      if (prefetchedMessages == null) {
        console.warn(`Failed to prefetch messages for ${channel} from ${startDate} to ${endDate}`)
        return
      }

      if (isCached()) {
        console.debug(`Messages for ${channel} from ${startDate} to ${endDate} are already cached`)
        return
      }
      console.debug(
        `Prefetched ${prefetchedMessages.messages.length} messages for ${channel} from ${startTime} to ${endTime}`
      )
      this.currentChatData = prefetchedMessages.messages.sort((a, b) => a.timestamp - b.timestamp)
      this.lastPrefetchRange = {
        channel,
        startTime: startDate.getTime(),
        endTime: endDate.getTime()
      }
    })
  }

  public getLoadedMessages(): TwitchMessage[] {
    return this.currentChatData
  }

  public async getMessagesAroundTime(
    currentVideoTime: number,
    beforeTime: number,
    afterTime: number
  ): Promise<TwitchMessage[]> {
    if (this.lastPotPlayerInfo === null) return []

    await this.prefetchMessagesForTime(
      this.lastPotPlayerInfo.channel,
      this.lastPotPlayerInfo.startTime + currentVideoTime - beforeTime,
      this.lastPotPlayerInfo.startTime + currentVideoTime + afterTime
    )

    const startTime = this.lastPotPlayerInfo.startTime + currentVideoTime - beforeTime
    const endTime = this.lastPotPlayerInfo.startTime + currentVideoTime + afterTime
    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesForTime(
    currentVideoTime: number,
    next?: boolean
  ): Promise<TwitchMessage[]> {
    if (this.lastPotPlayerInfo === null) return []

    await this.prefetchMessagesForTime(
      this.lastPotPlayerInfo.channel,
      this.lastPotPlayerInfo.startTime + currentVideoTime - 5 * 60 * 1000, // 5 minutes before
      this.lastPotPlayerInfo.startTime + currentVideoTime
    )

    return getMessagesForTime(
      this.currentChatData,
      this.lastPotPlayerInfo.startTime + currentVideoTime,
      settings.getChatMessageLimit(),
      next
    )
  }
}
