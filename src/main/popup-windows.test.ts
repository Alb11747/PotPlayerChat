import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import { shell } from 'electron'
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
const { display } = vi.hoisted(() => ({
  display: {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  }
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  screen: {
    getAllDisplays: () => [display],
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display
  }
}))
import { getPopupKind, initPopupWindows } from './popup-windows'

beforeEach(() => {
  vi.mocked(shell.openExternal).mockClear()
  display.workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
})
afterEach(() => vi.unstubAllEnvs())

type MockWindow = {
  getBounds: () => Rectangle
  getMinimumSize: () => [number, number]
  setBounds: Mock<(next: Rectangle) => void>
  setMinimumSize: Mock<(width: number, height: number) => void>
  webContents: { setWindowOpenHandler: Mock; on: Mock }
  once: Mock
  show: Mock
  focus: Mock
  isDestroyed: () => boolean
}

function mockWindow(initialBounds: Rectangle): MockWindow {
  let bounds = initialBounds
  let minimumSize: [number, number] = [360, 400]
  return {
    getBounds: () => bounds,
    getMinimumSize: () => minimumSize,
    setBounds: vi.fn((next: Rectangle) => {
      bounds = next
    }),
    setMinimumSize: vi.fn((width: number, height: number) => {
      minimumSize = [width, height]
    }),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
    once: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false
  }
}

function createPopup(
  source: MockWindow,
  kind: string
): {
  popup: MockWindow
  options: BrowserWindowConstructorOptions & Rectangle
  ready: () => void
} {
  const url = `http://localhost:5173/${kind}.html#token`
  const options = source.webContents.setWindowOpenHandler.mock.calls[0]![0]({
    url
  }).overrideBrowserWindowOptions
  const popup = mockWindow(options)
  source.webContents.on.mock.calls.find(([event]) => event === 'did-create-window')![1](popup, {
    url
  })
  return {
    popup,
    options,
    ready: () => popup.once.mock.calls.find(([event]) => event === 'ready-to-show')![1]()
  }
}

describe('owned native popup routes', () => {
  it('routes native web navigation and external popups to the browser', () => {
    const source = mockWindow({ x: 100, y: 100, width: 600, height: 800 })
    initPopupWindows(source as never)
    const navigate = source.webContents.on.mock.calls.find(
      ([event]) => event === 'will-navigate'
    )![1]
    const event = { preventDefault: vi.fn() }
    navigate(event, 'https://youtube.com/watch?v=video')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(shell.openExternal).toHaveBeenCalledWith('https://youtube.com/watch?v=video')
    expect(
      source.webContents.setWindowOpenHandler.mock.calls[0]![0]({
        url: 'https://example.com/image.png'
      })
    ).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/image.png')
    const { popup } = createPopup(source, 'preview')
    const popupNavigate = popup.webContents.on.mock.calls.find(
      ([event]) => event === 'will-navigate'
    )![1]
    popupNavigate(event, 'https://example.com/from-preview')
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/from-preview')
  })

  it.each(['javascript:alert(1)', 'file:///private/file', 'invalid'])(
    'blocks non-web native navigation: %s',
    (url) => {
      const source = mockWindow({ x: 100, y: 100, width: 600, height: 800 })
      initPopupWindows(source as never)
      const navigate = source.webContents.on.mock.calls.find(
        ([event]) => event === 'will-navigate'
      )![1]
      const event = { preventDefault: vi.fn() }
      navigate(event, url)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(shell.openExternal).not.toHaveBeenCalled()
    }
  )
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
    const source = mockWindow({ x: 100, y: 100, width: 600, height: 800 })
    const { setWindowOpenHandler: handler, on } = source.webContents
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
    const popup = mockWindow(allowed.overrideBrowserWindowOptions)
    const didCreate = on.mock.calls.find(([event]) => event === 'did-create-window')![1]
    didCreate(popup, { url: 'http://localhost:5173/preview.html#token' })
    popup.once.mock.calls.find(([event]) => event === 'ready-to-show')![1]()
    expect(popup.show).toHaveBeenCalledOnce()
    expect(popup.focus).toHaveBeenCalledOnce()
    popup.once.mock.calls.find(([event]) => event === 'closed')![1]()
    expect(source.focus).toHaveBeenCalledOnce()
  })

  it.each([
    ['search', 480, 640],
    ['user', 600, 640],
    ['preview', 420, 690]
  ])(
    'fits %s windows before creation and corrects native bounds before showing',
    (kind, width, height) => {
      const source = mockWindow({ x: 1800, y: 950, width: 600, height: 800 })
      initPopupWindows(source as never)
      const { popup, options, ready } = createPopup(source, kind as string)
      expect(options).toMatchObject({
        x: 1920 - Number(width),
        y: 1040 - Number(height),
        width,
        height
      })
      popup.setBounds({ x: 1800, y: 950, width: Number(width), height: Number(height) })
      popup.setBounds.mockClear()
      ready()
      expect(popup.getBounds()).toEqual({
        x: 1920 - Number(width),
        y: 1040 - Number(height),
        width,
        height
      })
      expect(popup.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
        popup.show.mock.invocationCallOrder[0]!
      )
    }
  )

  it('uses the current work area and lowers minimums before showing after a display change', () => {
    const source = mockWindow({ x: 1400, y: 100, width: 600, height: 800 })
    initPopupWindows(source as never)
    const { popup, ready } = createPopup(source, 'preview')
    display.workArea = { x: 0, y: 30, width: 320, height: 350 }
    ready()
    expect(popup.getBounds()).toEqual({ x: 0, y: 30, width: 320, height: 350 })
    expect(popup.getMinimumSize()).toEqual([320, 350])
    expect(popup.setMinimumSize.mock.invocationCallOrder[0]).toBeLessThan(
      popup.setBounds.mock.invocationCallOrder[0]!
    )
    expect(popup.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
      popup.show.mock.invocationCallOrder[0]!
    )
  })

  it('centers nested popups on their immediate opener', () => {
    const source = mockWindow({ x: 0, y: 0, width: 600, height: 800 })
    initPopupWindows(source as never)
    const { popup: first, ready: firstReady } = createPopup(source, 'user')
    firstReady()
    first.setBounds({ x: 1100, y: 200, width: 600, height: 640 })
    const { popup: nested, options, ready } = createPopup(first, 'search')
    expect(options.parent).toBe(first)
    ready()
    expect(nested.getBounds()).toMatchObject({ x: 1160, y: 264, width: 480, height: 512 })
  })
})
