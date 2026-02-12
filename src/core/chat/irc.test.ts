import { escapeIrcText, parseIrcMessage, parseIrcMessages } from '@/core/chat/irc'
import { describe, expect, it } from 'vitest'

describe('IRC parser', () => {
  it('unescapes IRC tag escape sequences', () => {
    expect(escapeIrcText('hello\\sworld\\:ok\\\\done')).toBe('hello world:ok\\done')
  })

  it('parses PRIVMSG with tags, username, channel, and text', () => {
    const raw =
      '@id=abc;tmi-sent-ts=1710000000000;display-name=User :user!user@user.tmi.twitch.tv PRIVMSG #some_channel :hello world'
    const parsed = parseIrcMessage(raw)

    expect(parsed.command).toBe('PRIVMSG')
    expect(parsed.username).toBe('user')
    expect(parsed.channel).toBe('some_channel')
    expect(parsed.text).toBe('hello world')
    expect(parsed.tags.get('id')).toBe('abc')
    expect(parsed.tags.get('display-name')).toBe('User')
  })

  it('parses newline-delimited IRC payloads', () => {
    const lines = [
      ':u!u@u PRIVMSG #c :one',
      ':u!u@u PRIVMSG #c :two',
      '',
      '   :u!u@u PRIVMSG #c :three   '
    ].join('\n')

    const messages = parseIrcMessages(lines)
    expect(messages).toHaveLength(3)
    expect(messages.map((m) => m.text)).toEqual(['one', 'two', 'three'])
  })

  it('throws when required fields are missing', () => {
    expect(() => parseIrcMessage(':u!u@u PRIVMSG :missing-channel')).toThrow(
      'IRC message must have a channel'
    )
  })
})
