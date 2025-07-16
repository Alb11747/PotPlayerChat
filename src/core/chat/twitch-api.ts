import { logTime } from '@/utils/debug'
import { EmoteFetcher, type Channel, type Collection, type Emote } from '@mkody/twitch-emoticons'
import type { HelixChatBadgeSet, HelixChatBadgeVersion, HelixCheermoteList } from '@twurple/api'
import { ApiClient } from '@twurple/api'
import type { CheermoteFormat } from '@twurple/api/lib/endpoints/bits/CheermoteDisplayInfo'
import { AppTokenAuthProvider } from '@twurple/auth'
import AsyncLock from 'async-lock'
import { CheerEmote } from './twitch-emotes'

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

/* eslint-disable @typescript-eslint/no-namespace */

export namespace TwitchUserService {
  export const userIdCache = new Map<string, string | null>()

  /**
   * Get a Twitch user ID from a username
   */
  export async function getUserIdByName(username: string): Promise<string | null> {
    return lock.acquire(`userid:${username}`, async () => {
      if (userIdCache.has(username)) return userIdCache.get(username) ?? null

      const api = await apiPromise
      if (!api) return null

      try {
        const user = await logTime(`Fetching Twitch user ID for username: ${username}`, () =>
          api.users.getUserByName(username)
        )
        const userId = user?.id ?? null
        userIdCache.set(username, userId)
        return userId
      } catch {
        userIdCache.set(username, null)
        return null
      }
    })
  }
}

const lock = new AsyncLock()

/**
 * Service for fetching and parsing Twitch, BTTV, FFZ, and 7TV emotes, with per-channel caching.
 */
export namespace TwitchEmoteService {
  let fetcher: EmoteFetcher | null = null

  const channelCache: Map<number | undefined, boolean> = new Map()
  let globalEmotesFetchPromise: Promise<unknown> | null = null

  /**
   * Fetches all emotes (Twitch, BTTV, FFZ, 7TV) for a channel and caches them.
   * Uses async-lock to prevent duplicate fetches for the same channel.
   * @param channelId Twitch user/channel ID (number or string). Use undefined for global emotes.
   */
  export async function fetchAllEmotes(channelId?: number): Promise<void> {
    if (channelCache.get(channelId) !== undefined) return

    await lock.acquire(String(channelId ?? 'global'), async () => {
      if (channelCache.get(channelId)) return

      if (!fetcher) {
        const api = await apiPromise
        if (!api) return
        fetcher = new EmoteFetcher(undefined, undefined, { apiClient: api })
      }

      try {
        const tasks: Promise<unknown>[] = []

        if (channelId !== undefined) {
          tasks.push(
            ...[
              fetcher.fetchTwitchEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch Twitch emotes for channel ${channelId}:`, error)
              }),
              fetcher.fetchBTTVEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch BTTV emotes for channel ${channelId}:`, error)
              }),
              fetcher.fetchSevenTVEmotes(channelId, 'avif').catch((error) => {
                console.warn(`Failed to fetch 7TV emotes for channel ${channelId}:`, error)
              }),
              fetcher.fetchFFZEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch FFZ emotes for channel ${channelId}:`, error)
              })
            ]
          )
        }

        if (!globalEmotesFetchPromise) {
          globalEmotesFetchPromise = Promise.all([
            fetcher.fetchTwitchEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch Twitch emotes for global:`, error)
            }),
            fetcher.fetchBTTVEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch BTTV emotes for global:`, error)
            }),
            fetcher.fetchSevenTVEmotes(undefined, 'avif').catch((error) => {
              console.warn(`Failed to fetch 7TV emotes for global:`, error)
            }),
            fetcher.fetchFFZEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch FFZ emotes for global:`, error)
            })
          ])
        }

        await Promise.all([...tasks, globalEmotesFetchPromise])

        if (channelId !== undefined) {
          const globalEmotes = fetcher.channels.get(null as unknown as string)?.emotes
          const emotes = fetcher.channels.get(channelId as unknown as string)?.emotes
          if (globalEmotes && emotes) {
            // Merge global emotes into channel emotes
            for (const [name, emote] of globalEmotes) {
              if (!emotes.has(name)) emotes.set(name, emote)
            }
          }
        }

        channelCache.set(channelId, true)
      } catch (error) {
        channelCache.set(channelId, false)
        console.error(`Failed to fetch emotes for channel ${channelId}:`, error)
      }
    })
  }

  export function getEmotes(channelId?: number): Collection<string, Emote> | null {
    const channel: Channel | undefined = fetcher?.channels.get(
      (channelId ? channelId : null) as unknown as string
    )
    if (!channel) return null
    return channel.emotes
  }
}

export namespace TwitchBadgeService {
  export const globalBadgeCache = new Map<string, Map<string, HelixChatBadgeVersion>>()
  export const channelBadgeCache = new Map<
    string,
    Map<string, Map<string, HelixChatBadgeVersion>>
  >()

  export async function fetchChannelBadges(channelId: string): Promise<void> {
    const api = await apiPromise
    if (!api) return

    return lock.acquire(`badges:channel:${channelId}`, async () => {
      if (channelBadgeCache.has(channelId)) return
      try {
        const badges = await logTime(`Fetching channel badges for channel ID '${channelId}'`, () =>
          api.chat.getChannelBadges(channelId)
        )
        processAndCacheChannelBadges(channelId, badges)
      } catch (error) {
        console.error(`Failed to fetch badges for channel ${channelId}:`, error)
      }
    })
  }

  function processAndCacheChannelBadges(channelId: string, badges: HelixChatBadgeSet[]): void {
    const channelCache = new Map<string, Map<string, HelixChatBadgeVersion>>()

    for (const badge of badges) {
      const versions = new Map<string, HelixChatBadgeVersion>()
      for (const version of badge.versions) versions.set(version.id, version)
      channelCache.set(badge.id, versions)
    }

    channelBadgeCache.set(channelId, channelCache)
  }

  export async function fetchGlobalBadges(): Promise<void> {
    const api = await apiPromise
    if (!api) return

    return lock.acquire('badges:global', async () => {
      if (globalBadgeCache.size > 0) return

      try {
        const badges = await logTime('Fetching global badges', () => api.chat.getGlobalBadges())
        for (const badge of badges) {
          const versions = new Map<string, HelixChatBadgeVersion>()
          for (const version of badge.versions) versions.set(version.id, version)
          globalBadgeCache.set(badge.id, versions)
        }
      } catch (error) {
        console.error('Failed to fetch global badges:', error)
      }
    })
  }

  export async function getBadgeInfo(
    badgeId: string,
    version: string,
    channelId?: string
  ): Promise<HelixChatBadgeVersion | undefined> {
    await fetchGlobalBadges()

    // Check channel badges first
    if (channelId) {
      const channelBadges = channelBadgeCache.get(channelId)
      if (!channelBadges) {
        await fetchChannelBadges(channelId)
        return getBadgeInfo(badgeId, version, channelId)
      } else {
        const badgeSet = channelBadges.get(badgeId)
        if (badgeSet) {
          const badge = badgeSet.get(version)
          if (badge) return badge
        }
      }
    }

    // Fall back to global badges
    const globalBadgeSet = globalBadgeCache.get(badgeId)
    if (globalBadgeSet) {
      return globalBadgeSet.get(version)
    }

    return undefined
  }
}

export namespace TwitchCheerEmoteService {
  export let globalCheerEmotesCache: HelixCheermoteList | null = null
  export const channelCheerEmotesCache = new Map<string, HelixCheermoteList>()

  export async function fetchCheerEmotes(channelId?: string): Promise<void> {
    const api = await apiPromise
    if (!api) return

    const lockKey = channelId ? `cheer-emotes:channel:${channelId}` : 'cheer-emotes:global'

    if (channelId ? channelCheerEmotesCache.has(channelId) : globalCheerEmotesCache) return
    return lock.acquire(lockKey, async () => {
      if (channelId ? channelCheerEmotesCache.has(channelId) : globalCheerEmotesCache) return

      try {
        const fetchLabel = channelId
          ? `Fetching cheer emotes for channel '${channelId}'`
          : 'Fetching global cheer emotes'
        const cheerEmotes = await logTime(fetchLabel, () => api.bits.getCheermotes(channelId))

        if (channelId) {
          channelCheerEmotesCache.set(channelId, cheerEmotes)
        } else {
          globalCheerEmotesCache = cheerEmotes
        }
      } catch (error) {
        console.error(
          `Failed to fetch cheerEmotes${channelId ? ` for channel ${channelId}` : ''}:`,
          error
        )
      }
    })
  }

  export async function getCheerEmoteInfo(
    name: string,
    bits: number,
    channelId?: string,
    format: CheermoteFormat = {
      background: 'dark',
      state: 'animated',
      scale: '4'
    }
  ): Promise<CheerEmote | undefined> {
    await fetchCheerEmotes(channelId)

    const channelCheerEmotes = channelId ? channelCheerEmotesCache.get(channelId) : undefined
    if (channelCheerEmotes) {
      const cheerEmote = channelCheerEmotes.getCheermoteDisplayInfo(name, bits, format)
      if (cheerEmote) return new CheerEmote(cheerEmote, `${name}${bits}`, bits)
    }
    if (globalCheerEmotesCache) {
      const cheerEmote = globalCheerEmotesCache.getCheermoteDisplayInfo(name, bits, format)
      if (cheerEmote) return new CheerEmote(cheerEmote, `${name}${bits}`, bits)
    }
    return undefined
  }
}
