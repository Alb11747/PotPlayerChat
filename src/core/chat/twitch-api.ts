import { loadTTLSetting, saveTTLSetting } from '@/utils/config'
import { logTime } from '@/utils/debug'
import {
  Channel,
  Collection,
  EmoteFetcher,
  type Emote,
  type EmoteObject
} from '@mkody/twitch-emoticons'
import {
  ApiClient,
  HelixChatBadgeSet,
  HelixChatBadgeVersion,
  HelixCheermoteList
} from '@twurple/api'
import type { CheermoteFormat } from '@twurple/api/lib/endpoints/bits/CheermoteDisplayInfo'
import type { HelixCheermoteData } from '@twurple/api/lib/interfaces/endpoints/bits.external'
import type { HelixChatBadgeVersionData } from '@twurple/api/lib/interfaces/endpoints/chat.external'
import { AppTokenAuthProvider } from '@twurple/auth'
import { getRawData } from '@twurple/common'
import AsyncLock from 'async-lock'
import { Conf } from 'electron-conf/renderer'
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

export let setConfig: (config: Conf) => void
const configPromise = new Promise<Conf>((resolve) => {
  setConfig = resolve
})

/* eslint-disable @typescript-eslint/no-namespace */

const ttl = 24 * 60 * 60 * 1000

export namespace TwitchUserService {
  export const userIdCache = new Map<string, string | null>()

  const configKey = 'cache:twitch-user-id'
  type CacheValue = Record<string, string | null>
  const loadCachePromise = loadTTLSetting<CacheValue>(configPromise, configKey, ttl).then(
    (data) => {
      try {
        if (data) for (const [key, value] of Object.entries(data)) userIdCache.set(key, value)
      } catch (error) {
        console.error('Failed to load user ID cache:', error, data)
      }
    }
  )

  /**
   * Get a Twitch user ID from a username
   */
  export async function getUserIdByName(username: string): Promise<string | null> {
    if (userIdCache.has(username)) return userIdCache.get(username) ?? null
    return await lock.acquire(`userid:${username}`, async () => {
      await loadCachePromise
      if (userIdCache.has(username)) return userIdCache.get(username) ?? null

      const api = await apiPromise
      if (!api) return null

      try {
        const user = await logTime(`Fetching Twitch user ID for username: ${username}`, () =>
          api.users.getUserByName(username)
        )
        const userId = user?.id ?? null
        userIdCache.set(username, userId)
        saveCache()

        return userId
      } catch {
        userIdCache.set(username, null)
        return null
      }
    })
  }

  export function clear(): void {
    userIdCache.clear()
    saveCache()
  }

  function saveCache(): void {
    saveTTLSetting<CacheValue>(configPromise, configKey, Object.fromEntries(userIdCache.entries()))
  }
}

const lock = new AsyncLock()

/**
 * Service for fetching and parsing Twitch, BTTV, FFZ, and 7TV emotes, with per-channel caching.
 */
export namespace TwitchEmoteService {
  let fetcher: EmoteFetcher | null = null
  const fetcherPromise = (async () => {
    const api = await apiPromise
    if (!api) return null
    fetcher = new EmoteFetcher(undefined, undefined, { apiClient: api })
    return fetcher
  })()

  type CacheValue = EmoteObject[]

  /**
   * Fetches all emotes (Twitch, BTTV, FFZ, 7TV) for a channel and caches them.
   * Uses async-lock to prevent duplicate fetches for the same channel.
   * @param channelId Twitch user/channel ID (number or string). Use undefined for global emotes.
   */
  export async function fetchAllEmotes(channelId?: number): Promise<void> {
    const fetcher = await fetcherPromise
    if (!fetcher) return

    if (fetcher.channels.has(channelId as unknown as string)) return

    await lock.acquire(String(channelId ?? 'global'), async () => {
      if (fetcher.channels.has(channelId as unknown as string)) return

      // Load cached emotes
      const cachedEmotesObjects = await loadTTLSetting<CacheValue>(
        configPromise,
        getCacheKey(channelId ?? null),
        ttl
      )
      if (cachedEmotesObjects) {
        try {
          await lock.acquire(`emotes-${channelId}`, () => {
            if (fetcher.channels.has(channelId as unknown as string)) return
            const cachedEmotes = fetcher.fromObject(cachedEmotesObjects)
            for (const [i, emote] of cachedEmotesObjects.entries())
              if ('zeroWidth' in emote && emote.zeroWidth)
                (cachedEmotes[i] as unknown as Record<string, unknown>)['zeroWidth'] =
                  emote.zeroWidth

            const channel = fetcher.channels.get(channelId as unknown as string)
            if (channel) {
              for (const emote of cachedEmotes)
                if (!channel.emotes.get(emote.code)) channel.emotes.set(emote.code, emote)
            } else {
              const channel = new Channel(fetcher, channelId ?? (null as unknown as number))
              for (const emote of cachedEmotes) channel.emotes.set(emote.code, emote)
              fetcher.channels.set(channelId as unknown as string, channel)
            }
          })
        } catch (error) {
          console.error('Failed to load emote cache:', error, cachedEmotesObjects)
        }
        if (fetcher.channels.has(channelId as unknown as string)) return
      }

      let loadGlobalEmotesPromise: Promise<unknown> | undefined = undefined
      let loadChannelEmotesPromise: Promise<unknown> | undefined = undefined

      if (!fetcher.channels.has(null as unknown as string)) {
        loadGlobalEmotesPromise = lock.acquire('global-emotes', async () => {
          if (fetcher.channels.has(null as unknown as string)) return
          try {
            await logTime('Fetching global emotes', () =>
              Promise.all([
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
            )
          } catch (error) {
            console.error('Failed to fetch global emotes:', error)
            fetcher.channels.set(
              null as unknown as string,
              new Channel(fetcher, null as unknown as number)
            )
          }
          saveCache(null)
        })
      }

      if (channelId !== undefined) {
        if (fetcher.channels.has(channelId as unknown as string)) return
        loadChannelEmotesPromise = lock.acquire(`emotes-${channelId}`, async () => {
          if (fetcher.channels.has(channelId as unknown as string)) return
          try {
            await logTime(`Fetching channel emotes for channel ${channelId}`, () =>
              Promise.all([
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
              ])
            )
          } catch (error) {
            console.error(`Failed to fetch emotes for channel ${channelId}:`, error)
            fetcher.channels.set(channelId as unknown as string, new Channel(fetcher, channelId))
          }

          if (loadGlobalEmotesPromise) await loadGlobalEmotesPromise

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

          saveCache(channelId)
        })
      }

      if (loadGlobalEmotesPromise) await loadGlobalEmotesPromise
      if (loadChannelEmotesPromise) await loadChannelEmotesPromise
    })
  }

  export async function getEmotes(channelId?: number): Promise<Collection<string, Emote> | null> {
    await fetchAllEmotes(channelId)
    if (!fetcher) return null
    const channel: Channel | undefined = fetcher.channels.get(
      (channelId ? channelId : null) as unknown as string
    )
    if (!channel) return null
    return channel.emotes
  }

  export function clear(channelId?: number): void {
    if (channelId) {
      fetcher?.channels.delete(channelId as unknown as string)
      fetcher?.channels.delete(null as unknown as string)
    } else {
      fetcher?.channels.clear()
    }
    saveCache(channelId ?? null)
  }

  function getCacheKey(channelId: number | null): string {
    return `cache:twitch-emotes-${channelId ?? 'global'}`
  }

  async function saveCache(channelId: number | null): Promise<void> {
    if (!fetcher) return
    const emotes = fetcher.channels.get(channelId as unknown as string)?.emotes
    const emotesObjects = emotes
      ? Array.from(
          emotes
            .values()
            .map((emote) => (emote as unknown as { toObject: () => EmoteObject }).toObject())
        )
      : undefined
    saveTTLSetting<CacheValue | undefined>(configPromise, getCacheKey(channelId), emotesObjects)
  }
}

export namespace TwitchBadgeService {
  export const channelBadgeCache = new Map<
    string | null,
    Map<string, Map<string, HelixChatBadgeVersion>> | undefined
  >()

  const configKey = 'cache:twitch-badges'
  type CacheValue = Record<string, Record<string, Record<string, HelixChatBadgeVersionData>>>
  const loadCachePromise = loadTTLSetting<CacheValue>(configPromise, configKey, ttl).then(
    (data) => {
      if (!data) return
      try {
        for (const [key, value] of Object.entries(data)) {
          const map = new Map<string, Map<string, HelixChatBadgeVersion>>()
          for (const [key2, value2] of Object.entries(value)) {
            const map2 = new Map<string, HelixChatBadgeVersion>()
            for (const [key3, value3] of Object.entries(value2))
              map2.set(key3, new HelixChatBadgeVersion(value3))
            map.set(key2, map2)
          }
          channelBadgeCache.set(key, map)
        }
      } catch (error) {
        console.error('Failed to load badge cache:', error, data)
      }
    }
  )

  export async function fetchChannelBadges(channelId: string): Promise<void> {
    await loadCachePromise
    if (channelBadgeCache.has(channelId)) return

    const api = await apiPromise
    if (!api) return

    return lock.acquire(`badges:channel:${channelId}`, async () => {
      if (channelBadgeCache.has(channelId)) return
      try {
        const badges = await logTime(`Fetching channel badges for channel ID '${channelId}'`, () =>
          api.chat.getChannelBadges(channelId)
        )
        processAndCacheChannelBadges(channelId, badges)
        saveCache()
      } catch (error) {
        console.error(`Failed to fetch badges for channel ${channelId}:`, error)
        channelBadgeCache.set(channelId, undefined)
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
    await loadCachePromise
    if (channelBadgeCache.has(null)) return

    const api = await apiPromise
    if (!api) return

    return lock.acquire('badges:global', async () => {
      const globalBadgeCache = channelBadgeCache.get(null)
      if (!globalBadgeCache) return

      try {
        const badges = await logTime('Fetching global badges', () => api.chat.getGlobalBadges())
        for (const badge of badges) {
          const versions = new Map<string, HelixChatBadgeVersion>()
          for (const version of badge.versions) versions.set(version.id, version)
          globalBadgeCache.set(badge.id, versions)
        }
        saveCache()
      } catch (error) {
        console.error('Failed to fetch global badges:', error)
        channelBadgeCache.set(null, undefined)
      }
    })
  }

  export async function getBadgeInfo(
    badgeId: string,
    version: string,
    channelId?: string
  ): Promise<HelixChatBadgeVersion | undefined> {
    // Check channel badges first
    if (channelId) {
      await fetchChannelBadges(channelId)
      const channelBadges = channelBadgeCache.get(channelId)
      if (channelBadges) {
        const badgeSet = channelBadges.get(badgeId)
        if (badgeSet) {
          const badge = badgeSet.get(version)
          if (badge) return badge
        }
      }
    }

    // Fall back to global badges
    await fetchGlobalBadges()
    const globalBadgeSet = channelBadgeCache.get(null)?.get(badgeId)
    if (globalBadgeSet) return globalBadgeSet.get(version)

    return undefined
  }

  export function clear(channelId?: string): void {
    if (channelId) {
      channelBadgeCache.delete(channelId)
      channelBadgeCache.delete(null)
    } else {
      channelBadgeCache.clear()
    }
    saveCache()
  }

  function saveCache(): void {
    const data: CacheValue = {}
    for (const [key, value] of channelBadgeCache.entries()) {
      const subData: Record<string, Record<string, HelixChatBadgeVersionData>> = {}
      for (const [key2, value2] of value?.entries() ?? []) {
        const subData2: Record<string, HelixChatBadgeVersionData> = {}
        for (const [key3, value3] of value2.entries()) subData2[key3] = getRawData(value3)
        subData[key2] = subData2
      }
      data[key || ''] = subData
    }
    saveTTLSetting<CacheValue>(configPromise, configKey, data)
  }
}

export namespace TwitchCheerEmoteService {
  export const channelCheerEmotesCache = new Map<string | null, HelixCheermoteList | undefined>()

  const configKey = 'cache:twitch-cheer-emotes'
  type CacheValue = Record<string, Record<string, HelixCheermoteData> | undefined>
  const loadCachePromise = loadTTLSetting<CacheValue>(configPromise, configKey, ttl).then(
    (data) => {
      try {
        if (!data) return
        for (const [key, value] of Object.entries(data)) {
          // @ts-ignore HelixCheermoteList has incorrect type
          const cheerEmotes = new HelixCheermoteList(Array.from(Object.values(value)))
          channelCheerEmotesCache.set(key, cheerEmotes)
        }
      } catch (error) {
        console.error('Failed to load cheer emote cache:', error, data)
        channelCheerEmotesCache.set(null, undefined)
      }
    }
  )

  export async function fetchCheerEmotes(channelId?: string): Promise<void> {
    await loadCachePromise
    if (channelCheerEmotesCache.has(channelId ?? null)) return

    const api = await apiPromise
    if (!api) return

    const lockKey = channelId ? `cheer-emotes:channel:${channelId}` : 'cheer-emotes:global'
    await lock.acquire(lockKey, async () => {
      if (channelCheerEmotesCache.has(channelId ?? null)) return

      try {
        const fetchLabel = channelId
          ? `Fetching cheer emotes for channel '${channelId}'`
          : 'Fetching global cheer emotes'
        const cheerEmotes = await logTime(fetchLabel, () => api.bits.getCheermotes(channelId))

        if (channelId) {
          channelCheerEmotesCache.set(channelId, cheerEmotes)
        } else {
          channelCheerEmotesCache.set(null, cheerEmotes)
        }
        saveCache()
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
    const globalCheerEmotes = channelCheerEmotesCache.get(null)
    if (globalCheerEmotes) {
      const cheerEmote = globalCheerEmotes.getCheermoteDisplayInfo(name, bits, format)
      if (cheerEmote) return new CheerEmote(cheerEmote, `${name}${bits}`, bits)
    }
    return undefined
  }

  export function clear(channelId?: string): void {
    if (channelId) {
      channelCheerEmotesCache.delete(channelId)
      channelCheerEmotesCache.delete(null)
    } else {
      channelCheerEmotesCache.clear()
    }
    saveCache()
  }

  function saveCache(): void {
    saveTTLSetting<CacheValue>(
      configPromise,
      configKey,
      Object.fromEntries(
        channelCheerEmotesCache
          .entries()
          .map(([key, value]) => [key, value ? getRawData(value) : undefined])
      )
    )
  }
}

export function clearAll(
  userId?: number | string,
  {
    userIds = false,
    emotes = true,
    badges = true,
    cheerEmotes = true
  }: {
    userIds?: boolean
    emotes?: boolean
    badges?: boolean
    cheerEmotes?: boolean
  } = {}
): void {
  if (typeof userId === 'string') userId = parseInt(userId)
  if (userIds) TwitchUserService.clear()
  if (emotes) TwitchEmoteService.clear(userId)
  if (badges) TwitchBadgeService.clear(userId?.toString())
  if (cheerEmotes) TwitchCheerEmoteService.clear(userId?.toString())
}
