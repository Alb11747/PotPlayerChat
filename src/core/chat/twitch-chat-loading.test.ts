import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatService, type PotPlayerInfo } from './twitch-chat'
import { JustLogAPI } from './justlog'
import { TwitchChatMessage } from './twitch-msg'
import type { WindowApi } from '@/types/preload'
import type { ChatLog } from '@/types/justlog'
import type { HWND } from '@/types/globals'

vi.mock('./twitch-api', () => ({ TwitchUserService: { userIdCache: new Map() } }))

const noon = Date.parse('2026-09-25T12:00:00Z')
const day = 24 * 60 * 60 * 1000
function info(startTime = noon, channel = 'channel'): PotPlayerInfo {
  return {
    channel,
    startTime,
    endTime: startTime + 60 * 60 * 1000,
    hwnd: {} as HWND,
    pid: 1,
    title: 'recording'
  }
}
function service(api = {} as WindowApi): ChatService {
  return new ChatService(
    api,
    { state: 'idle', errorMessage: '' },
    {
      chat: { justlogUrl: 'https://logs.example.test', chatMessageLimit: 100 }
    }
  )
}
function message(id: string, time: number): TwitchChatMessage {
  return new TwitchChatMessage('', {}, id, time, 'channel', 'alice', id)
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(noon + 2 * 60 * 60 * 1000)
  vi.stubGlobal('window', { performance })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('playback chat loading', () => {
  it('accepts an empty padded day before nonempty data on repeated loads', async () => {
    const chat = service()
    const start = Date.parse('2026-09-24T00:30:00Z')
    const messages = [message('one', start)]
    const fetch = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      .mockImplementation(async ({ day } = {}) => ({ messages: day === 24 ? messages : [] }))
    await chat.updateVideoInfo(info(start), 0)
    await chat.loadChat()
    expect(chat.loadChatCached()).toBe(true)
    expect(chat.currentChatData).toEqual(messages)
    expect(chat.state.state).toBe('loaded')
    expect(fetch.mock.calls.map(([date]) => date?.day)).toEqual([23, 24])
  })

  it('keeps a successfully empty historical day cached and reports no chat', async () => {
    const chat = service()
    const fetch = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      .mockResolvedValue({ messages: [] })
    await chat.updateVideoInfo(info(noon - day), 0)
    await chat.loadChat()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(chat.state.state).toBe('chat-not-found')
  })

  it('refreshes incomplete data on playback polling after the cadence, including interior backfill', async () => {
    const chat = service()
    const first = message('first', noon)
    const last = message('last', noon + 2000)
    const middle = message('middle', noon + 1000)
    const fetch = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      .mockResolvedValueOnce({ messages: [first, last] })
      .mockResolvedValue({ messages: [first, middle, last] })
    const range = vi.spyOn(JustLogAPI.prototype, 'getChannelLogs')
    await chat.updateVideoInfo(info(), 0)
    for (let i = 0; i < 10; i++) await chat.getMessagesBetweenTimes(noon, noon + 3000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(ChatService.incompleteRefreshInterval)
    await chat.getMessagesBetweenTimes(noon, noon + 3000)
    expect(chat.currentChatData).toEqual([first, middle, last])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(range).not.toHaveBeenCalled()
    expect(chat.state.state).toBe('loaded')
  })

  it('combines a cached prior day and a newly requested day', async () => {
    const chat = service()
    const first = message('first', noon - day)
    const last = message('last', noon)
    const fetch = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      .mockImplementation(async ({ day } = {}) => ({ messages: day === 24 ? [first] : [last] }))
    await chat.updateVideoInfo(info(noon - day), 0)
    await chat.updateVideoInfo({ ...info(noon - day), endTime: noon + 1000 }, -1)
    await chat.loadChat([new Date(noon)])
    expect(chat.currentChatData).toEqual([first, last])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reuses unchanged cache batches during polling even with extra prefetched messages', async () => {
    const chat = service()
    const cached = message('cached', noon)
    vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate').mockResolvedValue({ messages: [cached] })
    await chat.updateVideoInfo(info(), 0)
    const prefetched = message('prefetched', noon + 1000)
    chat.currentChatData = [cached, prefetched]
    chat.loadChatCached()
    const current = chat.currentChatData
    const cachedId = vi.spyOn(cached, 'getId')
    const prefetchedId = vi.spyOn(prefetched, 'getId')
    for (let i = 0; i < 10; i++) chat.loadChatCached()
    expect(chat.currentChatData).toBe(current)
    expect(cachedId).not.toHaveBeenCalled()
    expect(prefetchedId).not.toHaveBeenCalled()
  })

  it('preserves existing data after a failed refresh and retries only after the cadence', async () => {
    const chat = service()
    const old = message('old', noon)
    const fetch = vi
      .spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      .mockResolvedValueOnce({ messages: [old] })
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ messages: [old, message('new', noon + 1000)] })
    await chat.updateVideoInfo(info(), 0)
    await vi.advanceTimersByTimeAsync(ChatService.incompleteRefreshInterval)
    await chat.loadChat()
    await chat.loadChat()
    expect(chat.currentChatData).toEqual([old])
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(ChatService.incompleteRefreshInterval)
    await chat.loadChat()
    expect(chat.currentChatData).toHaveLength(2)
  })

  it.each(['different', 'same', 'cleared'])(
    'discards a stale prefetch after selection is %s',
    async (selection) => {
      const chat = service()
      const oldInfo = info()
      await chat.updateVideoInfo(oldInfo, -1)
      const pending = deferred<ChatLog>()
      vi.spyOn(JustLogAPI.prototype, 'getChannelLogs').mockReturnValue(pending.promise)
      const days = vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
      const metadata = vi.spyOn(chat, 'updateMessageData')
      const query = chat.getMessagesForTime(1000)
      await chat.updateVideoInfo(
        selection === 'cleared' ? null : selection === 'same' ? oldInfo : info(noon, 'other'),
        -1
      )
      const selected = [message('selected', noon)]
      chat.currentChatData = selected
      pending.resolve({ messages: [message('stale', noon + 500)] })
      await expect(query).resolves.toEqual([])
      expect(chat.currentChatData).toBe(selected)
      expect(days).not.toHaveBeenCalled()
      expect(metadata).not.toHaveBeenCalled()
    }
  )

  it('does not publish an old daily response or its metadata after reselection', async () => {
    const chat = service()
    const pending = deferred<ChatLog>()
    vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate').mockReturnValue(pending.promise)
    const metadata = vi.spyOn(chat, 'updateMessageData')
    const load = chat.updateVideoInfo(info(), 0)
    await chat.updateVideoInfo(info(noon, 'other'), -1)
    chat.state.state = 'idle'
    pending.resolve({ messages: [message('stale', noon)] })
    await load
    expect(chat.currentChatData).toEqual([])
    expect(chat.state.state).toBe('idle')
    expect(metadata).not.toHaveBeenCalled()
  })

  it('cancels delayed loading when selection changes', async () => {
    const chat = service()
    const fetch = vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
    await chat.updateVideoInfo(info(), 1000)
    await chat.updateVideoInfo(null, -1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks selection after the asynchronous video-duration lookup', async () => {
    const duration = deferred<number>()
    const chat = service({ getTotalVideoTime: () => duration.promise } as unknown as WindowApi)
    const fetch = vi.spyOn(JustLogAPI.prototype, 'getChannelLogsByDate')
    const load = chat.updateVideoInfo({ ...info(), endTime: undefined }, 0)
    await chat.updateVideoInfo(null, -1)
    chat.state.state = 'idle'
    duration.resolve(1000)
    await load
    expect(fetch).not.toHaveBeenCalled()
    expect(chat.state.state).toBe('idle')
  })
})
