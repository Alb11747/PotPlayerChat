import type { HWND } from '@/types/globals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const osMocks = vi.hoisted(() => ({
  getPlaylists: vi.fn(),
  getStreamHistory: vi.fn(),
  getTotalVideoTime: vi.fn()
}))

vi.mock('@/core/os/potplayer', () => osMocks)

import { clearTitleCache, getPotplayerExtraInfo, initCache } from '@/core/potplayer/potplayer'

const hwnd = 1 as unknown as HWND
const duration = 60 * 60 * 1000

describe('getPotplayerExtraInfo', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    clearTitleCache()
    osMocks.getPlaylists.mockReset()
    osMocks.getStreamHistory.mockReset()
    osMocks.getTotalVideoTime.mockReset()
    osMocks.getPlaylists.mockResolvedValue([])
    osMocks.getStreamHistory.mockResolvedValue([])
    osMocks.getTotalVideoTime.mockResolvedValue(duration)
  })

  it('resolves complete filename metadata without reading playlists or history', async () => {
    const title = '[2023-04-17T22-30-07Z] [fobm4ster] Stream title.mp4'

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result).toMatchObject({
      channel: 'fobm4ster',
      startTime: Date.parse('2023-04-17T22:30:07Z'),
      endTime: Date.parse('2023-04-17T23:30:07Z')
    })
    expect(osMocks.getPlaylists).not.toHaveBeenCalled()
    expect(osMocks.getStreamHistory).not.toHaveBeenCalled()
  })

  it('refreshes growing recordings on every cache hit without persisting their end time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T23:00:00Z'))
    const title = '[2026-09-25T22-00-00Z] [growing_stream] Stream title.mp4'
    const startTime = Date.parse('2026-09-25T22:00:00Z')
    const set = vi.fn()
    initCache({ get: vi.fn(), set, delete: vi.fn() } as never)
    osMocks.getTotalVideoTime
      .mockResolvedValueOnce(duration)
      .mockResolvedValueOnce(duration * 2)
      .mockResolvedValueOnce(duration * 3)

    for (let index = 1; index <= 3; index++) {
      expect((await getPotplayerExtraInfo({ hwnd, title }))?.endTime).toBe(
        startTime + duration * index
      )
      expect(set.mock.lastCall?.[1][title].endTime).toBeUndefined()
    }
    expect(osMocks.getTotalVideoTime).toHaveBeenCalledTimes(3)
    expect(set).toHaveBeenCalledOnce()
  })

  it('refreshes a recent persisted end time and caches the final duration after two days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T23:00:00Z'))
    const title = 'Recent cached recording.mp4'
    const startTime = Date.parse('2026-09-25T22:00:00Z')
    const set = vi.fn()
    initCache({
      get: vi.fn().mockReturnValue({
        [title]: { channel: 'growing_stream', startTime, endTime: startTime + 1000 }
      }),
      set,
      delete: vi.fn()
    } as never)

    expect((await getPotplayerExtraInfo({ hwnd, title }))?.endTime).toBe(startTime + duration)
    expect(set.mock.lastCall?.[1][title].endTime).toBeUndefined()
    vi.setSystemTime(new Date(startTime + 2 * 24 * 60 * 60 * 1000))
    osMocks.getTotalVideoTime.mockResolvedValue(duration * 2)
    expect((await getPotplayerExtraInfo({ hwnd, title }))?.endTime).toBe(startTime + duration * 2)
    expect(set.mock.lastCall?.[1][title].endTime).toBe(startTime + duration * 2)
    await getPotplayerExtraInfo({ hwnd, title })
    expect(osMocks.getTotalVideoTime).toHaveBeenCalledTimes(2)
  })

  it('does not return a stale recent duration when refreshing it fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T23:00:00Z'))
    const title = 'Recent cached recording.mp4'
    const startTime = Date.parse('2026-09-25T22:00:00Z')
    initCache({
      get: vi.fn().mockReturnValue({
        [title]: { channel: 'growing_stream', startTime, endTime: startTime + 1000 }
      }),
      set: vi.fn(),
      delete: vi.fn()
    } as never)
    osMocks.getTotalVideoTime.mockResolvedValue(0)

    expect(await getPotplayerExtraInfo({ hwnd, title })).toBeNull()
    osMocks.getTotalVideoTime.mockRejectedValue(new Error('timed out'))
    expect(await getPotplayerExtraInfo({ hwnd, title })).toBeNull()
  })

  it('returns missing metadata after a native timeout and recovers on the next lookup', async () => {
    const title = '[2023-04-17T22-30-07Z] [fobm4ster] Stream title.mp4'
    const error = new Error('PotPlayer window message failed or timed out')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    osMocks.getTotalVideoTime.mockRejectedValueOnce(error).mockResolvedValueOnce(duration)

    try {
      expect(await getPotplayerExtraInfo({ hwnd, title })).toBeNull()
      expect(warning).toHaveBeenCalledWith('Could not read PotPlayer video duration:', error)
      expect(await getPotplayerExtraInfo({ hwnd, title })).toMatchObject({
        channel: 'fobm4ster',
        endTime: Date.parse('2023-04-17T23:30:07Z')
      })
      expect(osMocks.getTotalVideoTime).toHaveBeenCalledTimes(2)
    } finally {
      warning.mockRestore()
    }
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid video duration %s on the filename fast path',
    async (videoDuration) => {
      const title = `[2023-04-22T22-30-07Z] [duration_${String(videoDuration).replace('-', 'n')}] Stream title.mp4`
      osMocks.getTotalVideoTime.mockResolvedValue(videoDuration)

      const result = await getPotplayerExtraInfo({ hwnd, title })

      expect(result).toBeNull()
      expect(osMocks.getPlaylists).not.toHaveBeenCalled()
      expect(osMocks.getStreamHistory).not.toHaveBeenCalled()
    }
  )

  it('uses a valid path streamer when the filename has only a timestamp', async () => {
    const title = '[2023-04-18T22-30-07Z] Stream title.mp4'
    osMocks.getPlaylists.mockResolvedValue([
      { name: 'saved', url: `E:\\Media\\Streams\\path_streamer\\${title}` }
    ])

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result?.channel).toBe('path_streamer')
    expect(osMocks.getPlaylists).toHaveBeenCalledOnce()
    expect(osMocks.getStreamHistory).not.toHaveBeenCalled()
  })

  it('falls back to a valid path when the filename streamer is invalid', async () => {
    const title = '[2023-04-19T22-30-07Z] [invalid-name] Stream title.mp4'
    osMocks.getPlaylists.mockResolvedValue([
      { name: 'saved', url: `E:\\Media\\Streams\\valid_path\\${title}` }
    ])

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result?.channel).toBe('valid_path')
  })

  it('rejects an invalid streamer from both playlist and history paths', async () => {
    const title = '[2023-04-20T22-30-07Z] Stream title.mp4'
    osMocks.getPlaylists.mockResolvedValue([
      { name: 'saved', url: `E:\\Media\\Streams\\invalid-name\\${title}` }
    ])
    osMocks.getStreamHistory.mockResolvedValue([
      { url: `https://example.test/streams/also-invalid/${title}`, title }
    ])

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result).toBeNull()
    expect(osMocks.getStreamHistory).toHaveBeenCalledOnce()
  })

  it('ignores an invalid cached channel and replaces it from the filename', async () => {
    const title = '[2023-04-21T22-30-07Z] [valid_name] Stream title.mp4'
    const set = vi.fn()
    initCache({
      get: vi.fn().mockReturnValue({
        [title]: {
          channel: 'invalid-name',
          startTime: Date.parse('2023-04-21T22:30:07Z')
        }
      }),
      set,
      delete: vi.fn()
    } as never)

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result?.channel).toBe('valid_name')
    expect(osMocks.getPlaylists).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalled()
  })

  it('clears cached title metadata from memory and persisted configuration', async () => {
    const title = 'Title that requires playlist metadata.mp4'
    const deleteEntry = vi.fn()
    initCache({
      get: vi.fn().mockReturnValue({
        [title]: {
          channel: 'cached_channel',
          startTime: Date.parse('2023-04-21T22:30:07Z'),
          endTime: Date.parse('2023-04-21T23:30:07Z')
        }
      }),
      set: vi.fn(),
      delete: deleteEntry
    } as never)

    clearTitleCache()
    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result).toBeNull()
    expect(deleteEntry).toHaveBeenCalledWith('cache:title')
    expect(osMocks.getPlaylists).toHaveBeenCalledOnce()
    expect(osMocks.getStreamHistory).toHaveBeenCalledOnce()
  })
})
