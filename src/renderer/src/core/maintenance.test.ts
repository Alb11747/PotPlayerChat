import { beforeEach, describe, expect, it, vi } from 'vitest'

const clearAll = vi.hoisted(() => vi.fn())
vi.mock('@/core/chat/twitch-api', () => ({ clearAll }))

import { clearRendererCache, clearRendererSavedUrls } from './maintenance'

describe('renderer maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears renderer caches without recreating persisted Twitch entries', () => {
    const chatService = { clearCache: vi.fn() }
    const urlTracker = {
      clearCache: vi.fn(),
      clearSeenUrls: vi.fn(),
      clearVisitedUrls: vi.fn()
    }

    clearRendererCache(chatService as never, urlTracker as never)

    expect(chatService.clearCache).toHaveBeenCalledOnce()
    expect(urlTracker.clearCache).toHaveBeenCalledOnce()
    expect(clearAll).toHaveBeenCalledWith(undefined, { userIds: true, persist: false })
  })

  it('clears both seen and clicked URL state', () => {
    const urlTracker = {
      clearSeenUrls: vi.fn(),
      clearVisitedUrls: vi.fn()
    }

    clearRendererSavedUrls(urlTracker as never)

    expect(urlTracker.clearSeenUrls).toHaveBeenCalledOnce()
    expect(urlTracker.clearVisitedUrls).toHaveBeenCalledOnce()
  })
})
