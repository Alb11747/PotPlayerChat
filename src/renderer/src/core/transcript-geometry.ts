export interface TranscriptAnchor {
  key: string
  offset: number
  index: number
  previousKeys: readonly string[]
  previousOffsets: readonly number[]
}

export interface TranscriptScrollOptions {
  align?: 'start' | 'center' | 'end'
  offset?: number
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export class TranscriptGeometry {
  readonly keys: readonly string[]
  readonly heights: readonly number[]
  readonly offsets: readonly number[]
  readonly total: number
  private readonly indices: Map<string, number>

  constructor(keys: readonly string[], heights: readonly number[]) {
    this.keys = [...keys]
    this.heights = keys.map((_, index) => {
      const height = heights[index]
      return height !== undefined && Number.isFinite(height) ? Math.max(1, height) : 1
    })
    const offsets = [0]
    for (const height of this.heights) offsets.push(offsets[offsets.length - 1]! + height)
    this.offsets = offsets
    this.total = offsets[offsets.length - 1]!
    this.indices = new Map(this.keys.map((key, index) => [key, index]))
  }

  private clamp(offset: number, viewport: number): number {
    return Math.min(nonnegative(offset), Math.max(0, this.total - nonnegative(viewport)))
  }

  indexOf(key: string): number {
    return this.indices.get(key) ?? -1
  }

  indexAt(offset: number): number {
    if (this.keys.length === 0) return -1
    const position = nonnegative(offset)
    let left = 0
    let right = this.keys.length - 1
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (this.offsets[middle + 1]! <= position) left = middle + 1
      else right = middle
    }
    return left
  }

  visibleRange(
    scrollTop: number,
    viewport: number,
    overscan = viewport
  ): { start: number; end: number } {
    if (this.keys.length === 0) return { start: 0, end: 0 }
    const top = this.clamp(scrollTop, viewport)
    const extra = nonnegative(overscan)
    const start = this.indexAt(Math.max(0, top - extra))
    const bottom = Math.min(this.total, top + nonnegative(viewport) + extra)
    if (bottom <= this.offsets[start]!) return { start, end: start }
    let left = start + 1
    let right = this.keys.length
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (this.offsets[middle]! < bottom) left = middle + 1
      else right = middle
    }
    return { start, end: left }
  }

  capture(scrollTop: number): TranscriptAnchor | null {
    const index = this.indexAt(scrollTop)
    if (index < 0) return null
    return {
      key: this.keys[index]!,
      offset: nonnegative(scrollTop) - this.offsets[index]!,
      index,
      previousKeys: this.keys,
      previousOffsets: this.offsets
    }
  }

  restore(anchor: TranscriptAnchor | null, viewport: number): number {
    if (!anchor || this.keys.length === 0) return 0
    const index = this.indices.get(anchor.key)
    if (index !== undefined) return this.clamp(this.offsets[index]! + anchor.offset, viewport)

    // A rolling window may remove the anchor. Preserve the nearest surviving
    // row's former viewport coordinate, rather than moving it into the anchor's place.
    const oldScrollTop = anchor.previousOffsets[anchor.index]! + anchor.offset
    for (let distance = 1; distance < anchor.previousKeys.length; distance++) {
      for (const previousIndex of [anchor.index + distance, anchor.index - distance]) {
        const key = anchor.previousKeys[previousIndex]
        if (key === undefined) continue
        const nextIndex = this.indices.get(key)
        if (nextIndex === undefined) continue
        return this.clamp(
          this.offsets[nextIndex]! - anchor.previousOffsets[previousIndex]! + oldScrollTop,
          viewport
        )
      }
    }
    return this.clamp(oldScrollTop, viewport)
  }

  scrollOffset(index: number, options: TranscriptScrollOptions, viewport: number): number {
    if (this.keys.length === 0) return 0
    const target = Math.min(Math.floor(nonnegative(index)), this.keys.length - 1)
    const available = nonnegative(viewport)
    let offset = this.offsets[target]!
    if (options.align === 'center') offset += (this.heights[target]! - available) / 2
    else if (options.align === 'end') offset += this.heights[target]! - available
    if (options.offset !== undefined && Number.isFinite(options.offset)) offset += options.offset
    return this.clamp(offset, available)
  }
}
