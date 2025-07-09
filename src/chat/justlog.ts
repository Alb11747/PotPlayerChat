import { validatePropertiesExist } from '@/utils/objects'
import { parseIrcMessage, parseIrcMessages } from './irc'
import type {
  AllChannelsJSON,
  Channel,
  ChannelLogFile,
  ChannelLogList,
  ChatLog,
  JustLogChatLog,
  JustLogChatMessage,
  UserLogFile,
  UserLogList,
  UsernameToIdFunc
} from './types/justlog'
import { TwitchChatMessage, TwitchSystemMessage, type TwitchMessage } from './twitch-msg'

export class JustLogAPI {
  public baseApiUrl?: string
  public apiKey?: string
  public headers?: Record<string, string>
  public usernameToId?: UsernameToIdFunc

  public useRaw: boolean
  public isStrict: boolean

  private channelCache: Channel[] | null = null

  constructor(
    baseApiUrl?: string,
    apiKey?: string,
    headers?: Record<string, string>,
    usernameToIdFunc?: UsernameToIdFunc,
    useRaw: boolean = true,
    isStrict: boolean = true
  ) {
    // Remove trailing slashes from baseApiUrl
    this.baseApiUrl = baseApiUrl ? baseApiUrl.replace(/\/+$|\/$/, '') : undefined
    this.apiKey = apiKey
    this.headers = headers
    this.usernameToId = usernameToIdFunc

    this.useRaw = useRaw
    this.isStrict = isStrict
  }

  public async getChannels({
    baseUrl,
    cache
  }: { baseUrl?: string | null; cache?: boolean } = {}): Promise<Channel[] | null> {
    if (cache !== false && this.channelCache) {
      return [...this.channelCache]
    }
    const responseData = await this.sendRequestJson('GET', '/channels', {
      baseUrl
    })

    if (responseData === null) return null
    if (!this.isAllChannelsJSON(responseData, this.isStrict))
      throw new Error(`Invalid response format for channels: ${JSON.stringify(responseData)}`)

    const channels = responseData.channels
    this.channelCache = channels
    return [...channels]
  }

  public async getLogListChannel(
    {
      channel,
      channelId,
      channelStr
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
    },
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<ChannelLogList | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const [channelParam, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      'channel',
      'channelid'
    )
    const params = { [channelParam]: channelValue }
    const responseData = await this.sendRequestJson('GET', '/list', {
      params,
      baseUrl,
      errorOn404: true
    })

    if (responseData === null) return null
    if (!this.isChannelLogList(responseData, this.isStrict))
      throw new Error(
        `Invalid response format for channel log list: ${JSON.stringify(responseData)}`
      )

    return responseData
  }

  public async getLogListUser(
    {
      channel,
      channelId,
      channelStr,
      user,
      userId,
      userStr
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
      user?: string | Channel
      userId?: string
      userStr?: string
    },
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<UserLogList | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const [channelParam, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      'channel',
      'channelid'
    )
    const userVal = this.argsToUser(user, userId, userStr, 'user')
    const [userParam, userValue] = await this.getUsernameOrUserId(userVal, 'username', 'userid')
    const params = { [channelParam]: channelValue, [userParam]: userValue }
    const responseData = await this.sendRequestJson('GET', '/list', {
      params,
      baseUrl,
      errorOn404: true
    })

    if (responseData === null) return null
    if (!this.isUserLogList(responseData, this.isStrict))
      throw new Error(`Invalid response format for user log list: ${JSON.stringify(responseData)}`)

    return responseData
  }

  public async getChannelLogs(
    {
      channel,
      channelId,
      channelStr,
      fromTime,
      toTime,
      reverse
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
      fromTime?: Date
      toTime?: Date
      reverse?: boolean
    },
    { baseUrl }: { baseUrl?: string } = {}
  ): Promise<ChatLog | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const params = this.argsToDict(fromTime, toTime, reverse)
    const [url, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}',
      '/channelid/{channel}'
    )

    if (this.useRaw) {
      params['raw'] = 'true'
      const rawData = await this.sendRequestRaw(
        'text',
        'GET',
        url.replace('{channel}', channelValue),
        {
          params,
          baseUrl
        }
      )

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson(
        'GET',
        url.replace('{channel}', channelValue),
        {
          params,
          baseUrl
        }
      )

      if (!responseData) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(`Invalid response format for channel logs: ${JSON.stringify(responseData)}`)

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async getUserLogs(
    {
      channel,
      user,
      channelId,
      channelStr,
      userId,
      userStr,
      fromTime,
      toTime,
      reverse
    }: {
      channel?: string | Channel
      user?: string | Channel
      channelId?: string
      channelStr?: string
      userId?: string
      userStr?: string
      fromTime?: Date
      toTime?: Date
      reverse?: boolean
    },
    { baseUrl }: { baseUrl?: string } = {}
  ): Promise<ChatLog | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const userVal = this.argsToUser(user, userId, userStr, 'user')
    const params = this.argsToDict(fromTime, toTime, reverse)
    const [channelUrl, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}',
      '/channelid/{channel}'
    )
    const [userUrl, userValue] = await this.getUsernameOrUserId(
      userVal,
      '/user/{user}',
      '/userid/{user}'
    )
    const endpoint =
      channelUrl.replace('{channel}', channelValue) + userUrl.replace('{user}', userValue)

    if (this.useRaw) {
      params['raw'] = 'true'
      const rawData = await this.sendRequestRaw('text', 'GET', endpoint, {
        params,
        baseUrl
      })

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson('GET', endpoint, {
        params,
        baseUrl
      })

      if (!responseData) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(`Invalid response format for user logs: ${JSON.stringify(responseData)}`)

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async getUserLogsByDate(
    {
      channel,
      channelId,
      channelStr,
      user,
      userId,
      userStr,
      year,
      month
    }: {
      channel?: string | Channel
      user?: string | Channel
      channelId?: string
      channelStr?: string
      userId?: string
      userStr?: string
      year?: number
      month?: number
    } = {},
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<ChatLog | null> {
    if (!year || !month) throw new Error('Year and month are required')
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const userVal = this.argsToUser(user, userId, userStr, 'user')
    const [channelUrl, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}',
      '/channelid/{channel}'
    )
    const [userUrl, userValue] = await this.getUsernameOrUserId(
      userVal,
      '/user/{user}',
      '/userid/{user}'
    )
    const endpoint =
      channelUrl.replace('{channel}', channelValue) +
      userUrl.replace('{user}', userValue) +
      `/${year}/${month}`

    if (this.useRaw) {
      const rawData = await this.sendRequestRaw('text', 'GET', endpoint, {
        params: { raw: 'true' },
        baseUrl
      })

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson('GET', endpoint, {
        baseUrl
      })

      if (!responseData) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(
          `Invalid response format for user logs by date: ${JSON.stringify(responseData)}`
        )

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async getChannelLogsByDate(
    {
      channel,
      channelId,
      channelStr,
      year,
      month,
      day
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
      year?: number
      month?: number
      day?: number
    } = {},
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<ChatLog | null> {
    if (!year || !month || !day) throw new Error('Year, month and day are required')
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const [url, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}',
      '/channelid/{channel}'
    )
    const endpoint = url.replace('{channel}', channelValue) + `/${year}/${month}/${day}`

    if (this.useRaw) {
      const rawData = await this.sendRequestRaw('text', 'GET', endpoint, {
        params: { raw: 'true' },
        baseUrl
      })

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson('GET', endpoint, {
        baseUrl
      })

      if (!responseData) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(
          `Invalid response format for channel logs by date: ${JSON.stringify(responseData)}`
        )

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async getRandomChannelLog(
    {
      channel,
      channelId,
      channelStr
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
    } = {},
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<ChatLog | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const [endpoint, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}/random',
      '/channelid/{channel}/random'
    )

    if (this.useRaw) {
      const rawData = await this.sendRequestRaw(
        'text',
        'GET',
        endpoint.replace('{channel}', channelValue),
        {
          params: { raw: 'true' },
          baseUrl
        }
      )

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson(
        'GET',
        endpoint.replace('{channel}', channelValue),
        { baseUrl }
      )

      if (responseData === null) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(
          `Invalid response format for random channel log: ${JSON.stringify(responseData)}`
        )

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async getRandomUserLog(
    {
      channel,
      channelId,
      channelStr,
      user,
      userId,
      userStr
    }: {
      channel?: string | Channel
      channelId?: string
      channelStr?: string
      user?: string | Channel
      userId?: string
      userStr?: string
    } = {},
    { baseUrl }: { baseUrl?: string | null } = {}
  ): Promise<ChatLog | null> {
    const channelVal = this.argsToUser(channel, channelId, channelStr, 'channel')
    const userVal = this.argsToUser(user, userId, userStr, 'user')
    const [channelUrl, channelValue] = await this.getUsernameOrUserId(
      channelVal,
      '/channel/{channel}',
      '/channelid/{channel}'
    )
    const [userUrl, userValue] = await this.getUsernameOrUserId(
      userVal,
      '/user/{user}',
      '/userid/{user}'
    )
    const endpoint =
      channelUrl.replace('{channel}', channelValue) +
      userUrl.replace('{user}', userValue) +
      '/random'

    if (this.useRaw) {
      const rawData = await this.sendRequestRaw('text', 'GET', endpoint, {
        params: { raw: 'true' },
        baseUrl
      })

      if (!rawData || typeof rawData !== 'string') return null

      const messages = this.parseRawMessages(rawData)
      return { messages }
    } else {
      const responseData = await this.sendRequestJson('GET', endpoint, {
        baseUrl
      })

      if (responseData === null) return null
      if (!this.isChatLog(responseData, this.isStrict))
        throw new Error(
          `Invalid response format for random user log: ${JSON.stringify(responseData)}`
        )

      const messages = this.convertJustLogChatMessagesToTwitchMessages(responseData.messages)
      return { messages }
    }
  }

  public async adminJoinChannels(
    channels: Array<string | Channel>,
    opts: { baseUrl?: string | null; apiKey?: string | null } = {}
  ): Promise<string> {
    if (!this.apiKey) throw new Error('API key is required for this operation')
    const endpoint = '/admin/channels'
    const channelIds = await this.channelListToIds(channels)
    const data = { channels: channelIds }
    const msg = await this.sendRequestRaw('text', 'POST', endpoint, {
      json: data,
      admin: true,
      ...opts,
      errorOn404: true
    })
    this.channelCache = null

    if (typeof msg !== 'string')
      throw new Error(`Invalid response format for adminJoinChannels: ${JSON.stringify(msg)}`)

    return msg
  }

  public async adminLeaveChannels(
    channels: Array<string | Channel>,
    opts: { baseUrl?: string | null; apiKey?: string | null } = {}
  ): Promise<string> {
    if (!this.apiKey) throw new Error('API key is required for this operation')
    const endpoint = '/admin/channels'
    const channelIds = await this.channelListToIds(channels)
    const data = { channels: channelIds }
    const msg = await this.sendRequestRaw('text', 'DELETE', endpoint, {
      json: data,
      admin: true,
      ...opts,
      errorOn404: true
    })
    this.channelCache = null

    if (typeof msg !== 'string')
      throw new Error(`Invalid response format for adminLeaveChannels: ${JSON.stringify(msg)}`)

    return msg
  }

  // --- HTTP request helpers ---

  private buildHeaders(
    opts: { admin?: boolean; apiKey?: string | null } = {}
  ): Record<string, string> {
    const headers: Record<string, string> = { ...(this.headers || {}) }

    if (opts.admin) {
      const apiKey = opts.apiKey || this.apiKey
      if (!apiKey) throw new Error('API key is required for this operation')
      headers['X-Api-Key'] = apiKey
    }

    return headers
  }

  private buildRequestBody(opts: {
    data?: Record<string, unknown> | string
    json?: Record<string, unknown>
  }): { body: string | undefined; contentType: string | undefined } {
    let body: string | undefined = undefined
    let contentType: string | undefined = undefined

    if (opts.json) {
      body = JSON.stringify(opts.json)
      contentType = 'application/json'
    } else if (opts.data) {
      if (typeof opts.data === 'string') {
        body = opts.data
      } else {
        body = JSON.stringify(opts.data)
        contentType = 'application/json'
      }
    }

    return { body, contentType }
  }

  private buildUrlWithParams(
    baseUrl: string,
    endpoint: string,
    params?: Record<string, unknown>
  ): string {
    let url = baseUrl + endpoint

    if (params && Object.keys(params).length > 0) {
      const usp = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) usp.append(k, String(v))
      }
      url += (url.includes('?') ? '&' : '?') + usp.toString()
    }

    return url
  }

  private async sendRequestRaw(
    type: 'json' | 'text',
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    opts: {
      params?: Record<string, unknown>
      data?: Record<string, unknown> | string
      json?: Record<string, unknown>
      admin?: boolean
      baseUrl?: string | null
      apiKey?: string | null
      errorOn404?: boolean
    } = {}
  ): Promise<unknown> {
    const baseUrl = opts.baseUrl || this.baseApiUrl
    if (!baseUrl) throw new Error('Base URL not set')
    const url = this.buildUrlWithParams(baseUrl, endpoint, opts.params)
    const headers = this.buildHeaders({ admin: opts.admin, apiKey: opts.apiKey })
    const { body, contentType } = this.buildRequestBody({ data: opts.data, json: opts.json })
    if (contentType !== undefined) headers['Content-Type'] = contentType
    const fetchOpts: RequestInit = { headers, method, body }

    let response: Response
    let errorMessage: string | null = null
    try {
      console.debug(`Sending request: ${method} ${url}`)
      response = await fetch(url, fetchOpts)
      if (!response.ok) {
        if (!opts.errorOn404 && response.status === 404) return null
        errorMessage = await response.text()
        throw new Error(errorMessage)
      }
      if (type === 'json') return await response.json()
      if (type === 'text') return await response.text()
      throw new Error(`Unsupported response type: ${type}`)
    } catch {
      throw new Error(`Error sending request (${endpoint}) - Error message: ${errorMessage}`)
    }
  }

  private async sendRequestJson(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    opts: {
      params?: Record<string, unknown>
      admin?: boolean
      baseUrl?: string | null
      errorOn404?: boolean
    } = {}
  ): Promise<unknown | null> {
    const params = { ...(opts.params || {}), json: 'true' }
    const data = await this.sendRequestRaw('json', method, endpoint, { ...opts, params })
    if (data !== null && typeof data !== 'object') throw new Error('Expected data or null')
    return data
  }

  // --- Helper methods ---

  private async channelListToIds(channels: Array<string | Channel>): Promise<string[]> {
    const channelIds: string[] = []
    for (const channel of channels) {
      let channelId: string | null = null
      if (typeof channel === 'string') {
        if (/^\d+$/.test(channel)) channelId = channel
        else if (channel.startsWith('id:')) channelId = channel.slice(3)
        else if (channel.startsWith('#')) channelId = await this.getUserId(channel.slice(1))
        else throw new Error(`Unsupported channel format: ${channel}`)
      } else if (typeof channel === 'object' && channel && 'userID' in channel) {
        channelId = await this.getUserId(channel)
      } else {
        throw new Error(`Unsupported channel type: ${typeof channel}`)
      }
      if (!channelId) throw new Error(`Channel ID not found for ${channel}`)
      channelIds.push(channelId)
    }
    return Array.from(new Set(channelIds))
  }

  private argsToUser(
    user?: string | Channel | null,
    userId?: string | null,
    userStr?: string | null,
    userType?: string | null
  ): string {
    if ([user, userId, userStr].filter((x) => x !== undefined && x !== null).length !== 1) {
      userType = userType || 'user'
      throw new Error(
        `Exactly one of ${userType}, ${userType}Str or ${userType}Id must be provided`
      )
    }
    if (user) {
      if (typeof user === 'object' && user && 'userID' in user) return `id:${user.userID}`
      return user as string
    } else if (userId) {
      return `id:${userId}`
    } else if (userStr) {
      return `#${userStr}`
    }
    throw new Error('Unreachable code')
  }

  private argsToDict(
    fromTime?: Date | null,
    toTime?: Date | null,
    reverse?: boolean | null
  ): { from?: number; to?: number; reverse?: string } {
    const data: { from?: number; to?: number; reverse?: string } = {}
    if (fromTime) data.from = this.fromDatetimeToTimestamp(fromTime)
    if (toTime) data.to = this.fromDatetimeToTimestamp(toTime)
    if (reverse !== undefined && reverse !== null) data.reverse = String(reverse)
    return data
  }

  private async getUsernameOrUserId<T>(
    user: string | Channel,
    usernameStr: T,
    userIdStr: T
  ): Promise<[T, string]> {
    const channelId = await this.getUserId(user)
    let key: T, value: string
    if (channelId) {
      key = userIdStr
      value = channelId
    } else if (typeof user === 'object' && user && 'name' in user) {
      key = usernameStr
      value = user.name
    } else if (typeof user === 'string') {
      if (user.startsWith('id:')) {
        key = userIdStr
        value = user.slice(3)
      } else if (user.startsWith('#') || user.startsWith('@')) {
        key = usernameStr
        value = user.replace(/^[@#]/, '')
      } else {
        key = usernameStr
        value = user
      }
    } else {
      throw new Error(`Unsupported channel type (${typeof user}): ${user}`)
    }
    if (!/^\w+$/.test(value)) throw new Error(`Invalid username: ${value}`)
    return [key, value]
  }

  private async getUserId(user: string | Channel): Promise<string | null> {
    let channelId: string | null = null
    const fromUsernameToId = async (username: string): Promise<string | null> => {
      if (!this.usernameToId) return null
      return await this.usernameToId(username)
    }
    if (typeof user === 'string') {
      if (user.startsWith('id:')) channelId = user.slice(3)
      else if (user.startsWith('#')) channelId = await fromUsernameToId(user.slice(1))
    } else if (typeof user === 'object' && user && 'userID' in user) {
      channelId = user.userID
      if (!channelId) channelId = await fromUsernameToId(user.name)
    } else {
      throw new Error(`Unsupported channel type: ${typeof user}`)
    }
    return channelId
  }

  private fromDatetimeToTimestamp(dt: Date): number {
    return Math.floor(dt.getTime() / 1000)
  }

  // --- Type guards ---

  private isAllChannelsJSON(data: unknown, strict?: boolean): data is AllChannelsJSON {
    const d = data as AllChannelsJSON
    if (typeof d !== 'object' || d === null || !('channels' in d) || !Array.isArray(d.channels))
      return false
    if (strict && !d.channels.every((channel) => typeof channel === 'string')) return false
    return true
  }

  private isChannelLogList(data: unknown, strict?: boolean): data is ChannelLogList {
    const d = data as ChannelLogList
    if (
      typeof d !== 'object' ||
      d === null ||
      !('availableLogs' in d) ||
      !Array.isArray(d.availableLogs)
    )
      return false
    if (
      strict &&
      !d.availableLogs.every((log) => validatePropertiesExist(log, channelLogFileProperties))
    )
      return false
    return true
  }

  private isUserLogList(data: unknown, strict?: boolean): data is UserLogList {
    const d = data as UserLogList
    if (
      typeof d !== 'object' ||
      d === null ||
      !('availableLogs' in d) ||
      !Array.isArray(d.availableLogs)
    )
      return false
    if (
      strict &&
      !d.availableLogs.every((log) => validatePropertiesExist(log, userLogFileProperties))
    )
      return false
    return true
  }

  private isChatLog(data: unknown, strict?: boolean): data is JustLogChatLog {
    const d = data as JustLogChatLog
    if (typeof d !== 'object' || d === null || !('messages' in d) || !Array.isArray(d.messages))
      return false
    if (strict && !d.messages.every((msg) => validatePropertiesExist(msg, chatMessageProperties)))
      return false
    return true
  }

  // --- Helper methods ---

  private parseRawMessages(rawData: string): TwitchMessage[] {
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

  private convertJustLogChatMessageToTwitchMessage(chatMessage: JustLogChatMessage): TwitchMessage {
    if (chatMessage.type === 1) {
      return new TwitchChatMessage(
        chatMessage.raw,
        chatMessage.tags,
        chatMessage.id,
        Date.parse(chatMessage.timestamp),
        chatMessage.channel,
        chatMessage.username,
        chatMessage.text
      )
    }

    return TwitchSystemMessage.fromIrcMessage(parseIrcMessage(chatMessage.raw))
  }

  private convertJustLogChatMessagesToTwitchMessages(
    chatMessages: JustLogChatMessage[]
  ): TwitchMessage[] {
    return chatMessages.map((msg) => this.convertJustLogChatMessageToTwitchMessage(msg))
  }
}

const channelLogFileProperties: Array<keyof ChannelLogFile> = ['day', 'month', 'year']
const userLogFileProperties: Array<keyof UserLogFile> = ['month', 'year']
const chatMessageProperties: Array<keyof JustLogChatMessage> = [
  'id',
  'text',
  'timestamp',
  'channel',
  'displayName',
  'raw',
  'tags',
  'type',
  'username'
]
