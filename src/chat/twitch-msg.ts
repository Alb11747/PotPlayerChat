import { escapeIrcText, type IrcMessage } from './irc'

export type TwitchMessage = TwitchChatMessage | TwitchSystemMessage

export class TwitchChatMessage {
  public readonly source = 'twitch'
  public readonly type = 'chat'

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
  public readonly source = 'twitch'
  public readonly type = 'system'

  public readonly raw: string
  public readonly tags: Record<string, string>
  public readonly timestamp: number
  public readonly command?: string
  public readonly channel: string
  public readonly message?: string
  public readonly systemText?: string

  constructor(
    raw: string,
    tags: Record<string, string>,
    timestamp: number,
    command: string | undefined,
    channel: string,
    message: string | undefined,
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

  public getSystemText(lastRoomStateTags?: Record<string, string>): string {
    if (this.systemText) return this.systemText
    if (this.command === 'CLEARCHAT') {
      const user = this.message
      const banDuration = this.banDuration
      if (user) {
        if (banDuration) {
          return `${user} has been timed out for ${banDuration} seconds`
        } else {
          return `${user} has been banned`
        }
      } else {
        return 'All chat messages have been cleared'
      }
    } else if (this.command === 'CLEARMSG') {
      const login = this.tags['login'] || 'Unknown'
      const msg = this.message || ''
      return `A message from ${login} was deleted: "${msg}"`
    } else if (this.command === 'GLOBALUSERSTATE') {
      const displayName = this.tags['display-name'] || 'Unknown'
      const color = this.tags['color'] || 'no color'
      const badges = this.tags['badges'] || 'no badges'
      const emoteSets = this.tags['emote-sets'] || 'none'
      const userType = this.tags['user-type'] || 'user'
      const turbo = this.tags['turbo'] === '1'
      let info = `Authenticated as ${displayName} (${userType}, badges: ${badges}, color: ${color}, emote sets: ${emoteSets})`
      if (turbo) info += ', turbo'
      return info
    } else if (this.command === 'NOTICE') {
      const msgId = this.tags['msg-id']
      const msg = this.message || ''
      switch (msgId) {
        case 'emote_only_off':
          return 'This room is no longer in emote-only mode.'
        case 'emote_only_on':
          return 'This room is now in emote-only mode.'
        case 'followers_off':
          return 'This room is no longer in followers-only mode.'
        case 'followers_on': {
          const duration = this.tags['duration'] || lastRoomStateTags?.['followers'] || '<duration>'
          return `This room is now in ${duration} followers-only mode.`
        }
        case 'followers_on_zero':
          return 'This room is now in followers-only mode.'
        case 'msg_banned':
          return `You are permanently banned from talking in ${this.channel}.`
        case 'msg_bad_characters':
          return 'Your message was not sent because it contained too many unprocessable characters. If you believe this is an error, please rephrase and try again.'
        case 'msg_channel_blocked':
          return 'Your message was not sent because your account is not in good standing in this channel.'
        case 'msg_channel_suspended':
          return 'This channel does not exist or has been suspended.'
        case 'msg_duplicate':
          return 'Your message was not sent because it is identical to the previous one you sent, less than 30 seconds ago.'
        case 'msg_emoteonly':
          return 'This room is in emote-only mode. You can find your currently available emoticons using the smiley in the chat text area.'
        case 'msg_followersonly': {
          const duration = this.tags['duration'] || lastRoomStateTags?.['followers'] || '<duration>'
          return `This room is in ${duration} followers-only mode. Follow ${this.channel} to join the community!`
        }
        case 'msg_followersonly_followed': {
          const duration1 = this.tags['duration1'] || '<duration1>'
          const duration2 = this.tags['duration2'] || '<duration2>'
          return `This room is in ${duration1} followers-only mode. You have been following for ${duration2}. Continue following to chat!`
        }
        case 'msg_followersonly_zero':
          return `This room is in followers-only mode. Follow ${this.channel} to join the community!`
        case 'msg_r9k':
          return 'This room is in unique-chat mode and the message you attempted to send is not unique.'
        case 'msg_ratelimit':
          return 'Your message was not sent because you are sending messages too quickly.'
        case 'msg_rejected':
          return 'Hey! Your message is being checked by mods and has not been sent.'
        case 'msg_rejected_mandatory':
          return 'Your message wasn’t posted due to conflicts with the channel’s moderation settings.'
        case 'msg_requires_verified_phone_number':
          return 'A verified phone number is required to chat in this channel. Please visit https://www.twitch.tv/settings/security to verify your phone number.'
        case 'msg_slowmode': {
          const seconds = this.tags['number'] || lastRoomStateTags?.['slow'] || '<number>'
          return `This room is in slow mode and you are sending messages too quickly. You will be able to talk again in ${seconds} seconds.`
        }
        case 'msg_subsonly': {
          const channelName = this.channel.replace(/^#/, '')
          return `This room is in subscribers only mode. To talk, purchase a channel subscription at https://www.twitch.tv/products/${channelName}/ticket?ref=subscriber_only_mode_chat.`
        }
        case 'msg_suspended':
          return 'You don’t have permission to perform that action.'
        case 'msg_timedout': {
          const seconds = this.tags['number'] || lastRoomStateTags?.['ban-duration'] || '<number>'
          return `You are timed out for ${seconds} more seconds.`
        }
        case 'msg_verified_email':
          return 'This room requires a verified account to chat. Please verify your account at https://www.twitch.tv/settings/security.'
        case 'slow_off':
          return 'This room is no longer in slow mode.'
        case 'slow_on': {
          const seconds = this.tags['number'] || lastRoomStateTags?.['slow'] || '<number>'
          return `This room is now in slow mode. You may send messages every ${seconds} seconds.`
        }
        case 'subs_off':
          return 'This room is no longer in subscribers-only mode.'
        case 'subs_on':
          return 'This room is now in subscribers-only mode.'
        case 'tos_ban':
          return `The community has closed channel ${this.channel} due to Terms of Service violations.`
        case 'unrecognized_cmd': {
          const command = this.tags['command'] || '<command>'
          return `Unrecognized command: ${command}`
        }
        default:
          return msg || `Notice${msgId ? ` (${msgId})` : ''}`
      }
    } else if (this.command === 'PRIVMSG') {
      return this.message || ''
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
          settings.push(`Followers-only mode enabled (must follow for ${followersOnly} minutes)`)
        }
      }
      if (r9k) settings.push('Unique message mode enabled')
      if (slow !== undefined && slow !== '0') settings.push(`Slow mode enabled (${slow} seconds)`)
      if (subsOnly) settings.push('Subscribers-only mode enabled')

      if (settings.length === 0) return 'Chat settings updated (no restrictions)'
      return `Chat settings updated: ${settings.join(', ')}`
    } else if (this.command === 'USERNOTICE') {
      const msgId = this.tags['msg-id']
      const displayName = this.tags['display-name'] || this.tags['login'] || 'Unknown'
      const systemMsg = escapeIrcText(this.tags['system-msg'])
      switch (msgId) {
        case 'sub':
        case 'resub': {
          const months = escapeIrcText(
            this.tags['msg-param-cumulative-months'] || this.tags['msg-param-months']
          )
          const streak = escapeIrcText(this.tags['msg-param-streak-months'])
          const planName = escapeIrcText(this.tags['msg-param-sub-plan-name'])
          let msg = `${displayName} subscribed`
          if (months) msg += ` (${months} months)`
          if (planName) msg += ` with ${planName}`
          if (streak && streak !== '0') msg += ` (streak: ${streak} months)`
          if (systemMsg) msg += `: ${systemMsg}`
          return msg
        }
        case 'subgift': {
          const recipient = escapeIrcText(
            this.tags['msg-param-recipient-display-name'] ||
              this.tags['msg-param-recipient-user-name'] ||
              'someone'
          )
          const planName = escapeIrcText(this.tags['msg-param-sub-plan-name'])
          let msg = `${displayName} gifted a sub to ${recipient}`
          if (planName) msg += ` (${planName})`
          if (systemMsg) msg += `: ${systemMsg}`
          return msg
        }
        case 'submysterygift': {
          const count = escapeIrcText(this.tags['msg-param-mass-gift-count'])
          let msg = `${displayName} gifted ${count || 'some'} subs to the community`
          if (systemMsg) msg += `: ${systemMsg}`
          return msg
        }
        case 'raid': {
          const raider = escapeIrcText(this.tags['msg-param-displayName'] || displayName)
          const viewers = escapeIrcText(this.tags['msg-param-viewerCount'])
          let msg = `${raider} is raiding with ${viewers || 'some'} viewers`
          if (systemMsg) msg += `: ${systemMsg}`
          return msg
        }
        case 'bitsbadgetier': {
          const threshold = escapeIrcText(this.tags['msg-param-threshold'])
          return `${displayName} just earned a new Bits badge tier: ${threshold}`
        }
        case 'giftpaidupgrade': {
          const sender = escapeIrcText(
            this.tags['msg-param-sender-name'] || this.tags['msg-param-sender-login'] || 'someone'
          )
          return `${displayName} received a gift sub from ${sender}`
        }
        case 'anongiftpaidupgrade': {
          return `${displayName} received a gift sub from an anonymous user`
        }
        case 'rewardgift': {
          return `${displayName} has been rewarded a gift`
        }
        default: {
          if (systemMsg) return systemMsg
          if (this.message) return this.message
          return `User notice from ${displayName}`
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
      return info
    }
    return this.message || ''
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
