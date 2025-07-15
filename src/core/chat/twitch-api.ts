import type { HelixChatBadgeSet, HelixChatBadgeVersion } from '@twurple/api'
import { ApiClient } from '@twurple/api'
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

class TwitchBadgeService {
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

// Create singleton instance
let mainBadgeService: Promise<TwitchBadgeService | null>

export const getMainBadgeService = async (): Promise<TwitchBadgeService | null> => {
  if (!mainBadgeService) {
    mainBadgeService = (async () => {
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
  }
  return mainBadgeService
}
