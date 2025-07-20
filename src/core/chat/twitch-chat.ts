import type { HWND } from '@/types/globals'
import type { WindowApi } from '@/types/preload'
import { getMessagesBetween, getMessagesForTime } from '@/utils/chat'
import { logTime } from '@/utils/debug'
import { isSorted } from '@/utils/objects'
import AsyncLock from 'async-lock'
import { JustLogAPI } from './justlog'
import { TwitchUserService } from './twitch-api'
import type { TwitchMessage } from './twitch-msg'

export interface ChatSettings {
  justlogUrl: string
  chatMessageLimit: number
}

export interface PotPlayerInfo {
  hwnd: HWND
  channel: string
  title: string
  startTime: number
  endTime?: number
}

export interface LoadingState {
  state: 'idle' | 'loading' | 'loaded' | 'error' | 'no-potplayer-info' | 'chat-not-found'
  errorMessage: string
}

export interface ChatDataRange {
  channel: string
  startTime: number
  endTime: number
  complete: boolean
}

export class ChatService {
  public static loadChatTimePadding = 1 * 60 * 60 * 1000 // 1 hour in milliseconds
  public static prefetchTimePadding = 5 * 60 * 1000 // 5 minutes in milliseconds

  private api: WindowApi
  private justLogApi: JustLogAPI
  private settings: { chat: ChatSettings }

  public usernameColorCache: Map<string, { color: string; timestamp: number }> | null = null
  public currentPotPlayerInfo: PotPlayerInfo | null = null

  public currentChatData: TwitchMessage[] = []

  // Caching chat data per day
  private chatCache: Record<string, { messages: TwitchMessage[]; complete: boolean }> = {}
  private lastPrefetchRange: ChatDataRange | null = null

  // Lock to prevent concurrent fetches for the same cache key
  private fetchLock = new AsyncLock()

  // state for UI
  public state: LoadingState

  constructor(api: WindowApi, state: LoadingState, settings: { chat: ChatSettings }) {
    this.api = api
    this.state = state
    this.settings = settings

    this.justLogApi = new JustLogAPI()
  }

  public async updateVideoInfo(
    newPotPlayerInfo: PotPlayerInfo,
    loadChatDelay: number = 1000
  ): Promise<boolean> {
    this.currentPotPlayerInfo = newPotPlayerInfo
    this.currentChatData = []

    if (loadChatDelay >= 0) {
      this.state.state = 'loading'
      this.state.errorMessage = ''

      if (loadChatDelay > 0) {
        this.loadChatCached()
        setTimeout(this.loadChat.bind(this), loadChatDelay)
      } else if (loadChatDelay === 0) {
        await this.loadChat()
      }
    }
    return true
  }

  public loadChatCached(): boolean {
    if (!this.currentPotPlayerInfo) {
      console.warn('No PotPlayer info available for chat loading.')
      return false
    }

    const { channel, startTime, endTime } = this.currentPotPlayerInfo
    if (!endTime) return false

    const datePadding = ChatService.loadChatTimePadding
    const startDate = new Date(startTime - datePadding)
    const endDate = new Date(endTime + datePadding)
    const datesToFetch = this.generateDatesInRange(startDate, endDate)

    let allCached = true
    const allMessages: TwitchMessage[] = []
    for (const date of datesToFetch) {
      const cacheKey = this.getCacheKey(channel, date)
      const cached = this.chatCache[cacheKey]
      if (cached && cached.messages) {
        allMessages.push(...cached.messages)
      } else {
        allCached = false
      }
    }

    console.assert(
      isSorted(allMessages, (a, b) => a.timestamp - b.timestamp),
      'Chat messages are not sorted'
    )

    this.currentChatData = allMessages
    return allCached
  }

  async loadChat(): Promise<void> {
    const { hwnd, channel, startTime: videoStartTime, endTime } = this.currentPotPlayerInfo ?? {}
    if (!hwnd || !channel || !videoStartTime) {
      this.state.state = 'no-potplayer-info'
      console.warn('No PotPlayer info available for chat loading.', {
        ...this.currentPotPlayerInfo
      })
      return
    }

    try {
      const videoEndTime = endTime ?? videoStartTime + (await this.api.getTotalVideoTime(hwnd))

      const datePadding = ChatService.loadChatTimePadding
      const startDate = new Date(videoStartTime - datePadding)
      const endDate = new Date(videoEndTime + datePadding)

      const datesToFetch = this.generateDatesInRange(startDate, endDate)
      const datesToFetchData = datesToFetch
        .map((date: Date) => {
          const cacheKey = this.getCacheKey(channel, date)
          if (this.chatCache[cacheKey]) return null
          const year = date.getUTCFullYear()
          const month = date.getUTCMonth() + 1
          const day = date.getUTCDate()
          return { date, cacheKey, year, month, day }
        })
        .filter((d) => d !== null)

      // If all dates are cached, we can skip fetching
      if (datesToFetchData.length === 0) {
        this.state.state = 'loaded'
        return
      }

      const fetchPromises = datesToFetchData.map(
        async ({ date, cacheKey, year, month, day }): Promise<TwitchMessage[]> => {
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

              const data = await logTime(
                `Fetching chat data for ${channel} on ${year}/${month}/${day}`,
                () =>
                  this.justLogApi.getChannelLogsByDate(
                    {
                      channelStr: channel,
                      year,
                      month,
                      day
                    },
                    { baseUrl: this.settings.chat.justlogUrl }
                  )
              )

              if (data == null) {
                console.warn(`Failed to fetch chat for ${year}/${month}/${day}`)
                this.chatCache[cacheKey] = { messages: [], complete }
                return cachedMessages || []
              }

              const newMessages = data.messages
              this.updateCaches(newMessages)

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
              messages.sort((a, b) => a.timestamp - b.timestamp)
              this.chatCache[cacheKey] = { messages, complete }
              return messages
            } catch (error) {
              console.warn(`Error fetching chat for ${year}/${month}/${day}:`, error)
              return cachedMessages || []
            }
          })
        }
      )

      this.state.state = 'loading'
      console.debug(`Loading chat for ${channel} starting from ${new Date(videoStartTime)}`)
      const chatDataArrays = await Promise.all(fetchPromises)
      if (
        this.currentPotPlayerInfo?.channel !== channel ||
        this.currentPotPlayerInfo?.startTime !== videoStartTime
      ) {
        console.debug(`Chat data for ${channel} was updated while loading, skipping`)
        return
      }

      const { channel: currentChannel, startTime: currentStartTime } = this.currentPotPlayerInfo
      if (currentChannel !== channel || currentStartTime !== videoStartTime) {
        console.warn(
          `Chat data for ${channel} at ${new Date(videoStartTime)} was updated while loading, skipping`
        )
        return
      }
      const allMessages = chatDataArrays.flat()

      console.assert(
        isSorted(allMessages, (a, b) => a.timestamp - b.timestamp),
        'Chat messages are not sorted'
      )

      this.currentChatData = allMessages
      console.debug(
        `Loaded ${this.currentChatData.length} chat messages for ${channel} across ${datesToFetch.length} day(s)`
      )

      if (allMessages.length > 0) {
        this.state.state = 'loaded'
      } else {
        this.state.state = 'chat-not-found'
      }
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
   * @param includeEndDate - Whether to include the end date in the result.
   * @param excludeFuture - Whether to exclude future dates (beyond the current date).
   * @returns An array of Date objects representing each day in the range.
   */
  private generateDatesInRange(
    startDate: Date,
    endDate: Date,
    includeEndDate = true,
    excludeFuture = true
  ): Date[] {
    const now = new Date()
    const currentDate = new Date(startDate)
    let datesToFetch: Date[] = []
    while (currentDate < endDate) {
      datesToFetch.push(new Date(currentDate))
      currentDate.setUTCDate(currentDate.getUTCDate() + 1)
    }
    if (includeEndDate) datesToFetch.push(new Date(currentDate))
    if (excludeFuture)
      datesToFetch = datesToFetch.filter((date) => date <= now || this.isSameUTCDate(date, now))
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
      d1.getUTCDate() === d2.getUTCDate() &&
      d1.getUTCMonth() === d2.getUTCMonth() &&
      d1.getUTCFullYear() === d2.getUTCFullYear()
    )
  }

  private updateCaches(messages: TwitchMessage[]): void {
    if (!this.usernameColorCache) return
    for (const msg of messages) {
      if (msg.type !== 'chat' || !msg.username || !msg.color) continue
      const last = this.usernameColorCache.get(msg.username)
      if (last && last.timestamp > msg.timestamp) continue
      this.usernameColorCache.set(msg.username, {
        color: msg.color,
        timestamp: msg.timestamp
      })
    }
    for (const msg of messages) {
      const channel = msg.channel
      const roomId = msg.roomId
      if (!channel || !roomId) continue
      TwitchUserService.userIdCache.set(channel, roomId)
    }
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
  ): Promise<boolean> {
    if (endTime - startTime > 8 * 60 * 60 * 1000) return false // Avoid fetching too large ranges

    const padding = ChatService.prefetchTimePadding
    const startDate = new Date(startTime - padding)
    const startDateNoPadding = new Date(startTime)
    const endDate = new Date(endTime + padding)
    const endDateNoPadding = new Date(endTime)

    const now = new Date()
    const datesToFetch = this.generateDatesInRange(startDateNoPadding, endDateNoPadding)
    const isComplete = !datesToFetch.some((date) => this.isSameUTCDate(date, now))

    const isCached = (): boolean =>
      datesToFetch.every((d) => {
        const cacheKey = this.getCacheKey(channel, d)
        return this.chatCache[cacheKey]
      })

    if (isCached()) {
      this.loadChatCached()
      return false
    }
    return this.fetchLock.acquire(`${channel}:prefetch`, async (): Promise<boolean> => {
      if (isCached()) return false

      // If the last prefetch range overlaps with the current range, skip prefetching
      if (
        this.lastPrefetchRange &&
        this.lastPrefetchRange.channel === channel &&
        this.lastPrefetchRange.startTime <= startTime &&
        this.lastPrefetchRange.endTime >= endTime
      )
        return false

      const prefetchedMessages = await logTime(
        `Prefetching messages for ${channel} from ${startDate} to ${endDate}`,
        () =>
          this.justLogApi.getChannelLogs(
            {
              channelStr: channel,
              fromTime: startDate,
              toTime: endDate
            },
            { baseUrl: this.settings.chat.justlogUrl }
          )
      )
      if (prefetchedMessages == null) {
        console.warn(`Failed to prefetch messages for ${channel} from ${startDate} to ${endDate}`)
        return false
      }

      this.updateCaches(prefetchedMessages.messages)

      if (isCached()) {
        console.debug(`Messages for ${channel} from ${startDate} to ${endDate} are already cached`)
        return false
      }
      console.debug(
        `Prefetched ${prefetchedMessages.messages.length} messages for ${channel} from ${startTime} to ${endTime}`
      )
      this.currentChatData = prefetchedMessages.messages.sort((a, b) => a.timestamp - b.timestamp)
      this.lastPrefetchRange = {
        channel,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        complete: isComplete
      }
      return true
    })
  }

  public getLoadedMessages(): TwitchMessage[] {
    return this.currentChatData
  }

  public async getMessagesBetweenTimes(
    startTime: number,
    endTime: number
  ): Promise<TwitchMessage[]> {
    if (this.currentPotPlayerInfo === null) return []

    await this.prefetchMessagesForTime(this.currentPotPlayerInfo.channel, startTime, endTime)

    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesAroundTime(
    currentVideoTime: number,
    beforeTime: number,
    afterTime: number
  ): Promise<TwitchMessage[]> {
    if (this.currentPotPlayerInfo === null) return []

    await this.prefetchMessagesForTime(
      this.currentPotPlayerInfo.channel,
      this.currentPotPlayerInfo.startTime + currentVideoTime - beforeTime,
      this.currentPotPlayerInfo.startTime + currentVideoTime + afterTime
    )

    const startTime = this.currentPotPlayerInfo.startTime + currentVideoTime - beforeTime
    const endTime = this.currentPotPlayerInfo.startTime + currentVideoTime + afterTime
    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesForTime(
    currentVideoTime: number,
    next?: boolean
  ): Promise<TwitchMessage[]> {
    if (this.currentPotPlayerInfo === null) return []

    await this.prefetchMessagesForTime(
      this.currentPotPlayerInfo.channel,
      this.currentPotPlayerInfo.startTime + currentVideoTime - ChatService.prefetchTimePadding,
      this.currentPotPlayerInfo.startTime + currentVideoTime
    )

    return getMessagesForTime(
      this.currentChatData,
      this.currentPotPlayerInfo.startTime + currentVideoTime,
      this.settings.chat.chatMessageLimit,
      next
    )
  }
}
