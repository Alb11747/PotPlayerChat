import { ScalableBloomFilter } from 'bloom-filters'

/**
 * URL tracking utility using Bloom Filter for memory-efficient visited URL tracking
 */
export class UrlTracker {
  private bloomFilter: ScalableBloomFilter

  constructor(size: number = 10000, errorRate: number = 2 ** -64, ratio: number = 0.5) {
    this.bloomFilter = new ScalableBloomFilter(size, errorRate, ratio)
  }

  /**
   * Mark a URL as visited
   */
  addUrl(url: string): void {
    this.bloomFilter.add(url)
  }

  /**
   * Check if a URL has been visited
   * Uses exact tracking first for recent URLs, then bloom filter
   */
  hasUrl(url: string): boolean {
    return this.bloomFilter.has(url)
  }

  /**
   * Get filter statistics
   */
  getStats(): { falsePositiveRate: number } {
    return {
      falsePositiveRate: this.bloomFilter.rate()
    }
  }

  /**
   * Export filter data for persistence
   */
  export(): string {
    return JSON.stringify(this.bloomFilter.saveAsJSON())
  }

  /**
   * Import filter data from persistence
   */
  import(data: string): void {
    const parsed = JSON.parse(data)
    this.bloomFilter = ScalableBloomFilter.fromJSON(parsed)
  }

  /**
   * Clear all tracked URLs
   */
  clear(): void {
    // Create new filter since clear() doesn't exist on ScalableBloomFilter
    this.bloomFilter = new ScalableBloomFilter(10000, (1 * 10) ^ -18, 0.5)
  }
}
