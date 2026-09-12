import type { TranscriptHandle } from '@/renderer/src/core/transcript-handle'
import type { SearchContext } from '@/renderer/src/core/search-window'
import type { TwitchMessage } from '@/core/chat/twitch-msg'

export interface FixtureRow {
  id: string
  height: number
  text: string
}
export interface TranscriptFixture {
  list(): TranscriptHandle
  rows(): FixtureRow[]
  replace(rows: FixtureRow[]): void
  settleUpdates(): Promise<void>
  resize(id: string, height: number): void
  follow(value: boolean): void
  state(): { following: boolean; interactions: number }
  width(value: number): void
  ready: boolean
}
declare global {
  interface Window {
    transcriptTest: TranscriptFixture
    fixtureReady?: boolean
    fixtureUsername?: string
    fixtureUsernameAlt?: boolean
    fixtureUrl?: string
    fixturePopup?: string
    resolveFixtureMedia?: () => void
    resolveFixtureHistory?: () => void
    fixtureDisplay?: (layout: 'streamlined' | 'comfort', timestamps: boolean) => void
    fixtureClearCache?: () => void
    fixtureHeartbeat?: { ticks: number; maxGap: number; last: number; timer: number }
    fixtureShowSearch?: () => void
    fixtureOpenSharedSearch?: () => void
    fixtureSwitchRecording?: () => void
    fixtureAppendMessages?: (count: number) => void
    fixtureSearchContext?: SearchContext
    fixtureSharedMessages?: TwitchMessage[]
    fixtureSharedSearchWindows?: Window[]
    fixtureSharedInitialMessages?: TwitchMessage[]
    fixtureSharedCallback?: { id: string; original: boolean; recording: string }
  }
}

// Only the renderer is mounted. Every external interaction is a deterministic fixture.
Object.defineProperty(window, 'api', {
  value: new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'loadKeys') return async () => ({})
        if (key === 'openUrl')
          return async (url: string) => {
            window.fixtureUrl = url
          }
        if (key === 'getDefaultPollingIntervals') return async () => ({})
        if (key === 'getCurrentVideoTime') return async () => 1000000
        if (key === 'getSelectedPotPlayerHWND') return async () => 1
        if (key === 'getPotPlayers')
          return async () => [{ hwnd: 1, pid: 1, title: 'Fixture recording' }]
        if (key === 'getPotplayerExtraInfo')
          return async () => ({
            hwnd: 1,
            pid: 1,
            title: 'Fixture recording',
            channel: 'fixture',
            startTime: 1700000000000,
            endTime: 1700001000000
          })
        if (key === 'getAppearancePreferences')
          return async () => ({ layout: 'streamlined', palette: 'dark', previewMode: 'hover' })
        if (key === 'getLinkPreview')
          return async (url: string) => {
            await mediaReady
            return url.includes('failed')
              ? { status: 404, link: url }
              : url.includes('empty')
                ? { status: 200, link: url }
                : { status: 200, link: url, thumbnail: `${url}.svg` }
          }
        return async () => undefined
      }
    }
  )
})
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      on: () => undefined,
      once: () => undefined,
      removeListener: () => undefined,
      send: () => undefined,
      invoke: async () => undefined
    }
  }
})
const mediaReady = new Promise<void>((resolve) => {
  window.resolveFixtureMedia = resolve
})
if (!new URLSearchParams(location.search).has('opener'))
  window.open = (url) => {
    window.fixturePopup = String(url)
    return null
  }
const { mount } = await import('svelte')
const { TwitchUserService, TwitchEmoteService, TwitchBadgeService, TwitchCheerEmoteService } =
  await import('@/core/chat/twitch-api')
const { HelixChatBadgeVersion } = await import('@twurple/api')
const { Channel, EmoteFetcher, FFZEmote, Collection } = await import('@mkody/twitch-emoticons')
const { CheerEmote } = await import('@/core/chat/twitch-emotes')
const channel = new Channel(new EmoteFetcher(), 1)
const base = new FFZEmote(channel, 'base', { name: 'FixtureBase', urls: { '1': 'fixture' } })
const overlay = Object.assign(
  new FFZEmote(channel, 'overlay', { name: 'FixtureOverlay', urls: { '1': 'fixture' } }),
  { zeroWidth: true }
)
const emotes = new Collection([
  ['FixtureBase', base],
  ['FixtureOverlay', overlay]
])
TwitchUserService.getUserIdByName = async () => null
TwitchUserService.getUserProfileByName = async () => null
TwitchEmoteService.getEmotes = async () => {
  await mediaReady
  return emotes
}
TwitchBadgeService.getBadgeInfo = async (id) => {
  await mediaReady
  return id === 'subscriber'
    ? undefined
    : new HelixChatBadgeVersion({
        id: '1',
        image_url_1x: 'https://fixture.test/badge.svg',
        image_url_2x: 'https://fixture.test/badge.svg',
        image_url_4x: 'https://fixture.test/badge.svg',
        title: 'Moderator',
        description: 'Fixture moderator',
        click_action: null,
        click_url: null
      })
}
TwitchCheerEmoteService.getCheerEmoteInfo = async (name, bits) => {
  await mediaReady
  const info = { url: 'https://fixture.test/cheer.svg', color: '#bda9fa' }
  return new CheerEmote({ '1': info, '1.5': info, '2': info, '3': info, '4': info }, name, bits)
}
const params = new URLSearchParams(location.search)
const { default: Harness } =
  params.has('sharedSource') || location.pathname.endsWith('/search.html')
    ? await import('./SharedSearchHarness.svelte')
    : params.has('main')
      ? await import('./MainHarness.svelte')
      : params.has('popup')
        ? await import('./PopupHarness.svelte')
        : params.has('media')
          ? await import('./MediaHarness.svelte')
          : await import('./Harness.svelte')
await import('@/renderer/src/assets/main.css')
mount(Harness, { target: document.getElementById('app')! })
