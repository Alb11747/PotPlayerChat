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
})
