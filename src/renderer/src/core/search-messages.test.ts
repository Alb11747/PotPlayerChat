import { TwitchChatMessage, TwitchSystemMessage } from '@/core/chat/twitch-msg'
import { describe, expect, it, vi } from 'vitest'
import { filterSearchMessages, getSearchPattern, SearchTextCache } from './search-messages'

function message(id: string, username: string, text: string): TwitchChatMessage {
  return new TwitchChatMessage(`raw:${id}`, {}, id, 1000, 'channel', username, text)
}

describe('transcript search', () => {
  const messages = [
    message('1', 'Alice', 'hello world'),
    message('2', 'Bob', 'hello again'),
    message('3', 'alice', 'HELLO [world]')
  ]

  it('matches consecutive rows independently when the highlighting pattern is global', async () => {
    const pattern = /hello/gi
    pattern.lastIndex = 10
    expect(await filterSearchMessages(messages, 'hello', false, true, pattern)).toEqual(messages)
    expect(pattern.lastIndex).toBe(10)
  })

  it('matches usernames and text while preserving case and literal query options', async () => {
    expect(await filterSearchMessages(messages, 'alice', false, false)).toEqual([
      messages[0],
      messages[2]
    ])
    expect(await filterSearchMessages(messages, 'Alice', true, false)).toEqual([messages[0]])
    expect(await filterSearchMessages(messages, '[world]', false, false)).toEqual([messages[2]])
  })

  it('falls back to literal matching for incomplete regular expressions', async () => {
    expect(getSearchPattern('[world', false, true)).toBe('[world')
    expect(await filterSearchMessages(messages, '[world', false, true)).toEqual([messages[2]])
  })

  it('supports case-sensitive regex and keeps original row references for chat navigation', async () => {
    expect(await filterSearchMessages(messages, '^Alice: hello', true, true)).toEqual([messages[0]])
    expect(await filterSearchMessages(messages, '', false, false)).toBe(messages)
    expect(await filterSearchMessages(messages, 'unmatched', false, false)).toEqual([])
  })

  it('shares lazy system text across query modes without cloning or changing messages', async () => {
    const system = new TwitchSystemMessage(
      'raw',
      {},
      1000,
      'NOTICE',
      'channel',
      '',
      'Welcome Alice'
    )
    const getText = vi.spyOn(system, 'getSystemText')
    const cache = new SearchTextCache()
    const source = Object.freeze([system])
    expect(getText).not.toHaveBeenCalled()
    expect(await filterSearchMessages(source, 'alice', false, false, undefined, cache)).toEqual(
      source
    )
    expect(await filterSearchMessages(source, 'Alice', true, false, undefined, cache)).toEqual(
      source
    )
    expect(await filterSearchMessages(source, '^Welcome', true, true, /^Welcome/g, cache)).toEqual(
      source
    )
    expect(getText).toHaveBeenCalledTimes(1)
    expect((await filterSearchMessages(source, 'Welcome', true, false, undefined, cache))[0]).toBe(
      system
    )
  })

  it('cancels an obsolete filter at a cooperative boundary', async () => {
    const controller = new AbortController()
    const source = Array.from({ length: 1000 }, (_, i) => message(String(i), 'Alice', 'hello'))
    const clock = vi.spyOn(performance, 'now')
    let time = 0
    clock.mockImplementation(() => (time += 5))
    try {
      const result = filterSearchMessages(
        source,
        'hello',
        false,
        false,
        undefined,
        new SearchTextCache(),
        controller.signal
      )
      controller.abort()
      await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      clock.mockRestore()
    }
  })
})
