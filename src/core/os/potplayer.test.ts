import type { HWND } from '@/types/globals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  list: vi.fn(),
  sendMessage: vi.fn()
}))

vi.mock('fs/promises', () => ({ readdir: mocks.readdir, readFile: mocks.readFile }))
vi.mock('regedit', () => ({
  default: { setExternalVBSLocation: vi.fn(), promisified: { list: mocks.list } }
}))
vi.mock('@/core/os/windows', () => ({
  findPotPlayerHwndByPid: vi.fn(),
  getWindowsByExe: vi.fn(),
  sendMessage: mocks.sendMessage
}))

import { getPlaylists } from './potplayer'
import { clearTitleCache, getPotplayerExtraInfo } from '../potplayer/potplayer'

describe('optional PotPlayer playlists', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearTitleCache()
    vi.stubEnv('APPDATA', 'C:\\example-appdata')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('treats a missing playlist directory as empty and resolves metadata from history', async () => {
    mocks.readdir.mockRejectedValue(
      Object.assign(new Error('Missing directory'), { code: 'ENOENT' })
    )
    const title = '[2023-04-18T22-30-07Z] Stream title.mp4'
    mocks.list.mockResolvedValue({
      'HKCU\\Software\\DAUM\\PotPlayerMini64\\UrlHistory': {
        exists: true,
        values: {
          0: { value: `E:\\Media\\Streams\\history_streamer\\${title}` },
          '0_t': { value: title }
        }
      }
    })
    mocks.sendMessage.mockResolvedValue(60000)

    expect(await getPotplayerExtraInfo({ hwnd: 1 as unknown as HWND, title })).toMatchObject({
      channel: 'history_streamer',
      startTime: Date.parse('2023-04-18T22:30:07Z'),
      endTime: Date.parse('2023-04-18T22:31:07Z')
    })
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it.each(['EACCES', 'EIO'])('propagates directory errors other than ENOENT (%s)', async (code) => {
    const error = Object.assign(new Error('Unreadable directory'), { code })
    mocks.readdir.mockRejectedValue(error)
    await expect(getPlaylists()).rejects.toBe(error)
  })

  it('propagates an error reading a discovered playlist', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'saved.dpl', parentPath: 'C:\\example-appdata', isFile: () => true }
    ])
    const error = Object.assign(new Error('Missing file'), { code: 'ENOENT' })
    mocks.readFile.mockRejectedValue(error)
    await expect(getPlaylists()).rejects.toBe(error)
  })
})
