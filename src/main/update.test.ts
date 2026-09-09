import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true },
  existsSync: vi.fn(),
  updater: { allowPrerelease: false, checkForUpdatesAndNotify: vi.fn() }
}))
vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
import { initAutoUpdater } from './update'

const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeAll(() =>
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/test/resources' })
)
afterAll(() => {
  if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
  else Reflect.deleteProperty(process, 'resourcesPath')
})

describe('automatic update initialization', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.app.isPackaged = true
    mocks.existsSync.mockReturnValue(true)
    mocks.updater.allowPrerelease = false
    mocks.updater.checkForUpdatesAndNotify.mockResolvedValue(null)
  })

  it('skips packaged directory builds without updater metadata', () => {
    mocks.existsSync.mockReturnValue(false)
    const config = { get: vi.fn() }
    initAutoUpdater(config as never)
    expect(mocks.existsSync).toHaveBeenCalledWith(join('/test/resources', 'app-update.yml'))
    expect(mocks.updater.checkForUpdatesAndNotify).not.toHaveBeenCalled()
    expect(config.get).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'keeps installed-release checks and prerelease preference %s',
    (prerelease) => {
      const config = { get: vi.fn(() => prerelease) }
      initAutoUpdater(config as never)
      expect(config.get).toHaveBeenCalledWith('prerelease', false)
      expect(mocks.updater.allowPrerelease).toBe(prerelease)
      expect(mocks.updater.checkForUpdatesAndNotify).toHaveBeenCalledOnce()
    }
  )

  it('leaves development update handling to electron-updater', () => {
    mocks.app.isPackaged = false
    mocks.existsSync.mockReturnValue(false)
    initAutoUpdater({ get: () => false } as never)
    expect(mocks.existsSync).not.toHaveBeenCalled()
    expect(mocks.updater.checkForUpdatesAndNotify).toHaveBeenCalledOnce()
  })

  it('handles rejected checks so a network failure cannot become an unhandled rejection', async () => {
    const error = new Error('Network unavailable')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.updater.checkForUpdatesAndNotify.mockRejectedValue(error)
    initAutoUpdater({ get: () => false } as never)
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith('Automatic update check failed:', error)
  })
})
