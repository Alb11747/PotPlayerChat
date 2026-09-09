import type {} from '@/types/preload'
import AsyncLock from 'async-lock'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

export interface LinkPreview {
  status: number
  thumbnail?: string
  tooltip?: string
  link: string
}

export class UrlTracker {
  private cache = new SvelteMap<string, LinkPreview>()
  private seenUrls = new SvelteSet<string>()
  private visitedUrls = new SvelteSet<string>()
  private loadingUrls = new SvelteSet<string>()
  private failedUrls = new SvelteSet<string>()
  private lock = new AsyncLock()
  private imageDimensions = new SvelteMap<string, { width: number; height: number }>()
  private generation = 0
  private cacheState = new SvelteMap([['version', 0]])

  get cacheVersion(): number {
    return this.cacheState.get('version') ?? 0
  }

  constructor(private settings: { chatterinoBaseUrl: string }) {}

  /**
   * Fetch link preview data for a URL
   */
  async getPreview(url: string, refresh = false): Promise<LinkPreview | null> {
    const generation = this.generation
    if (!refresh && this.cache.has(url)) return this.cache.get(url) ?? null
    if (!refresh && this.isFailedUrl(url)) return this.cache.get(url) ?? { status: 0, link: url }
    return await this.lock.acquire(url, async () => {
      if (generation !== this.generation) return null
      if (!refresh && this.cache.has(url)) return this.cache.get(url) ?? null
      if (!refresh && this.isFailedUrl(url)) return this.cache.get(url) ?? { status: 0, link: url }

      if (refresh) {
        this.cache.delete(url)
        this.failedUrls.delete(url)
      }
      this.loadingUrls.add(url)
      try {
        // Use IPC to fetch from main process (avoids CORS)
        const data = await window.api.getLinkPreview(url, this.settings.chatterinoBaseUrl, {
          refresh
        })
        if (generation !== this.generation) return null

        if (!data) {
          const errorResult: LinkPreview = { status: 0, link: url }
          this.markFailedUrl(url)
          this.cache.set(url, errorResult)
          return errorResult
        }

        // Cache the result
        this.cache.set(url, data)

        return data
      } catch (error) {
        if (generation !== this.generation) return null
        console.warn('Failed to fetch link preview:', error)
        // Cache null result to avoid repeated failed requests
        const errorResult: LinkPreview = { status: 0, link: url }
        this.markFailedUrl(url)
        this.cache.set(url, errorResult)
        return errorResult
      } finally {
        if (generation === this.generation) this.loadingUrls.delete(url)
      }
    })
  }

  /**
   * Check if a URL has cached preview or is currently loading
   */
  hasPreview(url: string): boolean {
    return this.cache.has(url) || this.loadingUrls.has(url)
  }

  /**
   * Check if a URL is currently being loaded
   */
  isPreviewLoading(url: string): boolean {
    return this.loadingUrls.has(url)
  }

  /**
   * Check if a URL has cached preview data
   */
  hasCachedPreview(url: string): boolean {
    return this.cache.has(url)
  }

  /**
   * Get cached preview without making a request
   */
  getCachedPreview(url: string): LinkPreview | null {
    return this.cache.get(url) || null
  }

  /**
   * Clear the preview cache
   */
  clearCache(): void {
    this.generation++
    this.cacheState.set('version', this.generation)
    this.cache.clear()
    this.failedUrls.clear()
    this.loadingUrls.clear()
    this.imageDimensions.clear()
  }

  getImageDimensions(url: string): { width: number; height: number } | undefined {
    return this.imageDimensions.get(url)
  }

  recordImageDimensions(url: string, image: HTMLImageElement): void {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
    const previous = this.imageDimensions.get(url)
    if (previous?.width === image.naturalWidth && previous.height === image.naturalHeight) return
    this.imageDimensions.set(url, { width: image.naturalWidth, height: image.naturalHeight })
  }

  /**
   * Check if a URL has failed to load
   */
  isFailedUrl(url: string): boolean {
    return this.failedUrls.has(url)
  }

  /**
   * Add a URL to the failed URLs set
   * This prevents repeated attempts to fetch previews for known bad URLs
   */
  markFailedUrl(url: string): void {
    this.failedUrls.add(url)
  }

  /**
   * Check if a URL has been seen
   */
  isSeenUrl(url: string): boolean {
    return this.seenUrls.has(url)
  }

  /**
   * Mark a URL as seen
   */
  async markSeenUrl(url: string): Promise<void> {
    try {
      await window.api.addUrlSeen(url)
      this.seenUrls.add(url)
    } catch (error) {
      console.error('Failed to persist seen URL:', error)
    }
  }

  /**
   * Clear the seen URL set
   */
  clearSeenUrls(): void {
    this.seenUrls.clear()
  }

  /**
   * Check if a URL has been visited
   */
  isVisitedUrl(url: string): boolean {
    return this.visitedUrls.has(url)
  }

  /**
   * Mark a URL as visited
   * This can be used to avoid fetching previews for already visited links
   */
  async markVisitedUrl(url: string): Promise<void> {
    this.visitedUrls.add(url)
    try {
      await window.api.addUrlClicked(url)
    } catch (error) {
      console.error('Failed to persist clicked URL:', error)
    }
  }

  /**
   * Clear the visited URL set
   */
  clearVisitedUrls(): void {
    this.visitedUrls.clear()
  }

  /**
   * Safely parse HTML tooltip content to plain text
   */
  static parseTooltipToText(tooltip: string): string {
    const parser = new DOMParser()
    const doc = parser.parseFromString(tooltip, 'text/html')
    let text = doc.body.innerText || doc.body.textContent || ''

    // Clean up extra whitespace but preserve intentional line breaks
    text = text.replace(/\n\s*\n/g, '\n').trim()

    return text
  }
}
