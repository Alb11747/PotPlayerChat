import TTLCache from '@isaacs/ttlcache'
import AsyncLock from 'async-lock'
import { ScalableBloomFilter } from 'bloom-filters'
import electron, { shell } from 'electron'
import type { Conf } from 'electron-conf/main'
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
const linkPreviewSeenParams = { capacity: 4096, errorRate: 2 ** -256, key: 'data:urlSeenSet' }
let urlSeenSet: ScalableBloomFilter | null = null
const linkPreviewOpenedParams = { capacity: 1024, errorRate: 2 ** -256, key: 'data:urlClickedSet' }
let urlOpenedSet: ScalableBloomFilter | null = null
let config: Conf | null = null
const lock = new AsyncLock()

export function isUrlSeen(url: string): boolean {
  return urlSeenSet?.has(url) ?? false
}
export function addUrlSeen(url: string): void {
  if (!urlSeenSet) return
  urlSeenSet.add(url)
  config?.set(linkPreviewSeenParams.key, urlSeenSet.saveAsJSON())
}
export function clearUrlSeen(): void {
  urlSeenSet = new ScalableBloomFilter(
    linkPreviewSeenParams.capacity,
    linkPreviewSeenParams.errorRate
  )
  config?.set(linkPreviewSeenParams.key, urlSeenSet.saveAsJSON())
}

export function isUrlClicked(url: string): boolean {
  return urlOpenedSet?.has(url) ?? false
}
export function addUrlClicked(url: string): void {
  if (!urlOpenedSet) return
  urlOpenedSet.add(url)
  config?.set(linkPreviewOpenedParams.key, urlOpenedSet.saveAsJSON())
}
export function clearUrlClicked(): void {
  urlOpenedSet = new ScalableBloomFilter(
    linkPreviewOpenedParams.capacity,
    linkPreviewOpenedParams.errorRate
  )
  config?.set(linkPreviewOpenedParams.key, urlOpenedSet.saveAsJSON())
}

export async function getLinkPreview(
  url: string,
  chatterinoBaseUrl: string = defaultLinkPreviewUrl
): Promise<LinkPreview | null> {
  return await lock.acquire(url, async () => {
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
  })
}

function getSavedBloomFilter(
  conf: Conf,
  params: { capacity: number; errorRate: number; key: string }
): ScalableBloomFilter {
  const data = conf.get(params.key, null) as JSON | null
  const filter = data ? ScalableBloomFilter.fromJSON(data) : null
  if (filter && filter.capacity() >= params.capacity && filter.rate() <= params.errorRate)
    return filter
  return new ScalableBloomFilter(params.capacity, params.errorRate)
}

export function initLinks(conf: Conf): void {
  const ipcMain = electron.ipcMain
  config = conf

  urlSeenSet = getSavedBloomFilter(conf, linkPreviewSeenParams)
  urlOpenedSet = getSavedBloomFilter(conf, linkPreviewOpenedParams)

  ipcMain.handle('isUrlSeen', (_event, url: string) => isUrlSeen(url))
  ipcMain.handle('addUrlSeen', (_event, url: string) => addUrlSeen(url))
  ipcMain.handle('clearUrlSeen', () => clearUrlSeen())
  ipcMain.handle('isUrlClicked', (_event, url: string) => isUrlClicked(url))
  ipcMain.handle('addUrlClicked', (_event, url: string) => addUrlClicked(url))
  ipcMain.handle('clearUrlClicked', () => clearUrlClicked())

  ipcMain.handle('getLinkPreview', (_event, ...args: Parameters<typeof getLinkPreview>) =>
    getLinkPreview(...args)
  )
  ipcMain.handle('clearLinkPreviewCache', () => linkPreviewCache.clear())

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

  ipcMain.handle('sanitizeHtml', (_event, html: string) => sanitizeHtml(html))
}
