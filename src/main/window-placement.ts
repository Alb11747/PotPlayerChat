import { screen, type BrowserWindow, type Rectangle } from 'electron'

type WindowPlacement = Rectangle & { minWidth: number; minHeight: number }

/** Work areas and outer window bounds are both in Electron's DIP coordinates. */
export function fitWindowBounds(
  bounds: Rectangle,
  workArea: Rectangle,
  minimumSize: readonly [number, number] = [0, 0],
  openerBounds?: Rectangle
): WindowPlacement {
  const minWidth = Math.min(minimumSize[0], workArea.width)
  const minHeight = Math.min(minimumSize[1], workArea.height)
  const width = Math.min(Math.max(bounds.width, minWidth), workArea.width)
  const height = Math.min(Math.max(bounds.height, minHeight), workArea.height)
  const x = openerBounds ? Math.round(openerBounds.x + (openerBounds.width - width) / 2) : bounds.x
  const y = openerBounds
    ? Math.round(openerBounds.y + (openerBounds.height - height) / 2)
    : bounds.y

  return {
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height)),
    width,
    height,
    minWidth,
    minHeight
  }
}

export function getWindowPlacement(
  bounds: Rectangle,
  minimumSize: readonly [number, number] = [0, 0],
  openerBounds?: Rectangle
): WindowPlacement {
  const anchor = openerBounds ?? bounds
  const intersectsDisplay = screen.getAllDisplays().some(({ bounds: display }) => {
    return (
      anchor.x < display.x + display.width &&
      anchor.x + anchor.width > display.x &&
      anchor.y < display.y + display.height &&
      anchor.y + anchor.height > display.y
    )
  })
  const display = intersectsDisplay
    ? screen.getDisplayMatching(anchor)
    : screen.getDisplayNearestPoint({
        x: Math.round(anchor.x + anchor.width / 2),
        y: Math.round(anchor.y + anchor.height / 2)
      })
  return fitWindowBounds(bounds, display.workArea, minimumSize, openerBounds)
}

/** Recheck while hidden: monitor layout and native frame sizing can change during loading. */
export function ensureWindowOnScreen(window: BrowserWindow, opener?: BrowserWindow): void {
  const bounds = window.getBounds()
  const minimumSize = window.getMinimumSize()
  const { minWidth, minHeight, ...placement } = getWindowPlacement(
    bounds,
    [minimumSize[0] ?? 0, minimumSize[1] ?? 0],
    opener && !opener.isDestroyed() ? opener.getBounds() : undefined
  )
  // Lower minimums first so Electron can fit windows on unusually small work areas.
  if (minimumSize[0] !== minWidth || minimumSize[1] !== minHeight) {
    window.setMinimumSize(minWidth, minHeight)
  }
  if (
    bounds.x !== placement.x ||
    bounds.y !== placement.y ||
    bounds.width !== placement.width ||
    bounds.height !== placement.height
  ) {
    window.setBounds(placement)
  }
}
