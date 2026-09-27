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

type LinkPreviewErrorCode = 'invalid_url' | 'http_error' | 'network_error'
class LinkPreviewError extends Error {
  constructor(
    public readonly code: LinkPreviewErrorCode,
    message: string,
    public readonly context?: unknown
  ) {
    super(message)
    this.name = 'LinkPreviewError'
  }
}

const defaultLinkPreviewUrl = 'https://chatterino.alb11747.com/link_resolver/'
const linkPreviewCacheTTL = 5 * 60 * 1000 // 5 minutes
const linkPreviewCache = new TTLCache<string, LinkPreview | null>({ ttl: linkPreviewCacheTTL })
const linkPreviewSeenParams = { capacity: 4096, errorRate: 0.0001, key: 'data:urlSeenSet' }
let urlSeenSet: ScalableBloomFilter | null = null
const linkPreviewOpenedParams = { capacity: 1024, errorRate: 0.0001, key: 'data:urlClickedSet' }
let urlOpenedSet: ScalableBloomFilter | null = null
let config: Conf | null = null
const lock = new AsyncLock()

async function getYouTubeTooltip(url: string): Promise<string | undefined> {
  const hostname = new URL(url).hostname.toLowerCase()
  if (hostname !== 'youtu.be' && hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com'))
    return undefined

  try {
    // The generic resolver omits the channel and may shorten YouTube text.
    // oEmbed supplies the full title and channel without an API key.
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(3000) }
    )
    if (!response.ok) return undefined
    const data = await response.json()
    if (typeof data.title !== 'string' || typeof data.author_name !== 'string') return undefined
    const escape = (text: string): string =>
      text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    return `<div><b>${escape(data.title)}</b><br>Channel: ${escape(data.author_name)}</div>`
  } catch (error) {
    console.debug('YouTube metadata unavailable; using resolver details:', error)
    return undefined
  }
}

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

export function clearLinkPreviewCache(): void {
  linkPreviewCache.clear()
}

export async function getLinkPreview(
  url: string,
  chatterinoBaseUrl: string = defaultLinkPreviewUrl,
  options: { refresh?: boolean } = {}
): Promise<LinkPreview | null> {
  return await lock.acquire(url, async () => {
    try {
      if (
        !url ||
        typeof url !== 'string' ||
        (!url.startsWith('http://') && !url.startsWith('https://'))
      ) {
        console.warn(
          new LinkPreviewError('invalid_url', 'Invalid URL provided to getLinkPreview', url)
        )
        return null
      }

      if (options.refresh) linkPreviewCache.delete(url)
      if (linkPreviewCache.has(url)) return linkPreviewCache.get(url) ?? null

      const encodedUrl = encodeURIComponent(url)
      console.debug(`Fetching link preview for: ${url}`)
      if (!chatterinoBaseUrl.endsWith('/')) chatterinoBaseUrl += '/'
      const response = await fetch(chatterinoBaseUrl + encodedUrl)

      if (!response.ok) {
        const error = new LinkPreviewError(
          'http_error',
          `Link preview failed for ${url}: HTTP ${response.status}`,
          { status: response.status }
        )
        console.warn(error)
        linkPreviewCache.set(url, null)
        return null
      }

      const data = await response.json()

      console.debug(`Link preview fetched for: ${url}`)

      const linkPreview: LinkPreview = {
        status: data.status || 200,
        thumbnail: data.thumbnail,
        tooltip: (await getYouTubeTooltip(url)) ?? decodeURIComponent(data.tooltip || ''),
        link: data.link || url
      }

      linkPreviewCache.set(url, linkPreview)
      return linkPreview
    } catch (error) {
      console.warn(
        new LinkPreviewError('network_error', 'Failed to fetch link preview', { url, error })
      )
      linkPreviewCache.set(url, null)
      return null
    }
  })
}

function getSavedBloomFilter(
  conf: Conf,
  params: { capacity: number; errorRate: number; key: string }
): ScalableBloomFilter {
  const data = conf.get(params.key, null) as JSON | null
  let filter: ScalableBloomFilter | null = null
  if (data) {
    try {
      filter = ScalableBloomFilter.fromJSON(data)
    } catch (error) {
      console.error(`Failed to restore bloom filter from key "${params.key}":`, error)
      conf.delete(params.key)
    }
  }
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
  ipcMain.handle('clearLinkPreviewCache', () => clearLinkPreviewCache())

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
