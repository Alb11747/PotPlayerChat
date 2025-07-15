import type { HelixChatBadgeSet, HelixChatBadgeVersion, HelixCheermoteList } from '@twurple/api'
import { ApiClient } from '@twurple/api'
import type {
  CheermoteDisplayInfo,
  CheermoteFormat
} from '@twurple/api/lib/endpoints/bits/CheermoteDisplayInfo'
import { AppTokenAuthProvider } from '@twurple/auth'
import AsyncLock from 'async-lock'

const apiPromise = (async () => {
  const keys = await window.api.loadKeys()
  if (!keys.twitch) {
    console.warn('Twitch keys not found, API client will not work')
    return null
  }
  return new ApiClient({
    authProvider: new AppTokenAuthProvider(keys.twitch.clientId, keys.twitch.clientSecret)
  })
})()

export const userIdCache = new Map<string, string | null>()
const lock = new AsyncLock()

/**
 * Get a Twitch user ID from a username
 */
export async function getTwitchUserIdByName(username: string): Promise<string | null> {
  return lock.acquire(`userid:${username}`, async () => {
    if (userIdCache.has(username)) return userIdCache.get(username) ?? null
    try {
      const api = await apiPromise
      if (!api) {
        console.warn('Twitch API client not initialized, cannot fetch user ID')
        return null
      }

      console.debug(`Fetching Twitch user ID for username: ${username}`)
      const user = await api.users.getUserByName(username)
      const userId = user?.id ?? null
      userIdCache.set(username, userId)
      return userId
    } catch {
      userIdCache.set(username, null)
      return null
    }
  })
}

export class TwitchBadgeService {
  private globalBadgeCache = new Map<string, Map<string, HelixChatBadgeVersion>>()
  private channelBadgeCache = new Map<string, Map<string, Map<string, HelixChatBadgeVersion>>>()

  constructor(private api: ApiClient | null) {}

  private async fetchChannelBadges(channelId: string): Promise<void> {
    const api = this.api
    if (!api) return

    return lock.acquire(`badges:channel:${channelId}`, async () => {
      if (this.channelBadgeCache.has(channelId)) return
      try {
        const fetchLabel = `Fetching channel badges for channel ID '${channelId}'`
        console.debug(fetchLabel)
        console.time(fetchLabel)
        const badges = await api.chat.getChannelBadges(channelId)
        console.timeEnd(fetchLabel)
        this.processAndCacheChannelBadges(channelId, badges)
      } catch (error) {
        console.error(`Failed to fetch badges for channel ${channelId}:`, error)
      }
    })
  }

  private processAndCacheChannelBadges(channelId: string, badges: HelixChatBadgeSet[]): void {
    const channelCache = new Map<string, Map<string, HelixChatBadgeVersion>>()

    for (const badge of badges) {
      const versions = new Map<string, HelixChatBadgeVersion>()
      for (const version of badge.versions) versions.set(version.id, version)
      channelCache.set(badge.id, versions)
    }

    this.channelBadgeCache.set(channelId, channelCache)
  }

  private async fetchGlobalBadges(): Promise<void> {
    const api = this.api
    if (!api) return

    return lock.acquire('badges:global', async () => {
      if (this.globalBadgeCache.size > 0) return

      try {
        const fetchLabel = 'Fetching global badges'
        console.debug(fetchLabel)
        console.time(fetchLabel)
        const badges = await api.chat.getGlobalBadges()
        console.timeEnd(fetchLabel)
        for (const badge of badges) {
          const versions = new Map<string, HelixChatBadgeVersion>()
          for (const version of badge.versions) versions.set(version.id, version)
          this.globalBadgeCache.set(badge.id, versions)
        }
      } catch (error) {
        console.error('Failed to fetch global badges:', error)
      }
    })
  }

  async getBadgeInfo(
    badgeId: string,
    version: string,
    channelId?: string
  ): Promise<HelixChatBadgeVersion | undefined> {
    await this.fetchGlobalBadges()

    // Check channel badges first
    if (channelId) {
      const channelBadges = this.channelBadgeCache.get(channelId)
      if (!channelBadges) {
        await this.fetchChannelBadges(channelId)
        return this.getBadgeInfo(badgeId, version, channelId)
      } else {
        const badgeSet = channelBadges.get(badgeId)
        if (badgeSet) {
          const badge = badgeSet.get(version)
          if (badge) return badge
        }
      }
    }

    // Fall back to global badges
    const globalBadgeSet = this.globalBadgeCache.get(badgeId)
    if (globalBadgeSet) {
      return globalBadgeSet.get(version)
    }

    return undefined
  }
}

export const mainBadgeService = (async (): Promise<TwitchBadgeService | null> => {
  const keys = await window.api.loadKeys()
  if (!keys.twitch) {
    console.warn('Twitch keys not found, badge service will not work')
    return null
  }
  const api = new ApiClient({
    authProvider: new AppTokenAuthProvider(keys.twitch.clientId, keys.twitch.clientSecret)
  })
  return new TwitchBadgeService(api)
})()

export class CheerEmote implements CheermoteDisplayInfo {
  public source = 'cheer' as const

  public url: string
  public color: string

  constructor(
    info: CheermoteDisplayInfo,
    public name: string,
    public bits: number
  ) {
    this.url = info.url
    this.color = info.color
  }
}

export class TwitchCheerEmoteService {
  private globalCheerEmotes: HelixCheermoteList | null = null
  private channelCheerEmotes = new Map<string, HelixCheermoteList>()

  constructor(private api: ApiClient | null) {}

  private async fetchCheerEmotes(channelId?: string): Promise<void> {
    const api = this.api
    if (!api) return

    const lockKey = channelId ? `cheer-emotes:channel:${channelId}` : 'cheer-emotes:global'

    if (channelId ? this.channelCheerEmotes.has(channelId) : this.globalCheerEmotes) return
    return lock.acquire(lockKey, async () => {
      if (channelId ? this.channelCheerEmotes.has(channelId) : this.globalCheerEmotes) return

      try {
        const fetchLabel = channelId
          ? `Fetching cheer emotes for channel '${channelId}'`
          : 'Fetching global cheer emotes'
        console.debug(fetchLabel)
        console.time(fetchLabel)
        const cheerEmotes = await api.bits.getCheermotes(channelId)
        console.timeEnd(fetchLabel)

        if (channelId) {
          this.channelCheerEmotes.set(channelId, cheerEmotes)
        } else {
          this.globalCheerEmotes = cheerEmotes
        }
      } catch (error) {
        console.error(
          `Failed to fetch cheerEmotes${channelId ? ` for channel ${channelId}` : ''}:`,
          error
        )
      }
    })
  }

  async getCheerEmoteInfo(
    name: string,
    bits: number,
    channelId?: string,
    format: CheermoteFormat = {
      background: 'dark',
      state: 'animated',
      scale: '4'
    }
  ): Promise<CheerEmote | undefined> {
    await this.fetchCheerEmotes(channelId)

    const channelCheerEmotes = channelId ? this.channelCheerEmotes.get(channelId) : undefined
    if (channelCheerEmotes) {
      const cheerEmote = channelCheerEmotes.getCheermoteDisplayInfo(name, bits, format)
      if (cheerEmote) return new CheerEmote(cheerEmote, `${name}${bits}`, bits)
    }
    const globalCheerEmotes = this.globalCheerEmotes
    if (globalCheerEmotes) {
      const cheerEmote = globalCheerEmotes.getCheermoteDisplayInfo(name, bits, format)
      if (cheerEmote) return new CheerEmote(cheerEmote, `${name}${bits}`, bits)
    }
    return undefined
  }
}

export const mainCheerEmoteService = (async (): Promise<TwitchCheerEmoteService | null> => {
  const keys = await window.api.loadKeys()
  if (!keys.twitch) {
    console.warn('Twitch keys not found, cheermote service will not work')
    return null
  }
  const api = new ApiClient({
    authProvider: new AppTokenAuthProvider(keys.twitch.clientId, keys.twitch.clientSecret)
  })
  return new TwitchCheerEmoteService(api)
})()
