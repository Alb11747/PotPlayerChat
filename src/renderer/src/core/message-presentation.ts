import type { TwitchMessage } from '@/core/chat/twitch-msg'
import type { CheerEmote } from '@/core/chat/twitch-emotes'
import {
  TwitchBadgeService,
  TwitchCheerEmoteService,
  TwitchEmoteService,
  TwitchUserService,
  setConfig
} from '@/core/chat/twitch-api'
import { Collection, type Emote } from '@mkody/twitch-emoticons'
import type { HelixChatBadgeVersion } from '@twurple/api'
import { SvelteMap } from 'svelte/reactivity'
import { formatTime } from '@/utils/strings'
import { parseFullMessage, type Segment } from './chat-dom'
import type { InterfaceSettings } from '../state/settings-model'
import conf from '../state/config'
import { settings } from '../state/settings.svelte'

export interface MessagePresentationOptions {
  showName: InterfaceSettings['showName']
  showTimestamps: boolean
  absoluteTimestamps: boolean
  timestampOffset: number
  videoStartTime?: number
  videoEndTime?: number
  elapsedTime?: number
  enableEmotes: boolean
  enableBadges: boolean
  requireHttpInUrl: boolean
  searchQuery?: string | RegExp
}
export interface MessagePresentation {
  message: TwitchMessage
  prefix: string
  segments: Segment[] | undefined
  timestamp: string | null
  badges: [string, HelixChatBadgeVersion | null][]
}
export function presentationOptions(
  overrides: Partial<MessagePresentationOptions> = {}
): MessagePresentationOptions {
  return {
    showName: settings.interface.showName,
    showTimestamps: settings.interface.showTimestamps,
    absoluteTimestamps: settings.interface.absoluteTimestamps,
    timestampOffset: settings.chat.timestampOffset + settings.chat._sessionTimestampOffset,
    enableEmotes: settings.interface.enableEmotes,
    enableBadges: settings.interface.enableBadges,
    requireHttpInUrl: settings.interface.requireHttpInUrl,
    ...overrides
  }
}
interface Assets {
  emotes?: Collection<string, Emote | CheerEmote> | null
  badges?: [string, HelixChatBadgeVersion | null][]
}

export type MessageLayoutChange =
  | { kind: 'message'; id: string }
  | { kind: 'channel'; channel: string }
  | { kind: 'all' }

/** Transcript-owned parsing survives row recycling without starting offscreen requests. */
export class MessagePresentationStore {
  private assets = new SvelteMap<string, Assets>()
  private channelEmotes = new SvelteMap<string, Collection<string, Emote | CheerEmote>>()
  private parsed = new Map<
    string,
    {
      message: TwitchMessage
      key: string
      assets: Assets | undefined
      emotes: Assets['emotes']
      options: MessagePresentationOptions
      day: string
      value: MessagePresentation
    }
  >()
  private pending = new Map<string, Promise<void>>()
  private retainedIds: Set<string> | null = null
  private revisions = new Map<string, number>()
  private generation = 0
  private cacheState = new SvelteMap([['generation', 0]])
  private timestampSecond = -1
  private timestampDay = ''
  private layoutListeners = new Set<(change: MessageLayoutChange) => void>()

  subscribeLayout(listener: (change: MessageLayoutChange) => void): () => void {
    this.layoutListeners.add(listener)
    return () => this.layoutListeners.delete(listener)
  }

  private notifyLayout(change: MessageLayoutChange): void {
    for (const listener of this.layoutListeners) listener(change)
  }

  private getTimestampDay(): string {
    const now = Date.now()
    const second = Math.floor(now / 1000)
    if (second !== this.timestampSecond) {
      this.timestampSecond = second
      this.timestampDay = new Date(now).toDateString()
    }
    return this.timestampDay
  }

  get(message: TwitchMessage, options: MessagePresentationOptions): MessagePresentation {
    this.cacheState.get('generation')
    const id = message.getId()
    const assets = this.assets.get(id)
    const resolvedEmotes = options.enableEmotes
      ? (assets?.emotes ?? this.channelEmotes.get(message.channel ?? ''))
      : undefined
    const emotes = resolvedEmotes?.size ? resolvedEmotes : undefined
    const day = options.showTimestamps ? this.getTimestampDay() : ''
    const cached = this.parsed.get(id)
    if (
      cached?.message === message &&
      cached.options === options &&
      cached.day === day &&
      cached.assets === assets &&
      cached.emotes === emotes
    )
      return cached.value
    const elapsed =
      options.elapsedTime ??
      (options.videoStartTime !== undefined
        ? message.timestamp + options.timestampOffset - options.videoStartTime
        : undefined)
    const duration =
      options.videoEndTime !== undefined && options.videoStartTime !== undefined
        ? options.videoEndTime - options.videoStartTime
        : undefined
    const absolute =
      options.absoluteTimestamps ||
      elapsed === undefined ||
      elapsed < 0 ||
      (duration !== undefined && elapsed > duration)
    const key = JSON.stringify({
      // Do not run Intl date formatting on cache hits across a large transcript.
      timestamp: !options.showTimestamps ? null : absolute ? day : elapsed,
      showName: options.showName,
      enableEmotes: options.enableEmotes,
      enableBadges: options.enableBadges,
      requireHttpInUrl: options.requireHttpInUrl,
      searchQuery: options.searchQuery?.toString()
    })
    if (
      cached?.message === message &&
      cached.key === key &&
      cached.assets === assets &&
      cached.emotes === emotes
    ) {
      cached.options = options
      cached.day = day
      return cached.value
    }
    const timestamp = options.showTimestamps
      ? formatTime(
          message.timestamp,
          options.absoluteTimestamps
            ? undefined
            : {
                offset: options.timestampOffset,
                startTime: options.videoStartTime,
                endTime: options.videoEndTime,
                elapsedTime: options.elapsedTime
              }
        )
      : null
    const [systemText, systemMessage] =
      message.type === 'system' ? message.getSystemTextAndMessage() : []
    const [prefix, segments] =
      cached?.message === message && cached.key === key && cached.emotes === emotes
        ? [cached.value.prefix, cached.value.segments]
        : parseFullMessage(message, {
            messagePrefix: systemText,
            messageStr: message.type === 'system' ? (systemMessage ?? null) : undefined,
            twitchEmotes: emotes,
            enableEmotes: options.enableEmotes,
            showName: options.showName,
            searchQuery: options.searchQuery,
            requireHttpInUrl: options.requireHttpInUrl
          })
    const value: MessagePresentation = {
      message,
      prefix,
      segments,
      timestamp,
      badges:
        options.enableBadges && message.type === 'chat'
          ? (assets?.badges ?? [...(message.badges ?? [])].map(([id]) => [id, null]))
          : []
    }
    this.parsed.set(id, { message, key, assets, emotes, value, options, day })
    return value
  }

  async load(
    message: TwitchMessage,
    options: Pick<MessagePresentationOptions, 'enableEmotes' | 'enableBadges'>
  ): Promise<void> {
    if (!message.channel) return
    const id = message.getId()
    const existing = this.pending.get(id)
    if (existing) {
      await existing
      return this.load(message, options)
    }
    const old = this.assets.get(id) ?? {}
    const badges = options.enableBadges && old.badges === undefined
    const emotes = options.enableEmotes && old.emotes === undefined
    if (!badges && !emotes) return
    const generation = this.generation
    const revision = this.revisions.get(id) ?? 0
    const task = (async () => {
      setConfig(conf)
      const channel = await TwitchUserService.getUserIdByName(message.channel!)
      const next: Assets = { ...old }
      if (badges) {
        next.badges =
          message.type === 'chat'
            ? await Promise.all(
                [...(message.badges ?? [])].map(
                  async ([badge, version]): Promise<[string, HelixChatBadgeVersion | null]> => [
                    badge,
                    (await TwitchBadgeService.getBadgeInfo(badge, version, channel ?? undefined)) ??
                      null
                  ]
                )
              ).then((items) => items.filter(([, badge]) => badge !== null))
            : []
      }
      if (emotes) {
        const base =
          this.channelEmotes.get(message.channel!) ??
          (await TwitchEmoteService.getEmotes(channel ? Number(channel) : undefined))
        let collection = (base ?? new Collection()) as Collection<string, Emote | CheerEmote>
        // Resolving one mounted row updates estimates for every row in its channel.
        if (
          generation === this.generation &&
          this.channelEmotes.get(message.channel!) !== collection
        ) {
          this.channelEmotes.set(message.channel!, collection)
          this.notifyLayout({ kind: 'channel', channel: message.channel! })
        }
        if (message.bits && message.message) {
          // Most rows can share the service's channel collection. Only cheers add per-message entries.
          collection = new Collection(collection)
          for (const match of message.message.matchAll(/(?:^|\s)(([^\W\d]+)(\d+))(?=\s|$)/g)) {
            const [, token, name, amount] = match
            if (!token || !name || !amount || Number(amount) > Number(message.bits)) continue
            const cheer = await TwitchCheerEmoteService.getCheerEmoteInfo(
              name,
              Number(amount),
              channel ?? undefined
            )
            if (cheer) collection.set(token, cheer)
          }
        }
        next.emotes = collection
      }
      if (
        generation === this.generation &&
        revision === (this.revisions.get(id) ?? 0) &&
        (!this.retainedIds || this.retainedIds.has(id))
      ) {
        this.assets.set(id, next)
        this.notifyLayout({ kind: 'message', id })
      }
    })()
    this.pending.set(id, task)
    try {
      await task
    } finally {
      if (this.pending.get(id) === task) {
        this.pending.delete(id)
        this.revisions.delete(id)
      }
    }
  }

  retain(ids: Iterable<string>): void {
    const keep = new Set(ids)
    for (const id of this.pending.keys()) {
      if (!keep.has(id)) this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
    }
    this.retainedIds = keep
    for (const id of this.parsed.keys()) if (!keep.has(id)) this.parsed.delete(id)
    for (const id of this.assets.keys()) if (!keep.has(id)) this.assets.delete(id)
  }
  clear(): void {
    this.generation++
    this.cacheState.set('generation', this.generation)
    this.assets.clear()
    this.channelEmotes.clear()
    this.parsed.clear()
    this.pending.clear()
    this.revisions.clear()
    this.retainedIds = null
    this.notifyLayout({ kind: 'all' })
  }
}
