import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from './twitch-chat'
import { JustLogAPI } from './justlog'
import { TwitchChatMessage } from './twitch-msg'
import type { WindowApi } from '@/types/preload'
import type { ChatLog } from '@/types/justlog'
import type { HWND } from '@/types/globals'

vi.mock('./twitch-api', () => ({ TwitchUserService: { userIdCache: new Map() } }))

function service(): ChatService {
  const chat = new ChatService(
    {} as WindowApi,
    { state: 'idle', errorMessage: '' },
    { chat: { justlogUrl: 'https://logs.example.test', chatMessageLimit: 100 } }
  )
  chat.currentPotPlayerInfo = {
    channel: 'captured-channel',
    startTime: 1000,
    endTime: 1000000,
    hwnd: {} as HWND,
    pid: 1,
    title: 'captured recording'
  }
  return chat
}

function message(id: string, time: number): TwitchChatMessage {
  return new TwitchChatMessage('', {}, id, time, 'captured-channel', 'alice', id)
}

afterEach(() => vi.restoreAllMocks())

describe('range-only chat loading', () => {
  it('fetches the exact range without playback or full-day side effects', async () => {
    const chat = service()
    const existing = [message('existing', 1000)]
    chat.currentChatData = existing
    const timeline = chat.usernameColorTimelineMap
    const range = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogs')
      .mockResolvedValue({ messages: [] })
    const day = vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
    const load = vi.spyOn(chat, 'loadChat')
    const update = vi.spyOn(chat, 'updateMessageData')

    await expect(chat.getMessagesInRange(2000, 302000)).resolves.toEqual([])

    expect(range).toHaveBeenCalledExactlyOnceWith(
      {
        channelStr: 'captured-channel',
        fromTime: new Date(2000),
        toTime: new Date(302000)
      },
      { baseUrl: 'https://logs.example.test' }
    )
    expect(day).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(chat.currentChatData).toBe(existing)
    expect(chat.usernameColorTimelineMap).toBe(timeline)
    expect(chat.state).toEqual({ state: 'idle', errorMessage: '' })
  })

  it('sorts and deduplicates IDs while retaining equal-time ordering and original objects', async () => {
    const first = message('first', 10)
    const equal = message('equal', 10)
    const later = message('later', 20)
    const input = [later, first, equal, message('first', 10)]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(JustLogAPI.prototype, 'getChannelLogs').mockResolvedValue({ messages: input })

    const result = await service().getMessagesInRange(0, 30)
    expect(result).toEqual([first, equal, later])
    expect(result[0]).toBe(first)
    expect(result[1]).toBe(equal)
    expect(input[0]).toBe(later)
    expect(input).toHaveLength(4)
  })

  it('reports a missing response as failure, while accepting a successful empty range', async () => {
    const fetch = vi.spyOn(JustLogAPI.prototype, 'getChannelLogs')
    fetch.mockResolvedValueOnce(null).mockResolvedValueOnce({ messages: [] })
    const chat = service()
    await expect(chat.getMessagesInRange(0, 100)).rejects.toThrow('Failed to load chat range')
    await expect(chat.getMessagesInRange(0, 100)).resolves.toEqual([])
  })

  it('propagates transport errors for a caller-controlled retry', async () => {
    const error = new Error('network unavailable')
    vi.spyOn(JustLogAPI.prototype, 'getChannelLogs').mockRejectedValue(error)
    await expect(service().getMessagesInRange(0, 100)).rejects.toBe(error)
  })

  it('does not request a range when already cancelled or missing recording info', async () => {
    const fetch = vi.spyOn(JustLogAPI.prototype, 'getChannelLogs')
    const chat = service()
    const controller = new AbortController()
    controller.abort()
    await expect(chat.getMessagesInRange(0, 100, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    chat.currentPotPlayerInfo = null
    await expect(chat.getMessagesInRange(0, 100)).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a stale response cancelled during the request', async () => {
    let resolve!: (value: ChatLog) => void
    vi.spyOn(JustLogAPI.prototype, 'getChannelLogs').mockImplementation(
      () => new Promise((done) => (resolve = done))
    )
    const chat = service()
    const controller = new AbortController()
    const pending = chat.getMessagesInRange(0, 100, controller.signal)
    controller.abort()
    resolve({ messages: [message('stale', 10)] })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(chat.currentChatData).toEqual([])
  })
})
