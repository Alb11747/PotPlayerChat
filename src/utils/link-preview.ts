import type {} from '@/preload/types/index.d.ts'

export interface LinkPreview {
  status: number
  thumbnail?: string
  tooltip?: string
  link: string
}

export class LinkPreviewService {
  private cache = new Map<string, LinkPreview>()
  private loadingUrls = new Set<string>()

  /**
   * Fetch link preview data for a URL
   */
  async getPreview(url: string): Promise<LinkPreview | null> {
    // Check cache first
    if (this.cache.has(url)) {
      return this.cache.get(url)!
    }

    // Avoid duplicate requests
    if (this.loadingUrls.has(url)) {
      return null
    }

    try {
      this.loadingUrls.add(url)

      // Use IPC to fetch from main process (avoids CORS)
      const data = await window.api.getLinkPreview(url)

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
  }

  /**
   * Check if a URL is currently being loaded
   */
  isLoading(url: string): boolean {
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

// Global instance
export const linkPreviewService = new LinkPreviewService()
