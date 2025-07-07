import type { IrcMessage } from './irc'

export type TwitchMessage = TwitchChatMessage | TwitchSystemMessage

export class TwitchChatMessage {
  public static readonly source = 'twitch'
  public static readonly type = 'message'

  public readonly raw: string
  public readonly tags: Record<string, string>
  public readonly id: string
  public readonly timestamp: number
  public readonly channel: string
  public readonly username: string
  public readonly message: string

  constructor(
    raw: string,
    tags: Record<string, string>,
    id: string,
    timestamp: number,
    channel: string,
    username: string,
    message: string
  ) {
    this.raw = raw
    this.tags = tags
    this.id = id
    this.timestamp = timestamp
    this.channel = channel
    this.username = username
    this.message = message
  }

  // Optional Twitch tags as getters
  get displayName(): string | undefined {
    return this.tags['display-name']
  }
  get badgeInfo(): string | undefined {
    return this.tags['badge-info']
  }
  get badges(): string | undefined {
    return this.tags['badges']
  }
  get bits(): string | undefined {
    return this.tags['bits']
  }
  get clientNonce(): string | undefined {
    return this.tags['client-nonce']
  }
  get color(): string | undefined {
    return this.tags['color']
  }
  get emotes(): string | undefined {
    return this.tags['emotes']
  }
  get firstMsg(): string | undefined {
    return this.tags['first-msg']
  }
  get flags(): string | undefined {
    return this.tags['flags']
  }
  get mod(): string | undefined {
    return this.tags['mod']
  }
  get returningChatter(): string | undefined {
    return this.tags['returning-chatter']
  }
  get roomId(): string | undefined {
    return this.tags['room-id']
  }
  get subscriber(): string | undefined {
    return this.tags['subscriber']
  }
  get turbo(): string | undefined {
    return this.tags['turbo']
  }
  get userId(): string | undefined {
    return this.tags['user-id']
  }
  get userType(): string | undefined {
    return this.tags['user-type']
  }
  get replyParentMsgId(): string | undefined {
    return this.tags['reply-parent-msg-id']
  }
  get replyParentUserId(): string | undefined {
    return this.tags['reply-parent-user-id']
  }
  get replyParentUserLogin(): string | undefined {
    return this.tags['reply-parent-user-login']
  }
  get replyParentDisplayName(): string | undefined {
    return this.tags['reply-parent-display-name']
  }
  get replyParentMsgBody(): string | undefined {
    return this.tags['reply-parent-msg-body']
  }
  get replyThreadParentMsgId(): string | undefined {
    return this.tags['reply-thread-parent-msg-id']
  }
  get replyThreadParentUserLogin(): string | undefined {
    return this.tags['reply-thread-parent-user-login']
  }
  get vip(): string | undefined {
    return this.tags['vip']
  }
  get sourceBadges(): string | undefined {
    return this.tags['source-badges']
  }
  get sourceBadgeInfo(): string | undefined {
    return this.tags['source-badge-info']
  }
  get sourceId(): string | undefined {
    return this.tags['source-id']
  }
  get sourceOnly(): string | undefined {
    return this.tags['source-only']
  }
  get sourceRoomId(): string | undefined {
    return this.tags['source-room-id']
  }

  public static fromIrcMessage(ircMessage: IrcMessage): TwitchChatMessage {
    if (ircMessage.command !== 'PRIVMSG')
      throw new Error('Cannot create TwitchMessage from non-PRIVMSG command')

    const id = ircMessage.tags.get('id')
    if (!id) throw new Error('Twitch message must have an ID')
    const timestamp = ircMessage.tags.get('tmi-sent-ts')
    if (!timestamp) throw new Error('Twitch message must have a timestamp')
    const username = ircMessage.username
    if (!username) throw new Error('Twitch message must have a username')

    return new TwitchChatMessage(
      ircMessage.raw,
      Object.fromEntries(ircMessage.tags),
      id,
      parseInt(timestamp, 10),
      ircMessage.channel,
      username,
      ircMessage.text
    )
  }

  public getDisplayName(): string {
    return this.displayName || this.username
  }
}

export class TwitchSystemMessage {
  public static readonly source = 'twitch'
  public static readonly type = 'system'

  public readonly raw: string
  public readonly tags: Record<string, string>
  public readonly timestamp: number
  public readonly command?: string
  public readonly channel: string
  public readonly message: string
  public readonly systemText?: string

  constructor(
    raw: string,
    tags: Record<string, string>,
    timestamp: number,
    command: string | undefined,
    channel: string,
    message: string,
    systemText?: string
  ) {
    this.raw = raw
    this.tags = tags
    this.timestamp = timestamp
    this.command = command
    this.channel = channel
    this.message = message
    this.systemText = systemText
  }

  get getSystemText(): string {
    if (this.systemText) return this.systemText
    if (this.command === 'CLEARCHAT') {
      const banDuration = this.banDuration
      if (banDuration) {
        return `${this.message} has been timed out for ${banDuration} seconds`
      } else {
        return `${this.message} has been banned`
      }
    }
    return this.message
  }

  get banDuration(): string | undefined {
    return this.tags['ban-duration']
  }

  get roomId(): string | undefined {
    return this.tags['room-id']
  }

  get targetUserId(): string | undefined {
    return this.tags['target-user-id']
  }

  get id(): string | undefined {
    return this.tags['id']
  }

  get username(): string | undefined {
    return this.message
  }

  public static fromIrcMessage(ircMessage: IrcMessage): TwitchSystemMessage {
    if (ircMessage.command === 'PRIVMSG')
      throw new Error('Cannot create TwitchSystemMessage from a regular message')

    const timestamp = ircMessage.tags.get('tmi-sent-ts')
    if (!timestamp) throw new Error('Twitch system message must have a timestamp')
    const message = ircMessage.text
    if (!message) throw new Error('Twitch system message must have a message')

    return new TwitchSystemMessage(
      ircMessage.raw,
      Object.fromEntries(ircMessage.tags),
      parseInt(timestamp, 10),
      ircMessage.command,
      ircMessage.channel,
      message
    )
  }
}
