import {
  SevenTVEmote as SevenTVEmoteBase,
  type TwitchEmote as BaseTwitchEmote
} from '@mkody/twitch-emoticons'
import type { CheermoteDisplayInfo } from '@twurple/api'
import { buildEmoteImageUrl, type EmoteSize } from '@twurple/chat'

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
      animationSettings: this.animated ? 'default' : 'static',
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
