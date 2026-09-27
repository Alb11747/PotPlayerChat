import { is } from '@electron-toolkit/utils'
import { shell, type BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import icon from '../../resources/icon.png?asset'
import { ensureWindowOnScreen, getWindowPlacement } from './window-placement'

export type PopupKind = 'search' | 'user' | 'preview'

function rendererUrl(file: `${PopupKind}.html`): string {
  const base = process.env['ELECTRON_RENDERER_URL']
  return is.dev && base
    ? new URL(file, base.endsWith('/') ? base : `${base}/`).href
    : pathToFileURL(join(__dirname, `../renderer/${file}`)).href
}

export function getPopupKind(url: string, expected: Record<PopupKind, string>): PopupKind | null {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const [kind, ownedUrl] of Object.entries(expected)) {
      if (parsed.href === ownedUrl) return kind as PopupKind
    }
  } catch {
    /* Invalid or non-owned destinations are denied. */
  }
  return null
}

/** Every owned popup can open another owned view, with lifetime tied to its opener. */
export function initPopupWindows(source: BrowserWindow): void {
  const urls: Record<PopupKind, string> = {
    search: rendererUrl('search.html'),
    user: rendererUrl('user.html'),
    preview: rendererUrl('preview.html')
  }
  source.webContents.setWindowOpenHandler(({ url }) => {
    const kind = getPopupKind(url, urls)
    if (!kind) {
      openExternalLink(url)
      return { action: 'deny' }
    }
    const bounds = source.getBounds()
    const placement = getWindowPlacement(
      {
        ...bounds,
        width: kind === 'preview' ? 420 : kind === 'user' ? 600 : Math.round(bounds.width * 0.8),
        height: kind === 'preview' ? 690 : kind === 'user' ? 640 : Math.round(bounds.height * 0.8)
      },
      [360, 400],
      bounds
    )
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        icon,
        ...placement,
        show: false,
        autoHideMenuBar: true,
        parent: source,
        modal: false,
        webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
      }
    }
  })
  // Native anchor navigation can bypass the renderer's explicit openUrl IPC
  // (for example middle-click or a link in generated markup).
  source.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalLink(url)
  })
  source.webContents.on('did-create-window', (popup, { url }) => {
    if (!getPopupKind(url, urls)) return
    initPopupWindows(popup)
    popup.once('ready-to-show', () => {
      ensureWindowOnScreen(popup, source)
      popup.show()
      popup.focus()
    })
    popup.once('closed', () => {
      if (!source.isDestroyed()) source.focus()
    })
  })
}

function openExternalLink(url: string): void {
  try {
    const protocol = new URL(url).protocol
    if (protocol !== 'http:' && protocol !== 'https:') return
  } catch {
    return
  }
  void shell.openExternal(url).catch((error) => {
    console.error('Unable to open external link:', error)
  })
}
