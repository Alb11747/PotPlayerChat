import type { PotPlayerInstance } from '@/types/potplayer'
import type { WindowApi } from '@/types/preload'
import { deduplicateMessages, getMessagesBetween, getMessagesForTime } from '@/utils/chat'
import { TimelineMap } from '@/utils/datastructs'
import { logTime } from '@/utils/debug'
import { isSorted } from '@/utils/objects'
import { normalizeStrings } from '@/utils/strings'
import { CooperativeWork } from '@/utils/cooperative-work'
import TTLCache from '@isaacs/ttlcache'
import AsyncLock from 'async-lock'
import { JustLogAPI } from './justlog'
import { TwitchUserService } from './twitch-api'
import type { TwitchMessage } from './twitch-msg'

export interface ChatSettings {
  justlogUrl: string
  chatMessageLimit: number
}

export interface PotPlayerInfo extends PotPlayerInstance {
  channel: string
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
  public static incompleteRefreshInterval = 30 * 1000

  private api: WindowApi
  private justLogApi: JustLogAPI
  private settings: { chat: ChatSettings }
  private sourceUrl: string

  public usernameColorTimelineMap: TimelineMap<string, string> = new TimelineMap()
  public currentPotPlayerInfo: PotPlayerInfo | null = null

  private lastPrefetchRange: ChatDataRange | null = null
  private lastPrefetchAt = 0
  private selectionGeneration = 0
  private loadChatTimer: ReturnType<typeof setTimeout> | undefined
  private publishedBatches: { batches: TwitchMessage[][]; messages: TwitchMessage[] } | null = null
  public currentChatData: TwitchMessage[] = []

  // Caching chat data per day
  private chatCache: TTLCache<
    string,
    { messages: TwitchMessage[]; complete: boolean; fetchedAt: number }
  > = new TTLCache({
    max: 15,
    ttl: 2 * 24 * 60 * 60 * 1000, // Cache for 2 days
    updateAgeOnGet: true,
    checkAgeOnGet: false
  })

  // Lock to prevent concurrent fetches for the same cache key
  private fetchLock = new AsyncLock()

  // state for UI
  public state: LoadingState

  constructor(api: WindowApi, state: LoadingState, settings: { chat: ChatSettings }) {
    this.api = api
    this.state = state
    this.settings = settings
    this.sourceUrl = settings.chat.justlogUrl

    this.justLogApi = new JustLogAPI()
  }

  private syncSource(): void {
    const sourceUrl = this.settings.chat.justlogUrl
    if (sourceUrl === this.sourceUrl) return
    this.sourceUrl = sourceUrl
    ++this.selectionGeneration
    clearTimeout(this.loadChatTimer)
    this.clearCache()
    this.currentChatData = []
    this.usernameColorTimelineMap = new TimelineMap()
    this.state.state = 'idle'
    this.state.errorMessage = ''
  }

  private captureRequestContext(): {
    info: PotPlayerInfo | null
    baseUrl: string
    isCurrent: () => boolean
  } {
    this.syncSource()
    const generation = this.selectionGeneration
    const info = this.currentPotPlayerInfo
    return {
      info,
      baseUrl: this.sourceUrl,
      isCurrent: () => {
        // Settings are mutable; a source change need not reselect the recording.
        this.syncSource()
        return generation === this.selectionGeneration && info === this.currentPotPlayerInfo
      }
    }
  }

  public async updateVideoInfo(
    newPotPlayerInfo: PotPlayerInfo | null,
    loadChatDelay: number = 1000
  ): Promise<boolean> {
    this.syncSource()
    const generation = ++this.selectionGeneration
    clearTimeout(this.loadChatTimer)
    this.lastPrefetchRange = null
    this.publishedBatches = null
    this.currentPotPlayerInfo = newPotPlayerInfo
    this.currentChatData = []

    if (loadChatDelay >= 0) {
      this.state.state = 'loading'
      this.state.errorMessage = ''

      if (loadChatDelay > 0) {
        this.loadChatCached()
        this.loadChatTimer = setTimeout(() => {
          if (generation === this.selectionGeneration) void this.loadChat()
        }, loadChatDelay)
      } else if (loadChatDelay === 0) {
        await this.loadChat()
      }
    }
    return true
  }

  public loadChatCached(): boolean {
    this.syncSource()
    if (!this.currentPotPlayerInfo) {
      console.warn('No PotPlayer info available for chat loading.')
      return false
    }

    const { channel, startTime, endTime } = this.currentPotPlayerInfo
    if (!endTime) return false

    const loadStartTime = window.performance.now()

    const datePadding = ChatService.loadChatTimePadding
    const startDate = new Date(startTime - datePadding)
    const endDate = new Date(endTime + datePadding)
    const datesToFetch = this.generateDatesInRange(startDate, endDate)

    try {
      if (datesToFetch.length === 0) return false

      let allCached = true

      // Check if the current chat data is already cached
      const allCachedMessageData: TwitchMessage[][] = []
      for (const date of datesToFetch) {
        const cacheKey = this.getCacheKey(channel, date)
        const cached = this.chatCache.get(cacheKey)
        if (cached && cached.messages) {
          allCachedMessageData.push(cached.messages)
        } else {
          allCached = false
        }
      }

      this.publishChatBatches(allCachedMessageData)
      return allCached
    } finally {
      const loadEndTime = window.performance.now()
      const loadDuration = loadEndTime - loadStartTime
      if (loadDuration > 20)
        console.warn(
          `loadChatCached for ${channel} on`,
          datesToFetch,
          `took too long:`,
          loadDuration.toFixed(2),
          `ms`
        )
    }
  }

  async loadChat(loadDates: Date[] | null = null): Promise<void> {
    const { info, baseUrl, isCurrent } = this.captureRequestContext()
    const { hwnd, channel, startTime: videoStartTime, endTime } = info ?? {}
    if (!hwnd || !channel || !videoStartTime) {
      this.state.state = 'no-potplayer-info'
      return
    }

    try {
      const videoEndTime = endTime ?? videoStartTime + (await this.api.getTotalVideoTime(hwnd))
      if (!isCurrent()) return
      const padding = ChatService.loadChatTimePadding
      const videoDates = this.generateDatesInRange(
        new Date(videoStartTime - padding),
        new Date(videoEndTime + padding)
      )
      // Retain cached days when a prefetch fills just one part of the recording.
      const requestedDates = loadDates ?? videoDates
      const dates = [
        ...new Map(
          [...videoDates, ...requestedDates].map((date) => [this.getCacheKey(channel, date), date])
        ).values()
      ]
      const requestedKeys = new Set(requestedDates.map((date) => this.getCacheKey(channel, date)))
      this.state.state = 'loading'
      const batches = await Promise.all(
        dates.map(async (date): Promise<TwitchMessage[]> => {
          const cacheKey = this.getCacheKey(channel, date)
          const cached = this.chatCache.get(cacheKey)
          if (!requestedKeys.has(cacheKey) || this.isCacheFresh(cacheKey))
            return cached?.messages ?? []
          return this.fetchLock.acquire(cacheKey, async () => {
            if (!isCurrent()) return []
            const cached = this.chatCache.get(cacheKey)
            if (this.isCacheFresh(cacheKey)) return cached?.messages ?? []
            try {
              const requestStartedAt = new Date()
              const data = await logTime(
                `Fetching chat data for ${channel} on ${date.toISOString()}`,
                () =>
                  this.justLogApi.getChannelLogsByDate(
                    {
                      channelStr: channel,
                      year: date.getUTCFullYear(),
                      month: date.getUTCMonth() + 1,
                      day: date.getUTCDate()
                    },
                    { baseUrl }
                  )
              )
              if (!isCurrent()) return []
              // Null is a failed request, not proof of an empty, complete day.
              if (data === null) throw new Error('Failed to fetch daily chat')
              const messages = this.mergeMessageArrays(cached?.messages ?? [], data.messages)
              this.updateMessageData(messages)
              this.chatCache.set(cacheKey, {
                messages,
                // A request started before midnight cannot certify that entire day.
                complete: !this.isSameUTCDate(date, requestStartedAt),
                fetchedAt: Date.now()
              })
              return messages
            } catch (error) {
              if (!isCurrent()) return []
              console.warn(`Error fetching chat for ${channel} on ${date.toISOString()}:`, error)
              const messages = cached?.messages ?? []
              this.chatCache.set(cacheKey, { messages, complete: false, fetchedAt: Date.now() })
              return messages
            }
          })
        })
      )
      if (!isCurrent()) return
      this.publishChatBatches(batches)
      this.state.state = this.currentChatData.length > 0 ? 'loaded' : 'chat-not-found'
    } catch (error: unknown) {
      if (!isCurrent()) return
      console.error('Error loading chat:', error)
      this.state.state = 'error'
      this.state.errorMessage =
        error instanceof Error
          ? `Failed to load chat: ${error.message}`
          : 'Failed to load chat: Unknown error'
    }
  }

  private isCacheFresh(cacheKey: string): boolean {
    const cached = this.chatCache.get(cacheKey)
    return (
      !!cached &&
      (cached.complete || Date.now() - cached.fetchedAt < ChatService.incompleteRefreshInterval)
    )
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
    currentDate.setUTCHours(0, 0, 0, 0)
    const lastDate = new Date(endDate)
    lastDate.setUTCHours(0, 0, 0, 0)
    let datesToFetch: Date[] = []
    while (currentDate < lastDate) {
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
    return JSON.stringify([this.sourceUrl, channel, `${year}-${month}-${day}`])
  }

  private isSameUTCDate(d1: Date, d2: Date): boolean {
    return (
      d1.getUTCDate() === d2.getUTCDate() &&
      d1.getUTCMonth() === d2.getUTCMonth() &&
      d1.getUTCFullYear() === d2.getUTCFullYear()
    )
  }

  public updateMessageData(messages: TwitchMessage[]): void {
    this.syncSource()
    // Update the username color cache
    for (const msg of messages) {
      if (msg.type !== 'chat' || !msg.username || !msg.color) continue
      for (const name of normalizeStrings([msg.username, msg.displayName]))
        this.usernameColorTimelineMap.set(name, msg.color, msg.timestamp)
    }
    this.usernameColorTimelineMap.condense()

    // Update the user ID cache
    for (const msg of messages) {
      const channel = msg.channel
      const roomId = msg.roomId
      if (!channel || !roomId) continue
      TwitchUserService.userIdCache.set(channel, roomId)
    }
  }

  /** Search owns a complete sorted snapshot, including any backfilled color boundaries. */
  public async updateMessageDataCooperatively(
    messages: readonly TwitchMessage[],
    signal?: AbortSignal
  ): Promise<void> {
    const { isCurrent } = this.captureRequestContext()
    const work = new CooperativeWork(signal)
    const colors = new TimelineMap<string, string>()
    const previousColors = new Map<string, string>()
    const roomIds = new Map<string, string>()
    work.throwIfAborted()
    for (const msg of messages) {
      if (msg.type === 'chat' && msg.username && msg.color) {
        for (const name of normalizeStrings([msg.username, msg.displayName])) {
          // Sorted input lets us condense while building, without losing boundaries
          // from the previously loaded snapshot when older history is added.
          if (previousColors.get(name) !== msg.color) {
            colors.set(name, msg.color, msg.timestamp)
            previousColors.set(name, msg.color)
          }
        }
      }
      if (msg.channel && msg.roomId) roomIds.set(msg.channel, msg.roomId)
      const pause = work.checkpoint()
      if (pause) await pause
    }
    for (const [channel, id] of roomIds) {
      if (!isCurrent()) return
      TwitchUserService.userIdCache.set(channel, id)
      const pause = work.checkpoint()
      if (pause) await pause
    }
    work.throwIfAborted()
    if (!isCurrent()) return
    this.usernameColorTimelineMap = colors
  }

  private mergeMessageArrays(
    cachedMessages: TwitchMessage[],
    newMessages: TwitchMessage[]
  ): TwitchMessage[] {
    // Full-day refreshes can backfill messages before the previous last timestamp.
    const knownIds = new Set(cachedMessages.map((message) => message.getId()))
    return deduplicateMessages([
      ...cachedMessages,
      ...newMessages.filter((message) => !knownIds.has(message.getId()))
    ]).sort((a, b) => a.timestamp - b.timestamp)
  }

  private async prefetchMessagesForTime(
    channel: string,
    startTime: number,
    endTime: number
  ): Promise<boolean> {
    const { baseUrl, isCurrent } = this.captureRequestContext()
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
        return this.isCacheFresh(cacheKey)
      })

    if (isCached()) {
      this.loadChatCached()
      return false
    }
    const prefetchKey = JSON.stringify([baseUrl, channel, 'prefetch'])
    return this.fetchLock.acquire(prefetchKey, async (): Promise<boolean> => {
      if (!isCurrent()) return false
      if (isCached()) return false

      // Once whole-day data exists, refresh it on a bounded cadence instead of
      // permanently treating an incomplete current-day entry as authoritative.
      if (datesToFetch.every((date) => this.chatCache.has(this.getCacheKey(channel, date)))) {
        await this.loadChat(datesToFetch)
        return isCurrent()
      }

      // If the last prefetch range overlaps with the current range, skip prefetching
      if (
        this.lastPrefetchRange &&
        this.lastPrefetchRange.channel === channel &&
        this.lastPrefetchRange.startTime <= startTime &&
        this.lastPrefetchRange.endTime >= endTime &&
        (this.lastPrefetchRange.complete ||
          Date.now() - this.lastPrefetchAt < ChatService.incompleteRefreshInterval)
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
            { baseUrl }
          )
      )
      if (!isCurrent()) return false
      if (prefetchedMessages == null) {
        console.warn(`Failed to prefetch messages for ${channel} from ${startDate} to ${endDate}`)
        return false
      }

      const messages = deduplicateMessages(prefetchedMessages.messages)
      this.updateMessageData(messages)

      if (isCached()) {
        console.debug(`Messages for ${channel} from ${startDate} to ${endDate} are already cached`)
        return false
      }
      console.debug(
        `Prefetched ${messages.length} messages for ${channel} from ${startTime} to ${endTime}`
      )
      this.currentChatData = this.mergeMessageArrays(this.currentChatData, messages)
      this.lastPrefetchRange = {
        channel,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        complete: isComplete
      }
      this.lastPrefetchAt = Date.now()

      // Load chat for the prefetched dates
      void this.loadChat(datesToFetch)

      return true
    })
  }

  private shouldLoadNewData(batchedData: TwitchMessage[][]): boolean {
    // Empty padded days are valid. Compare the whole sequence so backfilled
    // messages are visible even when the first and last messages stay unchanged.
    const count = batchedData.reduce((total, batch) => total + batch.length, 0)
    if (count !== this.currentChatData.length) return true
    let index = 0
    return batchedData.some((batch) =>
      batch.some((message) => this.currentChatData[index++]?.getId() !== message.getId())
    )
  }

  private publishChatBatches(batches: TwitchMessage[][]): void {
    // Playback polls often. Day arrays are replaced on refresh, so their identity
    // detects new data without scanning a full recording on every tick.
    if (
      this.publishedBatches?.messages === this.currentChatData &&
      this.publishedBatches.batches.length === batches.length &&
      batches.every((batch, index) => batch === this.publishedBatches?.batches[index])
    )
      return
    if (this.shouldLoadNewData(batches)) {
      this.currentChatData = this.mergeMessageArrays(this.currentChatData, batches.flat())
      console.assert(
        isSorted(this.currentChatData, (a, b) => a.timestamp - b.timestamp),
        'Chat messages are not sorted'
      )
    }
    this.publishedBatches = { batches, messages: this.currentChatData }
  }

  public getLoadedMessages(): TwitchMessage[] {
    this.syncSource()
    return this.currentChatData
  }

  /** Fetch a popup-owned range without starting playback's full-day backfill. */
  public async getMessagesInRange(
    startTime: number,
    endTime: number,
    signal?: AbortSignal
  ): Promise<TwitchMessage[]> {
    signal?.throwIfAborted()
    const { info, baseUrl, isCurrent } = this.captureRequestContext()
    if (!info) return []

    const data = await this.justLogApi.getChannelLogs(
      {
        channelStr: info.channel,
        fromTime: new Date(startTime),
        toTime: new Date(endTime)
      },
      { baseUrl }
    )
    // JustLog does not accept an AbortSignal; never publish a cancelled response.
    signal?.throwIfAborted()
    if (!isCurrent()) throw new DOMException('Chat source or recording changed', 'AbortError')
    if (data === null) throw new Error('Failed to load chat range')
    return deduplicateMessages(data.messages).sort((a, b) => a.timestamp - b.timestamp)
  }

  public async getMessagesBetweenTimes(
    startTime: number,
    endTime: number
  ): Promise<TwitchMessage[]> {
    const { info, isCurrent } = this.captureRequestContext()
    if (info === null) return []

    await this.prefetchMessagesForTime(info.channel, startTime, endTime)
    if (!isCurrent()) return []

    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesAroundTime(
    currentVideoTime: number,
    beforeTime: number,
    afterTime: number
  ): Promise<TwitchMessage[]> {
    const { info, isCurrent } = this.captureRequestContext()
    if (info === null) return []

    await this.prefetchMessagesForTime(
      info.channel,
      info.startTime + currentVideoTime - beforeTime,
      info.startTime + currentVideoTime + afterTime
    )
    if (!isCurrent()) return []

    const startTime = info.startTime + currentVideoTime - beforeTime
    const endTime = info.startTime + currentVideoTime + afterTime
    return getMessagesBetween(this.currentChatData, startTime, endTime)
  }

  public async getMessagesForTime(
    currentVideoTime: number,
    next?: boolean
  ): Promise<TwitchMessage[]> {
    const { info, isCurrent } = this.captureRequestContext()
    if (info === null) return []

    await this.prefetchMessagesForTime(
      info.channel,
      info.startTime + currentVideoTime - ChatService.prefetchTimePadding,
      info.startTime + currentVideoTime
    )
    if (!isCurrent()) return []

    return getMessagesForTime(
      this.currentChatData,
      info.startTime + currentVideoTime,
      this.settings.chat.chatMessageLimit,
      next
    )
  }

  public clearCache(): void {
    this.chatCache.clear()
    this.lastPrefetchRange = null
    this.publishedBatches = null
  }

  public clearInvalidCache(): void {
    // Remove cached data that is empty
    for (const key of this.chatCache.keys()) {
      const { messages } = this.chatCache.get(key) ?? {}
      if (!messages || messages.length === 0) this.chatCache.delete(key)
    }
    this.lastPrefetchRange = null
    this.publishedBatches = null
  }
}
