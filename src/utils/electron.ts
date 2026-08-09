import type { BrowserWindow } from 'electron'

export function isDescendantWindow(parentWindow: BrowserWindow, window: BrowserWindow): boolean {
  let parent = window.getParentWindow()
  while (parent) {
    if (parent === parentWindow) return true
    parent = parent.getParentWindow()
  }
  return false
}
