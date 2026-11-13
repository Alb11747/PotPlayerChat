import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserByName, saveTTLSetting } = vi.hoisted(() => ({
  getUserByName: vi.fn(),
  saveTTLSetting: vi.fn()
}))

vi.mock('@/utils/config', () => ({
  loadTTLSetting: vi.fn().mockResolvedValue(null),
  saveTTLSetting
}))
vi.mock('@twurple/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@twurple/api')>()),
  ApiClient: class {
    users = { getUserByName }
  }
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  getUserByName.mockReset()
  vi.stubGlobal('window', {
    api: { loadKeys: vi.fn().mockResolvedValue({ twitch: { clientId: 'test-client' } }) }
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Each case re-imports the Twitch client module graph after resetModules(). That
// cold import alone takes seconds when the whole suite runs in parallel.
describe('Twitch user ID lookup', { timeout: 30000 }, () => {
  it('retries after a transient failure and caches the recovered user ID', async () => {
    getUserByName
      .mockRejectedValueOnce(new Error('Temporary Twitch failure'))
      .mockResolvedValueOnce({ id: '123' })
    const { TwitchUserService } = await import('./twitch-api')

    expect(await TwitchUserService.getUserIdByName('alice')).toBeNull()
    expect(TwitchUserService.userIdCache.has('alice')).toBe(false)
    expect(saveTTLSetting).not.toHaveBeenCalled()
    expect(await TwitchUserService.getUserIdByName('alice')).toBe('123')
    expect(await TwitchUserService.getUserIdByName('alice')).toBe('123')
    expect(getUserByName).toHaveBeenCalledTimes(2)
    expect(saveTTLSetting).toHaveBeenCalledWith(expect.any(Promise), 'cache:twitch-user-id', {
      alice: '123'
    })
  })

  it('caches and persists a successful not-found response', async () => {
    getUserByName.mockResolvedValue(null)
    const { TwitchUserService } = await import('./twitch-api')

    expect(await TwitchUserService.getUserIdByName('missing')).toBeNull()
    expect(await TwitchUserService.getUserIdByName('missing')).toBeNull()
    expect(getUserByName).toHaveBeenCalledTimes(1)
    expect(TwitchUserService.userIdCache.has('missing')).toBe(true)
    expect(saveTTLSetting).toHaveBeenCalledWith(expect.any(Promise), 'cache:twitch-user-id', {
      missing: null
    })
  })
})
