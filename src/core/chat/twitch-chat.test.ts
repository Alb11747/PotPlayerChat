import { describe, expect, it, vi } from 'vitest'
import { ChatService } from './twitch-chat'
import { TwitchChatMessage } from './twitch-msg'
import type { WindowApi } from '@/types/preload'

vi.mock('./twitch-api', () => ({ TwitchUserService: { userIdCache: new Map() } }))

function service(): ChatService {
  return new ChatService(
    {} as WindowApi,
    { state: 'idle', errorMessage: '' },
    {
      chat: { justlogUrl: '', chatMessageLimit: 100 }
    }
  )
}

function message(time: number, color: string): TwitchChatMessage {
  return new TwitchChatMessage(
    '',
    { color, 'display-name': 'Alice' },
    String(time),
    time,
    'channel',
    'alice',
    'hello'
  )
}

describe('search metadata snapshots', () => {
  it('restores later color boundaries when older history is inserted', async () => {
    const chat = service()
    const first = message(10, 'red')
    const last = message(30, 'red')
    await chat.updateMessageDataCooperatively([first, last])
    const old = chat.usernameColorTimelineMap
    await chat.updateMessageDataCooperatively([first, message(20, 'blue'), last])
    for (const name of ['alice', 'Alice']) {
      // Normalized aliases use lowercase keys.
      expect(chat.usernameColorTimelineMap.get(name.toLowerCase(), 25)).toBe('blue')
      expect(chat.usernameColorTimelineMap.get(name.toLowerCase(), 35)).toBe('red')
    }
    expect(old.get('alice', 25)).toBe('red')
  })

  it('keeps the current metadata snapshot when preparation is cancelled', async () => {
    const chat = service()
    await chat.updateMessageDataCooperatively([message(1, 'red')])
    const old = chat.usernameColorTimelineMap
    const controller = new AbortController()
    controller.abort()
    await expect(
      chat.updateMessageDataCooperatively([message(2, 'blue')], controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(chat.usernameColorTimelineMap).toBe(old)
  })

  it('matches full reconstruction when colors overwrite the same timestamp', async () => {
    const data = [message(1, 'red'), message(2, 'blue'), message(2, 'red'), message(3, 'red')]
    const expected = service()
    expected.updateMessageData(data)
    const actual = service()
    await actual.updateMessageDataCooperatively(data)
    for (const time of [0, 1, 1.5, 2, 2.5, 3, 4])
      expect(actual.usernameColorTimelineMap.get('alice', time)).toBe(
        expected.usernameColorTimelineMap.get('alice', time)
      )
  })
})
