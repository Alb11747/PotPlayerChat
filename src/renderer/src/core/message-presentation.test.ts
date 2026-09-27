import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { Channel, Collection, EmoteFetcher, TwitchEmote } from '@mkody/twitch-emoticons'
import { createDefaultSettings } from '../state/settings-model'
import { MessagePresentationStore, presentationOptions } from './message-presentation'
import { TwitchUserService, TwitchBadgeService, TwitchEmoteService } from '@/core/chat/twitch-api'
import { TimelineMap } from '@/utils/datastructs'
import { settings } from '../state/settings.svelte'

vi.mock('../state/settings.svelte', () => ({ settings: createDefaultSettings() }))
vi.mock('../state/config', () => ({ default: {} }))
vi.mock('@/core/chat/twitch-api', () => ({
  setConfig: vi.fn(),
  TwitchUserService: { getUserIdByName: vi.fn() },
  TwitchBadgeService: { getBadgeInfo: vi.fn() },
  TwitchEmoteService: { getEmotes: vi.fn() },
  TwitchCheerEmoteService: { getCheerEmoteInfo: vi.fn() }
}))

function message(
  text = 'hello  世界\nhttps://example.com',
  id = 'one',
  timestamp = 10_000
): TwitchChatMessage {
  return new TwitchChatMessage(
    'raw',
    { id, badges: 'subscriber/1,moderator/1', 'display-name': 'Alice' },
    id,
    timestamp,
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
  it.each([
    [10_000, 5_000, '[0:45]'],
    [-10_000, -5_000, '[1:15]'],
    [10_000, -5_000, '[0:55]'],
    [-10_000, 5_000, '[1:05]']
  ] as const)(
    'matches main elapsed time with captured global %i and session %i offsets',
    (globalOffset, sessionOffset, expected) => {
      const originalGlobal = settings.chat.timestampOffset
      const originalSession = settings.chat._sessionTimestampOffset
      try {
        settings.chat.timestampOffset = globalOffset
        settings.chat._sessionTimestampOffset = sessionOffset
        const main = presentationOptions({
          showTimestamps: true,
          absoluteTimestamps: false,
          videoStartTime: 10_000,
          videoEndTime: 130_000,
          elapsedTime: 60_000 - globalOffset - sessionOffset
        })
        const item = message('timestamp regression', 'offset', 70_000)
        const mainStore = new MessagePresentationStore()
        const renderedMain = mainStore.get(item, main)
        expect(renderedMain.timestamp).toBe(expected)

        // The child renderer and later parent settings differ from the opening snapshot.
        settings.chat.timestampOffset = 100_000
        settings.chat._sessionTimestampOffset = 0
        const popup = presentationOptions({
          ...main,
          elapsedTime: undefined,
          timestampOffset: globalOffset + sessionOffset
        })
        expect(new MessagePresentationStore().get(item, popup).timestamp).toBe(expected)
        // Layout and mounted-row paths must agree on the cache key as well as the text.
        expect(mainStore.get(item, popup)).toBe(renderedMain)
      } finally {
        settings.chat.timestampOffset = originalGlobal
        settings.chat._sessionTimestampOffset = originalSession
      }
    }
  )

  it('shares warm preview assets without fetching or sharing mutable store containers', async () => {
    const emote = new TwitchEmote(new Channel(new EmoteFetcher(), 12), '123', {
      code: 'Kappa',
      formats: []
    })
    const emotes = new Collection([['Kappa', emote]])
    vi.mocked(TwitchEmoteService.getEmotes).mockResolvedValue(emotes)
    const source = new MessagePresentationStore()
    const item = message('Kappa @Bob')
    const options = presentationOptions()
    await source.load(item, options)
    const original = source.get(item, options)
    const timeline = new TimelineMap<string, string>()
    timeline.set('bob', '#123456', item.timestamp)
    const seed = source.capture([item], timeline)
    expect(seed.assets[0]?.[0]).toBe(item)
    expect(seed.assets[0]?.[1].badges).toBe(original.badges)
    expect(seed.channelEmotes[0]?.[1]).toBe(emotes)
    timeline.set('bob', '#ffffff', item.timestamp)
    expect(seed.mentionColors.get('bob', item.timestamp)).toBe('#123456')
    const child = new MessagePresentationStore()
    expect(child.seed(seed)).toBe(true)
    const rendered = child.get(item, options)
    expect(rendered.badges).toBe(original.badges)
    expect(rendered.segments?.find((part) => part.type === 'emote')).toMatchObject({ emote })
    await child.load(item, options)
    expect(TwitchUserService.getUserIdByName).toHaveBeenCalledTimes(1)
    child.clear()
    expect(source.get(item, options)).toBe(original)
    expect(seed.validity.valid).toBe(true)
    expect(child.seed(seed)).toBe(false)
  })

  it('captures only cached mention colors at each timestamp and never parses cold rows', () => {
    const source = new MessagePresentationStore()
    const first = message('@Bob', 'first')
    const second = message('@Bob', 'second', first.timestamp + 100)
    const cold = message('@Cold', 'cold')
    const timeline = new TimelineMap<string, string>()
    timeline.set('bob', '#111111', first.timestamp)
    timeline.set('bob', '#222222', second.timestamp)
    timeline.set('cold', '#333333', cold.timestamp)
    source.get(first, presentationOptions())
    source.get(second, presentationOptions())
    const get = vi.spyOn(source, 'get')
    const seed = source.capture([second, first, cold], timeline)
    expect(get).not.toHaveBeenCalled()
    expect(seed.mentionColors.get('bob', first.timestamp)).toBe('#111111')
    expect(seed.mentionColors.get('bob', second.timestamp)).toBe('#222222')
    expect(seed.mentionColors.get('bob', first.timestamp + 1)).toBeUndefined()
    expect(seed.mentionColors.get('cold', cold.timestamp)).toBeUndefined()
    expect(TwitchUserService.getUserIdByName).not.toHaveBeenCalled()
  })

  it('rejects seeds invalidated by source clearing and retains already-seeded sibling assets', async () => {
    const source = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    await source.load(item, options)
    const seed = source.capture([item])
    const sibling = new MessagePresentationStore()
    sibling.seed(seed)
    source.clear()
    expect(seed.validity.valid).toBe(false)
    const lateChild = new MessagePresentationStore()
    expect(lateChild.seed(seed)).toBe(false)
    expect(lateChild.get(item, options).badges).toHaveLength(2)
    expect(sibling.get(item, options).badges).toHaveLength(0)
  })

  it('limits asset capture to 200 messages and never waits for missing assets', () => {
    const source = new MessagePresentationStore()
    const timeline = { get: vi.fn(() => '#123456') }
    const rows = Array.from({ length: 250 }, (_, index) => message('@Bob', String(index)))
    for (const row of rows) source.get(row, presentationOptions())
    const seed = source.capture(rows, timeline)
    expect(timeline.get).toHaveBeenCalledTimes(200)
    expect(seed.assets).toHaveLength(0)
    expect(seed.channelEmotes).toHaveLength(0)
    expect(TwitchUserService.getUserIdByName).not.toHaveBeenCalled()
  })

  it('does not associate cached row assets with a different message reusing its ID', async () => {
    const source = new MessagePresentationStore()
    const original = message()
    const replacement = message('replacement')
    await source.load(original, presentationOptions())
    expect(source.capture([replacement]).assets).toHaveLength(0)
    expect(source.get(replacement, presentationOptions()).badges).toHaveLength(2)
  })

  it('keeps captured assets valid when their source transcript is disposed', async () => {
    const source = new MessagePresentationStore()
    const item = message()
    await source.load(item, presentationOptions())
    const seed = source.capture([item])
    source.clear(false)
    expect(seed.validity.valid).toBe(true)
    expect(new MessagePresentationStore().seed(seed)).toBe(true)
  })

  it('retains opening assets across filtering without refetching and clears them explicitly', async () => {
    const source = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    await source.load(item, options)
    const seed = source.capture([item])
    const child = new MessagePresentationStore()
    child.seed(seed)
    const originalBadges = child.get(item, options).badges
    child.retain([])
    expect(child.get(item, options).badges).toBe(originalBadges)
    await child.load(item, options)
    expect(TwitchUserService.getUserIdByName).toHaveBeenCalledTimes(1)
    expect(child.capture([item]).assets[0]?.[1].badges).toBe(originalBadges)
    child.clear()
    expect(child.get(item, options).badges).toHaveLength(2)
    expect(child.seed(seed)).toBe(false)
  })

  it('keeps newly resolved opening assets when a partial seed is later filtered out', async () => {
    const source = new MessagePresentationStore()
    const item = message()
    const options = presentationOptions()
    await source.load(item, { enableBadges: false, enableEmotes: true })
    const child = new MessagePresentationStore()
    child.seed(source.capture([item]))
    await child.load(item, options)
    const resolvedBadges = child.get(item, options).badges
    expect(resolvedBadges).toHaveLength(0)
    child.retain([])
    expect(child.get(item, options).badges).toBe(resolvedBadges)
    await child.load(item, options)
    expect(TwitchUserService.getUserIdByName).toHaveBeenCalledTimes(2)
  })

  it('notifies only the resolved row and changed channel collection, with unsubscribe support', async () => {
    const store = new MessagePresentationStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribeLayout(listener)
    const options = presentationOptions()
    const original = message()
    await store.load(original, options)
    await store.load(message('another', 'two'), options)
    await store.load(original, options)
    expect(listener.mock.calls).toEqual([
      [{ kind: 'channel', channel: 'channel' }],
      [{ kind: 'message', id: 'one' }],
      [{ kind: 'message', id: 'two' }]
    ])
    store.clear()
    expect(listener).toHaveBeenLastCalledWith({ kind: 'all' })
    unsubscribe()
    listener.mockClear()
    await store.load(message(), options)
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not notify layout when a cleared generation resolves', async () => {
    let finish!: (id: string) => void
    vi.mocked(TwitchUserService.getUserIdByName).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const store = new MessagePresentationStore()
    const listener = vi.fn()
    store.subscribeLayout(listener)
    const pending = store.load(message(), presentationOptions())
    store.clear()
    listener.mockClear()
    finish('12')
    await pending
    expect(listener).not.toHaveBeenCalled()
  })

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
