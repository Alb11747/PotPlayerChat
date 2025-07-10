import {
  EmoteFetcher,
  type TwitchEmote as BaseTwitchEmote,
  type Channel,
  type Collection,
  type Emote
} from '@mkody/twitch-emoticons'
import { buildEmoteImageUrl, type EmoteSize } from '@twurple/chat'
import AsyncLock from 'async-lock'

export interface TwitchEmote extends BaseTwitchEmote {
  sizes: string[]
}

export class NativeTwitchEmote {
  public static readonly sizes: EmoteSize[] = ['1.0', '2.0', '3.0']

  constructor(
    public id: string,
    public name?: string
  ) {}

  get sizes(): EmoteSize[] {
    return NativeTwitchEmote.sizes
  }

  toLink(size: number): string {
    return buildEmoteImageUrl(this.id, {
      animationSettings: 'animated',
      size: this.sizes[size] || '1.0'
    })
  }
}

/**
 * Service for fetching and parsing Twitch, BTTV, FFZ, and 7TV emotes, with per-channel caching.
 */
export class TwitchEmoteService {
  private fetcher: EmoteFetcher

  private channelCache: Map<number | undefined, boolean>
  private globalEmotesFetchPromise: Promise<unknown> | null = null
  private lock = new AsyncLock()

  constructor({
    clientId,
    clientSecret
  }: {
    clientId?: string
    clientSecret?: string
  } = {}) {
    this.fetcher = new EmoteFetcher(clientId, clientSecret)
    this.channelCache = new Map()
  }

  /**
   * Fetches all emotes (Twitch, BTTV, FFZ, 7TV) for a channel and caches them.
   * Uses async-lock to prevent duplicate fetches for the same channel.
   * @param channelId Twitch user/channel ID (number or string). Use undefined for global emotes.
   */
  async fetchAllEmotes(channelId?: number): Promise<void> {
    if (this.channelCache.get(channelId) !== undefined) return

    await this.lock.acquire(String(channelId ?? 'global'), async () => {
      if (this.channelCache.get(channelId)) return
      try {
        const tasks: Promise<unknown>[] = []

        if (channelId !== undefined) {
          tasks.push(
            ...[
              this.fetcher.fetchTwitchEmotes(channelId),
              this.fetcher.fetchBTTVEmotes(channelId),
              this.fetcher.fetchSevenTVEmotes(channelId, 'avif'),
              this.fetcher.fetchFFZEmotes(channelId)
            ]
          )
        }

        if (!this.globalEmotesFetchPromise) {
          this.globalEmotesFetchPromise = Promise.all([
            this.fetcher.fetchTwitchEmotes(undefined),
            this.fetcher.fetchBTTVEmotes(undefined),
            this.fetcher.fetchSevenTVEmotes(undefined, 'avif'),
            this.fetcher.fetchFFZEmotes(undefined)
          ])
        }

        await Promise.all([...tasks, this.globalEmotesFetchPromise])

        if (channelId !== undefined) {
          const globalEmotes = this.fetcher.channels.get(null as unknown as string)?.emotes
          const emotes = this.fetcher.channels.get(channelId as unknown as string)?.emotes
          if (globalEmotes && emotes) {
            // Merge global emotes into channel emotes
            for (const [name, emote] of globalEmotes) {
              if (!emotes.has(name)) emotes.set(name, emote)
            }
          }
        }

        this.channelCache.set(channelId, true)
      } catch (error) {
        this.channelCache.set(channelId, false)
        console.error(`Failed to fetch emotes for channel ${channelId}:`, error)
      }
    })
  }

  getEmotes(channelId?: number): Collection<string, Emote> | null {
    const channel: Channel | undefined = this.fetcher.channels.get(
      (channelId ? channelId : null) as unknown as string
    )
    if (!channel) return null
    return channel.emotes
  }
}

export const mainEmoteService = (async (): Promise<TwitchEmoteService | null> => {
  const keys = await window.api.loadKeys()
  if (!keys.twitch) {
    console.warn('Twitch keys not found, emote service will not work')
    return null
  }
  return new TwitchEmoteService({
    clientId: keys.twitch.clientId,
    clientSecret: keys.twitch.clientSecret
  })
})()
