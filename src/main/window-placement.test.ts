import type { BrowserWindow, Rectangle } from 'electron'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const screen = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getDisplayMatching: vi.fn(),
  getDisplayNearestPoint: vi.fn()
}))
vi.mock('electron', () => ({ screen }))

import { ensureWindowOnScreen, fitWindowBounds, getWindowPlacement } from './window-placement'

const workArea = { x: 40, y: 30, width: 1000, height: 700 }
const display = { bounds: { x: 0, y: 0, width: 1040, height: 760 }, workArea }

beforeEach(() => {
  vi.resetAllMocks()
  screen.getAllDisplays.mockReturnValue([display])
  screen.getDisplayMatching.mockReturnValue(display)
  screen.getDisplayNearestPoint.mockReturnValue(display)
})

describe('fitting outer window bounds to a display work area', () => {
  it('preserves bounds already inside the work area', () => {
    const bounds = { x: 100, y: 100, width: 600, height: 500 }
    expect(fitWindowBounds(bounds, workArea, [360, 400])).toEqual({
      ...bounds,
      minWidth: 360,
      minHeight: 400
    })
  })

  it.each([
    [-300, 100, 40, 100],
    [900, 100, 740, 100],
    [100, -300, 100, 30],
    [100, 700, 100, 530],
    [-300, -300, 40, 30],
    [900, -300, 740, 30],
    [-300, 700, 40, 530],
    [900, 700, 740, 530]
  ])('fits an opening at (%i, %i) within the usable desktop', (x, y, expectedX, expectedY) => {
    expect(fitWindowBounds({ x, y, width: 300, height: 200 }, workArea)).toMatchObject({
      x: expectedX,
      y: expectedY,
      width: 300,
      height: 200
    })
  })

  it('keeps negative monitor coordinates and respects top and left taskbar insets', () => {
    expect(
      fitWindowBounds(
        { x: -2000, y: -1000, width: 600, height: 640 },
        { x: -1880, y: -860, width: 1880, height: 860 }
      )
    ).toMatchObject({ x: -1880, y: -860, width: 600, height: 640 })
  })

  it('does not introduce overflow when the window exactly fills the work area', () => {
    expect(fitWindowBounds({ ...workArea }, workArea)).toMatchObject(workArea)
  })

  it('shrinks oversized outer bounds to fit without shrinking the other dimension', () => {
    expect(
      fitWindowBounds({ x: 100, y: 100, width: 600, height: 900 }, workArea, [360, 400])
    ).toEqual({ x: 100, y: 30, width: 600, height: 700, minWidth: 360, minHeight: 400 })
  })

  it('caps minimum sizes when the available work area is smaller than the usual minimum', () => {
    expect(
      fitWindowBounds(
        { x: 0, y: 0, width: 600, height: 640 },
        { x: 20, y: 30, width: 320, height: 350 },
        [360, 400]
      )
    ).toEqual({ x: 20, y: 30, width: 320, height: 350, minWidth: 320, minHeight: 350 })
  })

  it('honors the minimum when requested dimensions are smaller and space is available', () => {
    expect(
      fitWindowBounds({ x: 100, y: 100, width: 100, height: 100 }, workArea, [360, 400])
    ).toEqual({ x: 100, y: 100, width: 360, height: 400, minWidth: 360, minHeight: 400 })
  })

  it('centers over the opener before moving the whole window inside the work area', () => {
    expect(
      fitWindowBounds({ x: 0, y: 0, width: 600, height: 400 }, workArea, [360, 400], {
        x: 800,
        y: 600,
        width: 200,
        height: 100
      })
    ).toEqual({ x: 440, y: 330, width: 600, height: 400, minWidth: 360, minHeight: 400 })
  })
})

describe('choosing an available display', () => {
  it('uses the display intersecting the requested bounds', () => {
    const bounds = { x: 900, y: 600, width: 300, height: 200 }
    expect(getWindowPlacement(bounds)).toMatchObject({ x: 740, y: 530 })
    expect(screen.getDisplayMatching).toHaveBeenCalledWith(bounds)
    expect(screen.getDisplayNearestPoint).not.toHaveBeenCalled()
  })

  it('uses the nearest display when the requested bounds are completely off-screen', () => {
    const bounds = { x: -1800, y: 300, width: 600, height: 400 }
    expect(getWindowPlacement(bounds)).toMatchObject({ x: 40, y: 300 })
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: -1500, y: 500 })
    expect(screen.getDisplayMatching).not.toHaveBeenCalled()
  })

  it('does not consider an edge touching a display to be visible overlap', () => {
    getWindowPlacement({ x: 1040, y: 100, width: 600, height: 400 })
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 1340, y: 300 })
  })

  it('places a child on its opener display even when requested coordinates point elsewhere', () => {
    const secondary = {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: -1920, y: 0, width: 1920, height: 1040 }
    }
    screen.getAllDisplays.mockReturnValue([display, secondary])
    screen.getDisplayMatching.mockReturnValue(secondary)
    const opener = { x: -1700, y: 100, width: 600, height: 800 }
    expect(
      getWindowPlacement({ x: 100, y: 100, width: 420, height: 690 }, [360, 400], opener)
    ).toMatchObject({ x: -1610, y: 155, width: 420, height: 690 })
    expect(screen.getDisplayMatching).toHaveBeenCalledWith(opener)
  })
})

function windowMock(
  bounds: Rectangle,
  minimum: [number, number] = [360, 400]
): {
  isDestroyed: Mock<() => boolean>
  getBounds: Mock<() => Rectangle>
  getMinimumSize: Mock<() => [number, number]>
  setMinimumSize: Mock
  setBounds: Mock
} {
  return {
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => bounds),
    getMinimumSize: vi.fn(() => minimum),
    setMinimumSize: vi.fn(),
    setBounds: vi.fn()
  }
}

describe('final bounds correction before showing a native window', () => {
  it('leaves an already visible main window and its native minimums unchanged', () => {
    const window = windowMock({ x: 100, y: 100, width: 600, height: 500 })
    ensureWindowOnScreen(window as unknown as BrowserWindow)
    expect(window.setMinimumSize).not.toHaveBeenCalled()
    expect(window.setBounds).not.toHaveBeenCalled()
  })

  it('centers actual native dimensions over an opener that moved before its child was ready', () => {
    const secondary = {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: -1920, y: 0, width: 1920, height: 1040 }
    }
    screen.getAllDisplays.mockReturnValue([display, secondary])
    screen.getDisplayMatching.mockReturnValue(secondary)
    const window = windowMock({ x: 100, y: 100, width: 440, height: 730 })
    const opener = windowMock({ x: -1700, y: 100, width: 600, height: 800 })
    ensureWindowOnScreen(window as unknown as BrowserWindow, opener as unknown as BrowserWindow)
    expect(opener.getBounds).toHaveBeenCalled()
    expect(window.setBounds).toHaveBeenCalledWith({
      x: -1620,
      y: 135,
      width: 440,
      height: 730
    })
  })

  it('reads the current outer bounds and the latest usable display area', () => {
    const window = windowMock({ x: 900, y: 600, width: 600, height: 640 })
    screen.getDisplayMatching.mockReturnValue({
      ...display,
      workArea: { x: 0, y: 0, width: 800, height: 600 }
    })
    ensureWindowOnScreen(window as unknown as BrowserWindow)
    expect(window.getBounds).toHaveBeenCalled()
    expect(window.setBounds).toHaveBeenCalledWith({ x: 200, y: 0, width: 600, height: 600 })
  })

  it('reduces native minimums before applying bounds that require a smaller window', () => {
    const window = windowMock({ x: 0, y: 0, width: 600, height: 640 })
    screen.getDisplayMatching.mockReturnValue({
      ...display,
      workArea: { x: 0, y: 0, width: 320, height: 350 }
    })
    ensureWindowOnScreen(window as unknown as BrowserWindow)
    expect(window.setMinimumSize).toHaveBeenCalledWith(320, 350)
    expect(window.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 320, height: 350 })
    expect(window.setMinimumSize.mock.invocationCallOrder[0]).toBeLessThan(
      window.setBounds.mock.invocationCallOrder[0]!
    )
  })

  it('does not inspect a destroyed opener while correcting its child', () => {
    const window = windowMock({ x: 900, y: 600, width: 600, height: 640 })
    const opener = windowMock({ x: -1900, y: 100, width: 600, height: 800 })
    opener.isDestroyed.mockReturnValue(true)
    ensureWindowOnScreen(window as unknown as BrowserWindow, opener as unknown as BrowserWindow)
    expect(opener.getBounds).not.toHaveBeenCalled()
    expect(window.setBounds).toHaveBeenCalledWith({ x: 440, y: 90, width: 600, height: 640 })
  })
})
