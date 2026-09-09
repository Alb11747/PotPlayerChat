import { afterEach, describe, expect, it, vi } from 'vitest'
import { UrlTracker } from './url-tracker'

afterEach(() => vi.unstubAllGlobals())

describe('URL tracker retry', () => {
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
