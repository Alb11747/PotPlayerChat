import {
  Emote,
  EmoteFetcher,
  SevenTVEmote as SevenTVEmoteBase,
  type TwitchEmote as BaseTwitchEmote,
  type Channel,
  type Collection
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
    public name?: string,
    public animated: boolean = true
  ) {}

  get sizes(): EmoteSize[] {
    return NativeTwitchEmote.sizes
  }

  toLink(size: number): string {
    return buildEmoteImageUrl(this.id, {
      animationSettings: this.animated ? 'animated' : 'static',
      size: this.sizes[size] || '1.0'
    })
  }
}

export interface SevenTVEmote extends SevenTVEmoteBase {
  zeroWidth?: boolean
}

// Monkey patch SevenTVEmote to support extra data
const sevenTVEmotePrototype = SevenTVEmoteBase.prototype as unknown as {
  _setup: (this: SevenTVEmote, data: Record<string, unknown>) => void
}

const originalSevenTVEmoteSetup = sevenTVEmotePrototype._setup
sevenTVEmotePrototype._setup = function (data) {
  originalSevenTVEmoteSetup.call(this, data)
  const emote = this as SevenTVEmote
  const flags = typeof data['flags'] === 'number' ? data['flags'] : 0
  emote.zeroWidth = flags & 0b00000001 ? true : false
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
              this.fetcher.fetchTwitchEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch Twitch emotes for channel ${channelId}:`, error)
              }),
              this.fetcher.fetchBTTVEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch BTTV emotes for channel ${channelId}:`, error)
              }),
              this.fetcher.fetchSevenTVEmotes(channelId, 'avif').catch((error) => {
                console.warn(`Failed to fetch 7TV emotes for channel ${channelId}:`, error)
              }),
              this.fetcher.fetchFFZEmotes(channelId).catch((error) => {
                console.warn(`Failed to fetch FFZ emotes for channel ${channelId}:`, error)
              })
            ]
          )
        }

        if (!this.globalEmotesFetchPromise) {
          this.globalEmotesFetchPromise = Promise.all([
            this.fetcher.fetchTwitchEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch Twitch emotes for global:`, error)
            }),
            this.fetcher.fetchBTTVEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch BTTV emotes for global:`, error)
            }),
            this.fetcher.fetchSevenTVEmotes(undefined, 'avif').catch((error) => {
              console.warn(`Failed to fetch 7TV emotes for global:`, error)
            }),
            this.fetcher.fetchFFZEmotes(undefined).catch((error) => {
              console.warn(`Failed to fetch FFZ emotes for global:`, error)
            })
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
