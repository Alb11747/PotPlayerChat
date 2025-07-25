import { millifyTimedelta } from '@/utils/time'
import { escapeIrcText, parseIrcMessages, type IrcMessage } from './irc'

export type TwitchMessage = TwitchChatMessage | TwitchSystemMessage

abstract class TwitchBaseMessage {
  public readonly source = 'twitch'
  public readonly type?: 'chat' | 'system'

  constructor(
    public readonly raw: string,
    public readonly tags: Record<string, string>,
    public readonly timestamp: number
  ) {}

  public abstract getId(): string

  get bits(): string | undefined {
    return this.tags['bits']
  }

  get emotes(): { id: string; startIndex: number; endIndex: number }[] | undefined {
    const emotesRaw = this.tags['emotes']
    if (!emotesRaw) return undefined

    // emotes=25:0-4,12-16/1902:6-10;
    // Split by '/' for each emote id group
    return emotesRaw.split('/').flatMap((group) => {
      const [id, ranges] = group.split(':')
      if (!id || !ranges) return []
      const emotes: { id: string; startIndex: number; endIndex: number }[] = []
      for (const range of ranges.split(',')) {
        const [start, end] = range.split('-').map(Number)
        if (Number.isNaN(start) || Number.isNaN(end)) continue
        if (start !== undefined && end !== undefined) {
          emotes.push({ id, startIndex: start, endIndex: end })
        }
      }
      return emotes
    })
  }
}

export class TwitchChatMessage extends TwitchBaseMessage {
  public override readonly type = 'chat'

  constructor(
    raw: string,
    tags: Record<string, string>,
    public readonly id: string,
    timestamp: number,
    public readonly channel: string,
    public readonly username: string,
    public readonly message: string
  ) {
    super(raw, tags, timestamp)
  }

  public override getId(): string {
    return this.id
  }

  // Optional Twitch tags as getters
  get displayName(): string | undefined {
    return this.tags['display-name']
  }

  private static parseBadgeStr(badgeStr: string): Map<string, string> {
    const badges: Map<string, string> = new Map()
    const pairs = badgeStr.split(',')
    for (const pair of pairs) {
      const [id, version] = pair.split('/')
      if (id && version) {
        badges.set(id, version)
      }
    }
    return badges
  }

  get badgeInfo(): Map<string, string> | undefined {
    const badgeInfoStr = this.tags['badge-info']
    if (!badgeInfoStr) return undefined
    return TwitchChatMessage.parseBadgeStr(badgeInfoStr)
  }
  get badges(): Map<string, string> | undefined {
    const badgesStr = this.tags['badges']
    if (!badgesStr) return undefined
    return TwitchChatMessage.parseBadgeStr(badgesStr)
  }

  get clientNonce(): string | undefined {
    return this.tags['client-nonce']
  }
  get color(): string | undefined {
    return this.tags['color']
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
    const message = ircMessage.text
    if (!message) throw new Error('Twitch message must have text content')

    return new TwitchChatMessage(
      ircMessage.raw,
      Object.fromEntries(ircMessage.tags),
      id,
      parseInt(timestamp, 10),
      ircMessage.channel,
      username,
      message
    )
  }

  public getDisplayName(): string {
    return this.displayName || this.username
  }
}

export class TwitchSystemMessage extends TwitchBaseMessage {
  public override readonly type = 'system'

  private tempId: string | undefined

  constructor(
    raw: string,
    tags: Record<string, string>,
    timestamp: number,
    public readonly command: string | undefined,
    public readonly channel: string,
    public readonly message: string | undefined,
    public readonly systemText?: string
  ) {
    super(raw, tags, timestamp)
  }

  public override getId(): string {
    if (this.id) return this.id
    if (this.tempId) return this.tempId
    return (this.tempId = `${this.timestamp}-${this.command || 'unknown'}-${this.channel}-${this.message || ''}`)
  }

  public getSystemTextAndMessage(
    lastRoomStateTags?: Record<string, string>
  ): [string, string | undefined] {
    if (this.systemText) return [this.systemText, undefined]
    if (this.command === 'CLEARCHAT') {
      const user = this.message
      const banDuration = this.banDuration
      if (user) {
        if (banDuration) {
          const secondsNumber = parseInt(banDuration, 10)
          const duration = !Number.isNaN(secondsNumber)
            ? millifyTimedelta(secondsNumber, { long: true })
            : `${banDuration} seconds`
          return [`${user} has been timed out for ${duration}`, undefined]
        } else {
          return [`${user} has been banned`, undefined]
        }
      } else {
        return ['All chat messages have been cleared', undefined]
      }
    } else if (this.command === 'CLEARMSG') {
      const login = this.tags['login'] || 'Unknown'
      const msg = this.message || ''
      return [`A message from ${login} was deleted: "${msg}"`, undefined]
    } else if (this.command === 'GLOBALUSERSTATE') {
      const displayName = this.tags['display-name'] || 'Unknown'
      const color = this.tags['color'] || 'no color'
      const badges = this.tags['badges'] || 'no badges'
      const emoteSets = this.tags['emote-sets'] || 'none'
      const userType = this.tags['user-type'] || 'user'
      const turbo = this.tags['turbo'] === '1'
      let info = `Authenticated as ${displayName} (${userType}, badges: ${badges}, color: ${color}, emote sets: ${emoteSets})`
      if (turbo) info += ', turbo'
      return [info, undefined]
    } else if (this.command === 'NOTICE') {
      const msgId = this.tags['msg-id']
      const msg = this.message || ''
      switch (msgId) {
        case 'emote_only_off':
          return ['This room is no longer in emote-only mode.', undefined]
        case 'emote_only_on':
          return ['This room is now in emote-only mode.', undefined]
        case 'followers_off':
          return ['This room is no longer in followers-only mode.', undefined]
        case 'followers_on': {
          let duration: string | undefined =
            this.tags['duration'] || lastRoomStateTags?.['followers']
          if (duration) {
            const minutes = parseInt(duration, 10)
            if (!Number.isNaN(minutes)) {
              duration = millifyTimedelta(minutes * 60, { long: true })
            }
          } else {
            duration = '<duration>'
          }
          return [`This room is now in ${duration} followers-only mode.`, undefined]
        }
        case 'followers_on_zero':
          return ['This room is now in followers-only mode.', undefined]
        case 'msg_banned':
          return [`You are permanently banned from talking in ${this.channel}.`, undefined]
        case 'msg_bad_characters':
          return [
            'Your message was not sent because it contained too many unprocessable characters. If you believe this is an error, please rephrase and try again.',
            undefined
          ]
        case 'msg_channel_blocked':
          return [
            'Your message was not sent because your account is not in good standing in this channel.',
            undefined
          ]
        case 'msg_channel_suspended':
          return ['This channel does not exist or has been suspended.', undefined]
        case 'msg_duplicate':
          return [
            'Your message was not sent because it is identical to the previous one you sent, less than 30 seconds ago.',
            undefined
          ]
        case 'msg_emoteonly':
          return [
            'This room is in emote-only mode. You can find your currently available emoticons using the smiley in the chat text area.',
            undefined
          ]
        case 'msg_followersonly': {
          let duration: string | undefined =
            this.tags['duration'] || lastRoomStateTags?.['followers']
          if (duration) {
            const minutes = parseInt(duration, 10)
            if (!Number.isNaN(minutes)) {
              duration = millifyTimedelta(minutes * 60, { long: true })
            }
          } else {
            duration = '<duration>'
          }
          return [
            `This room is in ${duration} followers-only mode. Follow ${this.channel} to join the community!`,
            undefined
          ]
        }
        case 'msg_followersonly_followed': {
          let duration1: string | undefined = this.tags['duration1']
          if (duration1) {
            const minutes = parseInt(duration1, 10)
            if (!Number.isNaN(minutes)) {
              duration1 = millifyTimedelta(minutes * 60, { long: true })
            }
          } else {
            duration1 = '<duration1>'
          }
          let duration2: string | undefined = this.tags['duration2']
          if (duration2) {
            const minutes = parseInt(duration2, 10)
            if (!Number.isNaN(minutes)) {
              duration2 = millifyTimedelta(minutes * 60, { long: true })
            }
          } else {
            duration2 = '<duration2>'
          }
          return [
            `This room is in ${duration1} followers-only mode. You have been following for ${duration2}. Continue following to chat!`,
            undefined
          ]
        }
        case 'msg_followersonly_zero':
          return [
            `This room is in followers-only mode. Follow ${this.channel} to join the community!`,
            undefined
          ]
        case 'msg_r9k':
          return [
            'This room is in unique-chat mode and the message you attempted to send is not unique.',
            undefined
          ]
        case 'msg_ratelimit':
          return [
            'Your message was not sent because you are sending messages too quickly.',
            undefined
          ]
        case 'msg_rejected':
          return ['Hey! Your message is being checked by mods and has not been sent.', undefined]
        case 'msg_rejected_mandatory':
          return [
            'Your message wasn’t posted due to conflicts with the channel’s moderation settings.',
            undefined
          ]
        case 'msg_requires_verified_phone_number':
          return [
            'A verified phone number is required to chat in this channel. Please visit https://www.twitch.tv/settings/security to verify your phone number.',
            undefined
          ]
        case 'msg_slowmode': {
          let seconds = this.tags['number'] || lastRoomStateTags?.['slow']
          if (seconds) {
            const secondsNumber = parseInt(seconds, 10)
            if (!Number.isNaN(secondsNumber))
              seconds = millifyTimedelta(secondsNumber, { long: true })
          }
          return [
            `This room is in slow mode and you are sending messages too quickly. You will be able to talk again in ${seconds || '<number> seconds'}.`,
            undefined
          ]
        }
        case 'msg_subsonly': {
          return [
            `This room is in subscribers only mode. To talk, purchase a channel subscription at https://www.twitch.tv/products/${this.channel}/ticket?ref=subscriber_only_mode_chat.`,
            undefined
          ]
        }
        case 'msg_suspended':
          return ['You don’t have permission to perform that action.', undefined]
        case 'msg_timedout': {
          let seconds: string | undefined =
            this.tags['number'] || lastRoomStateTags?.['ban-duration']
          if (seconds) {
            const secondsNumber = parseInt(seconds, 10)
            if (!Number.isNaN(secondsNumber)) {
              seconds = millifyTimedelta(secondsNumber, { long: true })
            }
          } else {
            seconds = '<number> seconds'
          }
          return [`You are timed out for ${seconds} more.`, undefined]
        }
        case 'msg_verified_email':
          return [
            'This room requires a verified account to chat. Please verify your account at https://www.twitch.tv/settings/security.',
            undefined
          ]
        case 'slow_off':
          return ['This room is no longer in slow mode.', undefined]
        case 'slow_on': {
          let seconds: string | undefined = this.tags['number'] || lastRoomStateTags?.['slow']
          if (seconds) {
            const secondsNumber = parseInt(seconds, 10)
            if (!Number.isNaN(secondsNumber)) {
              seconds = millifyTimedelta(secondsNumber, { long: true })
            }
          } else {
            seconds = '<number> seconds'
          }
          return [
            `This room is now in slow mode. You may send messages every ${seconds}.`,
            undefined
          ]
        }
        case 'subs_off':
          return ['This room is no longer in subscribers-only mode.', undefined]
        case 'subs_on':
          return ['This room is now in subscribers-only mode.', undefined]
        case 'tos_ban':
          return [
            `The community has closed channel ${this.channel} due to Terms of Service violations.`,
            undefined
          ]
        case 'unrecognized_cmd': {
          const command = this.tags['command'] || '<command>'
          return [`Unrecognized command: ${command}`, undefined]
        }
        default:
          return [msg || `Notice${msgId ? ` (${msgId})` : ''}`, undefined]
      }
    } else if (this.command === 'PRIVMSG') {
      return ['', this.message]
    } else if (this.command === 'ROOMSTATE') {
      const emoteOnly = this.tags['emote-only'] === '1'
      const followersOnly = this.tags['followers-only']
      const r9k = this.tags['r9k'] === '1'
      const slow = this.tags['slow']
      const subsOnly = this.tags['subs-only'] === '1'

      const settings: string[] = []
      if (emoteOnly) settings.push('Emote-only mode enabled')
      if (followersOnly !== undefined) {
        if (followersOnly === '-1') {
          settings.push('Followers-only mode disabled')
        } else if (followersOnly === '0') {
          settings.push('Followers-only mode enabled (any follower)')
        } else {
          const minutes = parseInt(followersOnly, 10)
          const duration = !Number.isNaN(minutes)
            ? millifyTimedelta(minutes * 60, { long: true })
            : `${followersOnly} minutes`
          settings.push(`Followers-only mode enabled (must follow for ${duration})`)
        }
      }
      if (r9k) settings.push('Unique message mode enabled')
      if (slow !== undefined && slow !== '0') {
        const seconds = parseInt(slow, 10)
        const duration = !Number.isNaN(seconds)
          ? millifyTimedelta(seconds, { long: true })
          : `${slow} seconds`
        settings.push(`Slow mode enabled (${duration})`)
      }
      if (subsOnly) settings.push('Subscribers-only mode enabled')

      if (settings.length === 0) return ['Chat settings updated (no restrictions)', undefined]
      return [`Chat settings updated: ${settings.join(', ')}`, undefined]
    } else if (this.command === 'USERNOTICE') {
      const msgId = this.tags['msg-id']
      const displayName = this.tags['display-name'] || this.tags['login'] || 'Unknown'
      const systemMsg = escapeIrcText(this.tags['system-msg'])
      switch (msgId) {
        case 'sub':
        case 'resub': {
          let msg = ''
          if (systemMsg) {
            msg = systemMsg
          } else {
            console.warn("'sub' or 'resub' message without system-msg tag, using default format")
            const months = escapeIrcText(
              this.tags['msg-param-cumulative-months'] || this.tags['msg-param-months']
            )
            const streak = escapeIrcText(this.tags['msg-param-streak-months'])
            const planName = escapeIrcText(this.tags['msg-param-sub-plan-name'])
            msg = `${displayName} subscribed`
            if (months) msg += ` (${months} months)`
            if (planName) msg += ` with ${planName}`
            if (streak && streak !== '0') msg += ` (streak: ${streak} months)`
          }
          return [msg, this.message]
        }
        case 'subgift': {
          let msg = ''
          if (systemMsg) {
            msg = systemMsg
          } else {
            console.warn("'subgift' message without system-msg tag, using default format")
            const recipient = escapeIrcText(
              this.tags['msg-param-recipient-display-name'] ||
                this.tags['msg-param-recipient-user-name'] ||
                'someone'
            )
            const planName = escapeIrcText(this.tags['msg-param-sub-plan-name'])
            msg = `${displayName} gifted a sub to ${recipient}`
            if (planName) msg += ` (${planName})`
          }
          return [msg, this.message]
        }
        case 'submysterygift': {
          let msg = ''
          if (systemMsg) {
            msg = systemMsg
          } else {
            console.warn("'submysterygift' message without system-msg tag, using default format")
            const count = escapeIrcText(this.tags['msg-param-mass-gift-count'])
            msg = `${displayName} gifted ${count || 'some'} mystery subs to the community`
          }
          return [msg, this.message]
        }
        case 'raid': {
          let msg = ''
          if (systemMsg) {
            msg = systemMsg
          } else {
            console.warn("'raid' message without system-msg tag, using default format")
            const raider = escapeIrcText(this.tags['msg-param-displayName'] || displayName)
            const viewers = escapeIrcText(this.tags['msg-param-viewerCount'])
            msg = `${raider} is raiding with ${viewers || 'some'} viewers`
          }
          return [msg, this.message]
        }
        case 'bitsbadgetier': {
          const threshold = escapeIrcText(this.tags['msg-param-threshold'])
          return [`${displayName} just earned a new Bits badge tier: ${threshold}`, undefined]
        }
        case 'giftpaidupgrade': {
          const sender = escapeIrcText(
            this.tags['msg-param-sender-name'] || this.tags['msg-param-sender-login'] || 'someone'
          )
          return [`${displayName} received a gift sub from ${sender}`, undefined]
        }
        case 'anongiftpaidupgrade': {
          return [`${displayName} received a gift sub from an anonymous user`, undefined]
        }
        case 'rewardgift': {
          return [`${displayName} has been rewarded a gift`, undefined]
        }
        default: {
          if (systemMsg) return [systemMsg, this.message]
          if (this.message) return [this.message, undefined]
          return [`User notice from ${displayName}`, undefined]
        }
      }
    } else if (this.command === 'USERSTATE') {
      const displayName = this.tags['display-name'] || 'Unknown'
      const color = this.tags['color'] || 'no color'
      const badges = this.tags['badges'] || 'no badges'
      const emoteSets = this.tags['emote-sets'] || 'none'
      const mod = this.tags['mod'] === '1'
      const subscriber = this.tags['subscriber'] === '1'
      const turbo = this.tags['turbo'] === '1'
      const userType = this.tags['user-type'] || 'user'

      let info = `User state: ${displayName} (${userType}, badges: ${badges}, color: ${color}, emote sets: ${emoteSets})`
      if (mod) info += ', moderator'
      if (subscriber) info += ', subscriber'
      if (turbo) info += ', turbo'
      return [info, undefined]
    }
    return [this.message || '', undefined]
  }

  public getSystemText(): string {
    const [systemText] = this.getSystemTextAndMessage()
    return systemText
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

    return new TwitchSystemMessage(
      ircMessage.raw,
      Object.fromEntries(ircMessage.tags),
      parseInt(timestamp, 10),
      ircMessage.command,
      ircMessage.channel,
      ircMessage.text
    )
  }
}

export function convertTwitchMessagesToRawIrcMessages(messages: TwitchMessage[]): string {
  return messages.map((msg) => msg.raw).join('\n')
}

export function convertRawIrcMessagesToTwitchMessages(rawData: string): TwitchMessage[] {
  const messages: TwitchMessage[] = []

  for (const msg of parseIrcMessages(rawData)) {
    if (!msg) continue
    if (msg.command === 'PRIVMSG') {
      messages.push(TwitchChatMessage.fromIrcMessage(msg))
    } else {
      messages.push(TwitchSystemMessage.fromIrcMessage(msg))
    }
  }

  return messages
}
