import { describe, expect, it } from 'vitest'
import { clearConfigEntriesByPrefix } from './cache'

describe('clearConfigEntriesByPrefix', () => {
  it('removes cache entries without touching settings or saved URL data', () => {
    const config = new Map<string, unknown>([
      ['cache:title', { title: 'stream' }],
      ['cache:twitch-user-id', { streamer: '123' }],
      ['settings', { chat: { chatMessageLimit: 200 } }],
      ['data:urlSeenSet', { filters: [] }],
      ['data:urlClickedSet', { filters: [] }]
    ])

    expect(clearConfigEntriesByPrefix(config, 'cache:')).toEqual([
      'cache:title',
      'cache:twitch-user-id'
    ])
    expect(config).toEqual(
      new Map([
        ['settings', { chat: { chatMessageLimit: 200 } }],
        ['data:urlSeenSet', { filters: [] }],
        ['data:urlClickedSet', { filters: [] }]
      ])
    )
  })
})
