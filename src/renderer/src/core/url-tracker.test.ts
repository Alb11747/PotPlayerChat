import { afterEach, describe, expect, it, vi } from 'vitest'
import { UrlTracker } from './url-tracker'
import { createDefaultSettings, hydrateSettings } from '../state/settings-model'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('URL tracker retry', () => {
  it('uses hydrated, edited, and reset resolver settings in an existing tracker', async () => {
    const getLinkPreview = vi.fn().mockResolvedValue({ status: 200, link: 'page' })
    vi.stubGlobal('window', { api: { getLinkPreview } })
    const settings = createDefaultSettings()
    const tracker = new UrlTracker(() => settings.chat)
    Object.assign(
      settings,
      hydrateSettings({
        chat: { chatterinoBaseUrl: 'https://saved.example/resolver' }
      })
    )
    await tracker.getPreview('https://example.com/saved')
    settings.chat.chatterinoBaseUrl = 'https://edited.example/resolver'
    await tracker.getPreview('https://example.com/edited')
    Object.assign(settings, createDefaultSettings())
    await tracker.getPreview('https://example.com/reset')
    expect(getLinkPreview.mock.calls.map((call) => call[1])).toEqual([
      'https://saved.example/resolver',
      'https://edited.example/resolver',
      createDefaultSettings().chat.chatterinoBaseUrl
    ])
  })

  it('scopes layout notifications to changed dimensions and failures, excluding URL history', async () => {
    vi.stubGlobal('window', {
      api: { addUrlSeen: vi.fn(), addUrlClicked: vi.fn() }
    })
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    const listener = vi.fn()
    const unsubscribe = tracker.subscribeLayout(listener)
    const image = { naturalWidth: 320, naturalHeight: 180 } as HTMLImageElement
    tracker.recordImageDimensions('image', image)
    tracker.recordImageDimensions('image', image)
    tracker.recordImageDimensions('image', {
      naturalWidth: 0,
      naturalHeight: 0
    } as HTMLImageElement)
    tracker.markFailedUrl('failed')
    tracker.markFailedUrl('failed')
    await tracker.markSeenUrl('image')
    await tracker.markVisitedUrl('image')
    tracker.clearSeenUrls()
    tracker.clearVisitedUrls()
    expect(listener.mock.calls).toEqual([['image'], ['failed']])
    tracker.clearCache()
    expect(listener).toHaveBeenLastCalledWith(undefined)
    unsubscribe()
    listener.mockClear()
    tracker.markFailedUrl('other')
    expect(listener).not.toHaveBeenCalled()
  })

  it('captures the URLs consulted by measurements and restores collectors after nested reads and errors', () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    const result = tracker.collectLayoutUrls(() => {
      tracker.getCachedPreview('preview')
      const nested = tracker.collectLayoutUrls(() => tracker.getImageDimensions('thumbnail'))
      expect(nested.urls).toEqual(new Set(['thumbnail']))
      expect(() =>
        tracker.collectLayoutUrls(() => {
          tracker.isFailedUrl('failed')
          throw new Error('measurement failed')
        })
      ).toThrow('measurement failed')
      tracker.isFailedUrl('image')
      return 48
    })
    expect(result).toEqual({
      value: 48,
      urls: new Set(['preview', 'thumbnail', 'failed', 'image'])
    })
    tracker.getCachedPreview('outside')
    expect(result.urls.has('outside')).toBe(false)
    expect(tracker.collectLayoutUrls(() => 1).urls.size).toBe(0)
  })

  it('notifies preview completion and refresh resets without notifying cache hits or stale completions', async () => {
    let finish!: (value: { status: number; link: string; thumbnail: string }) => void
    const preview = { status: 200, link: 'page', thumbnail: 'image' }
    const getLinkPreview = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
    vi.stubGlobal('window', { api: { getLinkPreview } })
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    const listener = vi.fn()
    tracker.subscribeLayout(listener)
    await tracker.getPreview('page')
    await tracker.getPreview('page')
    expect(listener.mock.calls).toEqual([['page']])
    const pending = tracker.getPreview('page', true)
    expect(listener.mock.calls).toEqual([['page'], ['page']])
    tracker.clearCache()
    listener.mockClear()
    finish(preview)
    await pending
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not restore a preview cache cleared while a request was pending', async () => {
    let finish!: (value: { status: number; link: string }) => void
    vi.stubGlobal('window', {
      api: {
        getLinkPreview: vi.fn(
          () =>
            new Promise((resolve) => {
              finish = resolve
            })
        )
      }
    })
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    const pending = tracker.getPreview('https://example.com')
    const queued = tracker.getPreview('https://example.com')
    tracker.clearCache()
    finish({ status: 200, link: 'https://example.com' })
    expect(await pending).toBeNull()
    expect(await queued).toBeNull()
    expect(tracker.hasPreview('https://example.com')).toBe(false)
  })

  it('shares decoded image dimensions until the cache is cleared', () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    tracker.recordImageDimensions('image', {
      naturalWidth: 320,
      naturalHeight: 180
    } as HTMLImageElement)
    tracker.recordImageDimensions('image', {
      naturalWidth: 0,
      naturalHeight: 0
    } as HTMLImageElement)
    expect(tracker.getImageDimensions('image')).toEqual({ width: 320, height: 180 })
    tracker.clearCache()
    expect(tracker.getImageDimensions('image')).toBeUndefined()
  })

  it('clears only the retried renderer failure and forwards refresh to the main cache', async () => {
    const getLinkPreview = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 200,
        link: 'https://example.com/other',
        thumbnail: 'https://example.com/other.jpg'
      })
      .mockResolvedValueOnce({
        status: 200,
        link: 'https://example.com/failed',
        thumbnail: 'https://example.com/recovered.jpg'
      })
    vi.stubGlobal('window', {
      api: { getLinkPreview, addUrlSeen: vi.fn(), addUrlClicked: vi.fn() }
    })
    const tracker = new UrlTracker({ chatterinoBaseUrl: 'https://resolver.example/' })
    const failed = 'https://example.com/failed'
    const other = 'https://example.com/other'
    await tracker.getPreview(failed)
    const otherPreview = await tracker.getPreview(other)
    await tracker.markSeenUrl(failed)
    await tracker.markVisitedUrl(other)
    expect(tracker.isFailedUrl(failed)).toBe(true)
    await tracker.getPreview(failed)
    expect(getLinkPreview).toHaveBeenCalledTimes(2)
    const result = await tracker.getPreview(failed, true)
    expect(result?.thumbnail).toBe('https://example.com/recovered.jpg')
    expect(getLinkPreview).toHaveBeenLastCalledWith(failed, 'https://resolver.example/', {
      refresh: true
    })
    expect(tracker.isFailedUrl(failed)).toBe(false)
    expect(await tracker.getPreview(other)).toBe(otherPreview)
    expect(getLinkPreview).toHaveBeenCalledTimes(3)
    expect(tracker.isSeenUrl(failed)).toBe(true)
    expect(tracker.isVisitedUrl(other)).toBe(true)
  })
})

describe('URL tracker preview text', () => {
  it('records successful preview details and forgets refreshed or cleared previews', async () => {
    const url = 'https://youtube.com/watch?v=video'
    const failed = 'https://example.com/failed'
    const getLinkPreview = vi.fn(async (requested: string) =>
      requested === failed
        ? null
        : { status: 200, link: requested, tooltip: '<div><b>Title</b><br>Channel: Name</div>' }
    )
    vi.stubGlobal('window', { api: { getLinkPreview } })
    // Node has no DOMParser; stand in for the tooltip conversion.
    vi.spyOn(UrlTracker, 'parseTooltipToText').mockImplementation((tooltip) =>
      tooltip.replaceAll('<br>', '\n').replace(/<[^>]+>/g, '')
    )
    const texts = new Map<string, string | undefined>()
    const tracker = new UrlTracker(
      { chatterinoBaseUrl: 'https://resolver.example/' },
      {
        set: (key, text) => (text === undefined ? texts.delete(key) : texts.set(key, text))
      }
    )
    await tracker.getPreview(url)
    await tracker.getPreview(failed)
    expect(Object.fromEntries(texts)).toEqual({ [url]: 'Title\nChannel: Name' })
    getLinkPreview.mockResolvedValueOnce(null)
    await tracker.getPreview(url, true)
    expect(texts.size).toBe(0)
    await tracker.getPreview(url, true)
    texts.set('https://other.example/', 'from another window')
    tracker.clearCache()
    expect(Object.fromEntries(texts)).toEqual({ 'https://other.example/': 'from another window' })
  })
})
