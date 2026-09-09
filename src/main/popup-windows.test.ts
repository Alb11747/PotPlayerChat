import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
import { getPopupKind, initPopupWindows } from './popup-windows'

afterEach(() => vi.unstubAllEnvs())

describe('owned native popup routes', () => {
  const expected = {
    search: 'file:///app/search.html',
    user: 'file:///app/user.html',
    preview: 'file:///app/preview.html'
  }
  it('allows exact owned routes with context hashes', () => {
    expect(getPopupKind('file:///app/preview.html#context', expected)).toBe('preview')
    expect(getPopupKind('file:///app/user.html#context', expected)).toBe('user')
  })
  it.each([
    'https://external.test/preview.html',
    'file:///other/preview.html',
    'file:///app/preview.html?redirect=1',
    'javascript:alert(1)',
    'invalid'
  ])('rejects unowned destinations: %s', (url) => {
    expect(getPopupKind(url, expected)).toBeNull()
  })
  it('keeps previews non-modal, sized for narrow content and bound to the source lifetime', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
    const handler = vi.fn()
    const on = vi.fn()
    const source = {
      getBounds: () => ({ width: 600, height: 800 }),
      webContents: { setWindowOpenHandler: handler, on },
      isDestroyed: () => false,
      focus: vi.fn()
    }
    initPopupWindows(source as never)
    const decide = handler.mock.calls[0]![0]
    const allowed = decide({ url: 'http://localhost:5173/preview.html#token' })
    expect(allowed).toMatchObject({
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        width: 420,
        height: 690,
        minWidth: 360,
        minHeight: 400,
        modal: false,
        parent: source
      }
    })
    expect(decide({ url: 'https://not-owned.test/preview.html' }).action).toBe('deny')
    const popup = {
      webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
      once: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }
    const didCreate = on.mock.calls.find(([event]) => event === 'did-create-window')![1]
    didCreate(popup, { url: 'http://localhost:5173/preview.html#token' })
    popup.once.mock.calls.find(([event]) => event === 'ready-to-show')![1]()
    expect(popup.show).toHaveBeenCalledOnce()
    expect(popup.focus).toHaveBeenCalledOnce()
    popup.once.mock.calls.find(([event]) => event === 'closed')![1]()
    expect(source.focus).toHaveBeenCalledOnce()
  })
})
