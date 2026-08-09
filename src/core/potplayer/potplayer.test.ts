import type { HWND } from '@/types/globals'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const osMocks = vi.hoisted(() => ({
  getPlaylists: vi.fn(),
  getStreamHistory: vi.fn(),
  getTotalVideoTime: vi.fn()
}))

vi.mock('@/core/os/potplayer', () => osMocks)

import { getPotplayerExtraInfo, initCache } from '@/core/potplayer/potplayer'

const hwnd = 1 as unknown as HWND
const duration = 60 * 60 * 1000

describe('getPotplayerExtraInfo', () => {
  beforeEach(() => {
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
      set
    } as never)

    const result = await getPotplayerExtraInfo({ hwnd, title })

    expect(result?.channel).toBe('valid_name')
    expect(osMocks.getPlaylists).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalled()
  })
})
