import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({
  default: { ipcMain: { handle: vi.fn() } },
  shell: { openExternal: vi.fn() }
}))
import { clearLinkPreviewCache, getLinkPreview } from './links'

describe('targeted link preview retry', () => {
  beforeEach(() => {
    clearLinkPreviewCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('refreshes only the requested cached failure, preserving other cached URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ thumbnail: 'https://images.example/other.jpg' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ thumbnail: 'https://images.example/recovered.jpg' })
      })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failed = 'https://example.com/failed'
    const other = 'https://example.com/other'
    expect(await getLinkPreview(failed)).toBeNull()
    const cached = await getLinkPreview(other)
    expect(await getLinkPreview(failed)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await getLinkPreview(failed, undefined, { refresh: true }))?.thumbnail).toBe(
      'https://images.example/recovered.jpg'
    )
    expect(await getLinkPreview(other)).toBe(cached)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    'https://www.youtube.com/watch?v=video',
    'https://youtu.be/video',
    'https://m.youtube.com/shorts/video'
  ])('keeps full YouTube title and channel for %s and caches them', async (url) => {
    const title = 'A complete video title with details '.repeat(8)
    const author = 'Channel <name> & friends'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tooltip: 'Short...', thumbnail: 'image' })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ title, author_name: author }) })
    vi.stubGlobal('fetch', fetchMock)
    const preview = await getLinkPreview(url)
    expect(preview?.tooltip).toBe(
      `<div><b>${title}</b><br>Channel: Channel &lt;name&gt; &amp; friends</div>`
    )
    expect(preview?.thumbnail).toBe('image')
    expect(await getLinkPreview(url)).toBe(preview)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    )
  })

  it.each(['http', 'network', 'malformed'])(
    'preserves resolver metadata on oEmbed %s failure',
    async (failure) => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tooltip: encodeURIComponent('<b>Original title</b>') })
      })
      if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'))
      else
        fetchMock.mockResolvedValueOnce({
          ok: failure !== 'http',
          json: async () => ({ title: 12 })
        })
      vi.stubGlobal('fetch', fetchMock)
      expect((await getLinkPreview('https://youtube.com/watch?v=video'))?.tooltip).toBe(
        '<b>Original title</b>'
      )
    }
  )

  it('does not request YouTube metadata for lookalike hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tooltip: 'Other site' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect((await getLinkPreview('https://notyoutube.com/watch?v=video'))?.tooltip).toBe(
      'Other site'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
