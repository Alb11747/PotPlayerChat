import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { describe, expect, it } from 'vitest'
import {
  filterSearchMessages,
  formattedTwitchMessageFactory,
  getSearchPattern,
  type TwitchMessageFormatted
} from './search-messages'

function message(id: string, username: string, text: string): TwitchMessageFormatted {
  return formattedTwitchMessageFactory(
    new TwitchChatMessage(`raw:${id}`, {}, id, 1000, 'channel', username, text)
  )
}

describe('transcript search', () => {
  const messages = [
    message('1', 'Alice', 'hello world'),
    message('2', 'Bob', 'hello again'),
    message('3', 'alice', 'HELLO [world]')
  ]

  it('matches consecutive rows independently when the highlighting pattern is global', () => {
    const pattern = /hello/gi
    pattern.lastIndex = 10
    expect(filterSearchMessages(messages, 'hello', false, true, pattern)).toEqual(messages)
    expect(pattern.lastIndex).toBe(10)
  })

  it('matches usernames and text while preserving case and literal query options', () => {
    expect(filterSearchMessages(messages, 'alice', false, false)).toEqual([
      messages[0],
      messages[2]
    ])
    expect(filterSearchMessages(messages, 'Alice', true, false)).toEqual([messages[0]])
    expect(filterSearchMessages(messages, '[world]', false, false)).toEqual([messages[2]])
  })

  it('falls back to literal matching for incomplete regular expressions', () => {
    expect(getSearchPattern('[world', false, true)).toBe('[world')
    expect(filterSearchMessages(messages, '[world', false, true)).toEqual([messages[2]])
  })

  it('supports case-sensitive regex and keeps original row references for chat navigation', () => {
    expect(filterSearchMessages(messages, '^Alice: hello', true, true)).toEqual([messages[0]])
    expect(filterSearchMessages(messages, '', false, false)).toBe(messages)
    expect(filterSearchMessages(messages, 'unmatched', false, false)).toEqual([])
  })
})
