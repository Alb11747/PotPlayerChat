import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { Channel, Collection, EmoteFetcher, TwitchEmote } from '@mkody/twitch-emoticons'
import { createDefaultSettings } from '../state/settings-model'
import { MessagePresentationStore, presentationOptions } from './message-presentation'
import { TwitchUserService, TwitchBadgeService, TwitchEmoteService } from '@/core/chat/twitch-api'

vi.mock('../state/settings.svelte', () => ({ settings: createDefaultSettings() }))
vi.mock('../state/config', () => ({ default: {} }))
vi.mock('@/core/chat/twitch-api', () => ({
  setConfig: vi.fn(),
  TwitchUserService: { getUserIdByName: vi.fn() },
  TwitchBadgeService: { getBadgeInfo: vi.fn() },
  TwitchEmoteService: { getEmotes: vi.fn() },
  TwitchCheerEmoteService: { getCheerEmoteInfo: vi.fn() }
}))

function message(text = 'hello  世界\nhttps://example.com', id = 'one'): TwitchChatMessage {
  return new TwitchChatMessage(
    'raw',
    { id, badges: 'subscriber/1,moderator/1', 'display-name': 'Alice' },
    id,
    10_000,
    'channel',
    'alice',
    text
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(TwitchUserService.getUserIdByName).mockResolvedValue('12')
  vi.mocked(TwitchBadgeService.getBadgeInfo).mockResolvedValue(undefined)
  vi.mocked(TwitchEmoteService.getEmotes).mockResolvedValue(new Collection())
})

describe('shared message presentation', () => {
  it('retains text and emote parsing when only badges or an empty channel collection resolve', async () => {
    const store = new MessagePresentationStore()
    const options = presentationOptions({ enableEmotes: true, enableBadges: true })
    const mounted = message()
    const unmounted = message('hello  世界', 'two')
    const mountedBefore = store.get(mounted, options)
    const unmountedBefore = store.get(unmounted, options)
    await store.load(mounted, options)
    const mountedAfter = store.get(mounted, options)
    expect(mountedAfter.badges).toHaveLength(0)
    expect(mountedAfter.prefix).toBe(mountedBefore.prefix)
    expect(mountedAfter.segments).toBe(mountedBefore.segments)
    expect(store.get(unmounted, options)).toBe(unmountedBefore)
  })

  it('shares resolved channel emotes with unmounted rows without fetching those rows', async () => {
    const emote = new TwitchEmote(new Channel(new EmoteFetcher(), 12), '123', {
      code: 'Kappa',
      formats: []
    })
    vi.mocked(TwitchEmoteService.getEmotes).mockResolvedValue(new Collection([['Kappa', emote]]))
    const store = new MessagePresentationStore()
    const unmounted = message('Kappa', 'two')
    const options = presentationOptions({ enableEmotes: true })
    expect(store.get(unmounted, options).segments?.[0]?.type).toBe('text')
    await store.load(message(), options)
    expect(store.get(unmounted, options).segments?.[0]?.type).toBe('emote')
    expect(TwitchUserService.getUserIdByName).toHaveBeenCalledTimes(1)
  })

  it('does not repopulate per-message assets after an in-flight row is evicted', async () => {
    let finish!: (id: string) => void
    vi.mocked(TwitchUserService.getUserIdByName).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const store = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    store.get(item, options)
    const pending = store.load(item, options)
    store.retain([])
    finish('12')
    await pending
    // Failed badge lookups normally compact slots, but this evicted response was discarded.
    expect(store.get(item, options).badges).toHaveLength(2)
  })

  it('reserves badge IDs and preserves whitespace, timestamps and ordered URLs without fetching', () => {
    const store = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions({
      videoStartTime: 0,
      timestampOffset: 0,
      showTimestamps: true,
      absoluteTimestamps: false
    })
    const result = store.get(item, options)
    expect(result.badges.map(([id, badge]) => [id, badge])).toEqual([
      ['subscriber', null],
      ['moderator', null]
    ])
    expect(result.timestamp).toBe('[0:10]')
    expect(result.segments?.map((segment) => segment.text).join('')).toBe(item.message)
    expect(TwitchUserService.getUserIdByName).not.toHaveBeenCalled()
    expect(store.get(item, options)).toBe(result)
    expect(store.get(item, { ...options, elapsedTime: 10_000 })).toBe(result)
  })

  it('deduplicates mounted asset resolution and retains it across row recycling', async () => {
    const store = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    await Promise.all([store.load(item, options), store.load(item, options)])
    const resolved = store.get(item, options)
    await store.load(item, options)
    expect(TwitchEmoteService.getEmotes).toHaveBeenCalledTimes(1)
    expect(store.get(item, options)).toBe(resolved)
  })

  it('discards a service response from a cleared transcript context', async () => {
    let finish!: (id: string) => void
    vi.mocked(TwitchUserService.getUserIdByName).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const store = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    const pending = store.load(item, options)
    store.clear()
    finish('12')
    await pending
    await store.load(item, options)
    expect(TwitchUserService.getUserIdByName).toHaveBeenCalledTimes(2)
  })
})
