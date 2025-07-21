import TTLCache from '@isaacs/ttlcache'
import electron, { shell } from 'electron'
import sanitizeHtml from 'sanitize-html'

type LinkPreview = {
  status: number
  thumbnail?: string
  tooltip?: string
  link: string
}

const defaultLinkPreviewUrl = 'https://chatterino.alb11747.com/link_resolver/'
const linkPreviewCacheTTL = 5 * 60 * 1000 // 5 minutes
const linkPreviewCache = new TTLCache<string, LinkPreview | null>({ ttl: linkPreviewCacheTTL })

export async function getLinkPreview(
  url: string,
  chatterinoBaseUrl: string = defaultLinkPreviewUrl
): Promise<LinkPreview | null> {
  try {
    if (
      !url ||
      typeof url !== 'string' ||
      (!url.startsWith('http://') && !url.startsWith('https://'))
    ) {
      console.warn('Invalid URL provided to getLinkPreview:', url)
      return null
    }

    if (linkPreviewCache.has(url)) return linkPreviewCache.get(url) ?? null

    const encodedUrl = encodeURIComponent(url)
    console.debug(`Fetching link preview for: ${url}`)
    if (!chatterinoBaseUrl.endsWith('/')) chatterinoBaseUrl += '/'
    const response = await fetch(chatterinoBaseUrl + encodedUrl)

    if (!response.ok) {
      console.warn(`Link preview failed for ${url}: HTTP ${response.status}`)
      return null
    }

    const data = await response.json()

    console.debug(`Link preview fetched for: ${url}`)

    const linkPreview: LinkPreview = {
      status: data.status || 200,
      thumbnail: data.thumbnail,
      tooltip: decodeURIComponent(data.tooltip || ''),
      link: data.link || url
    }

    linkPreviewCache.set(url, linkPreview)
    return linkPreview
  } catch (error) {
    console.warn('Failed to fetch link preview:', error)
    return null
  }
}

export function initLinks(): void {
  const ipcMain = electron.ipcMain

  ipcMain.handle('openUrl', async (_event, url: string) => {
    if (
      url &&
      typeof url === 'string' &&
      (url.startsWith('http://') || url.startsWith('https://'))
    ) {
      await shell.openExternal(url)
    } else {
      console.warn('Invalid URL provided to open-url handler:', url)
    }
  })

  ipcMain.handle('getLinkPreview', async (_event, ...args: Parameters<typeof getLinkPreview>) => {
    return await getLinkPreview(...args)
  })

  ipcMain.handle('sanitizeHtml', async (_event, html: string) => {
    return sanitizeHtml(html)
  })
}
