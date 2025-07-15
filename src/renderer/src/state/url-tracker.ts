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
  private visitedUrls = new SvelteSet<string>()
  private loadingUrls = new SvelteSet<string>()
  private failedUrls = new SvelteSet<string>()
  private lock = new AsyncLock()

  constructor(private settings: { chatterinoBaseUrl: string }) {}

  /**
   * Fetch link preview data for a URL
   */
  async getPreview(url: string): Promise<LinkPreview | null> {
    if (this.cache.has(url)) return this.cache.get(url) ?? null
    return await this.lock.acquire(url, async () => {
      if (this.cache.has(url)) return this.cache.get(url) ?? null

      try {
        this.loadingUrls.add(url)

        // Use IPC to fetch from main process (avoids CORS)
        const data = await window.api.getLinkPreview(url, this.settings.chatterinoBaseUrl)

        if (!data) {
          const errorResult: LinkPreview = { status: 0, link: url }
          this.cache.set(url, errorResult)
          return errorResult
        }

        // Cache the result
        this.cache.set(url, data)
        return data
      } catch (error) {
        console.warn('Failed to fetch link preview:', error)
        // Cache null result to avoid repeated failed requests
        const errorResult: LinkPreview = { status: 0, link: url }
        this.cache.set(url, errorResult)
        return errorResult
      } finally {
        this.loadingUrls.delete(url)
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
    this.cache.clear()
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
   * Check if a URL has been visited
   */
  isVisitedUrl(url: string): boolean {
    return this.visitedUrls.has(url)
  }

  /**
   * Mark a URL as visited
   * This can be used to avoid fetching previews for already visited links
   */
  markVisitedUrl(url: string): void {
    this.visitedUrls.add(url)
  }

  /**
   * Safely parse HTML tooltip content to plain text
   */
  static parseTooltipToText(tooltip: string): string {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = tooltip

    // Extract text content and preserve line breaks
    let text = tempDiv.textContent || tempDiv.innerText || ''

    // Clean up extra whitespace but preserve intentional line breaks
    text = text.replace(/\n\s*\n/g, '\n').trim()

    return text
  }
}
