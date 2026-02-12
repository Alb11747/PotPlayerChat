import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { isActionMessage, parseFullMessage, stripActionMessage } from '@/renderer/src/core/chat-dom'
import { describe, expect, it } from 'vitest'

function createChatMessage(message: string): TwitchChatMessage {
  return new TwitchChatMessage(
    `raw:${message}`,
    { 'display-name': 'DisplayName', id: `id-${message}`, 'tmi-sent-ts': '1710000000000' },
    `id-${message}`,
    1_710_000_000_000,
    'channel',
    'username',
    message
  )
}

describe('chat-dom parser', () => {
  it('detects and strips ACTION payloads', () => {
    const action = '\u0001ACTION waves\u0001'
    expect(isActionMessage(action)).toBe(true)
    expect(stripActionMessage(action)).toBe('waves')
  })

  it('extracts URL segments', () => {
    const msg = createChatMessage('visit https://example.com now')
    const [, segments] = parseFullMessage(msg, {
      enableEmotes: false,
      enableMentions: false,
      debug: false
    })

    expect(segments?.some((s) => s.type === 'url' && s.url === 'https://example.com')).toBe(true)
  })

  it('extracts mention segments', () => {
    const msg = createChatMessage('hello @alice')
    const [, segments] = parseFullMessage(msg, {
      enableEmotes: false,
      enableUrls: false,
      debug: false
    })

    expect(segments?.some((s) => s.type === 'mention' && s.username === 'alice')).toBe(true)
  })

  it('highlights query matches', () => {
    const msg = createChatMessage('this should match')
    const [prefix, segments] = parseFullMessage(msg, {
      enableEmotes: false,
      enableUrls: false,
      enableMentions: false,
      searchQuery: 'match',
      debug: false
    })

    const escaped = `${prefix} ${segments?.map((s) => s.escaped).join(' ') ?? ''}`
    expect(escaped).toContain('<mark>')
    expect(escaped).toContain('</mark>')
  })
})
