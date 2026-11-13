import { CooperativeWork } from '@/utils/cooperative-work'

export interface TranscriptAnchor {
  key: string
  offset: number
  index: number
  previousGeometry: TranscriptGeometry
}

export interface TranscriptScrollOptions {
  align?: 'start' | 'center' | 'end'
  offset?: number
}

interface SumNode {
  readonly count: number
  readonly total: number
  readonly left?: SumNode
  readonly right?: SumNode
  readonly heights?: Float64Array
}

interface GeometryState {
  readonly keys: readonly string[]
  readonly indices: ReadonlyMap<string, number>
  readonly root: SumNode | undefined
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizedHeight(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, value) : 1
}

function join(left: SumNode, right: SumNode): SumNode {
  return { count: left.count + right.count, total: left.total + right.total, left, right }
}

const LEAF_SIZE = 64

function append(stack: SumNode[], values: readonly number[]): void {
  const heights = Float64Array.from(values)
  let total = 0
  for (const height of heights) total += height
  let node: SumNode = { count: heights.length, total, heights }
  while (stack.length && stack[stack.length - 1]!.count === node.count)
    node = join(stack.pop()!, node)
  stack.push(node)
}

function finish(stack: SumNode[]): SumNode | undefined {
  let root = stack.pop()
  while (stack.length) root = join(stack.pop()!, root!)
  return root
}

function update(node: SumNode, index: number, height: number): SumNode {
  if (node.heights) {
    if (node.heights[index] === height) return node
    const heights = node.heights.slice()
    heights[index] = height
    let total = 0
    for (const value of heights) total += value
    return { count: heights.length, total, heights }
  }
  const leftNode = node.left!
  const rightNode = node.right!
  const left = index < leftNode.count ? update(leftNode, index, height) : leftNode
  const right =
    index >= leftNode.count ? update(rightNode, index - leftNode.count, height) : rightNode
  return left === leftNode && right === rightNode ? node : join(left, right)
}

/**
 * Immutable prefix sums: updates copy the affected paths and small height blocks.
 * Typed-array leaves avoid allocating a pair of JavaScript tree nodes per message.
 */
export class TranscriptGeometry {
  private state: GeometryState

  constructor(keys: readonly string[], heights: readonly number[]) {
    const ownedKeys = [...keys]
    const indices = new Map<string, number>()
    const stack: SumNode[] = []
    let block: number[] = []
    for (let index = 0; index < ownedKeys.length; index++) {
      indices.set(ownedKeys[index]!, index)
      block.push(normalizedHeight(heights[index]))
      if (block.length === LEAF_SIZE) {
        append(stack, block)
        block = []
      }
    }
    if (block.length) append(stack, block)
    this.state = { keys: ownedKeys, indices, root: finish(stack) }
  }

  private static fromState(state: GeometryState): TranscriptGeometry {
    const geometry: TranscriptGeometry = Object.create(TranscriptGeometry.prototype)
    geometry.state = state
    return geometry
  }

  /** Build keys, lookup and sums together without blocking on a whole-history pass. */
  static async create<T>(
    data: readonly T[],
    getKey: (item: T, index: number) => string,
    getHeight: (item: T, index: number) => number,
    signal?: AbortSignal
  ): Promise<TranscriptGeometry> {
    const work = new CooperativeWork(signal)
    const keys: string[] = []
    const indices = new Map<string, number>()
    const stack: SumNode[] = []
    let block: number[] = []
    for (let index = 0; index < data.length; index++) {
      const item = data[index]!
      const key = getKey(item, index)
      keys.push(key)
      indices.set(key, index)
      block.push(normalizedHeight(getHeight(item, index)))
      if (block.length === LEAF_SIZE) {
        append(stack, block)
        block = []
      }
      const pause = work.checkpoint()
      if (pause) await pause
    }
    work.throwIfAborted()
    if (block.length) append(stack, block)
    return TranscriptGeometry.fromState({ keys, indices, root: finish(stack) })
  }

  get keys(): readonly string[] {
    return this.state.keys
  }

  get total(): number {
    return this.state.root?.total ?? 0
  }

  /** Prefix height before index; the exclusive end returns the full height. */
  offsetAt(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > this.keys.length) return 0
    let node = this.state.root
    let remaining = index
    let sum = 0
    while (node && remaining > 0) {
      if (remaining >= node.count) return sum + node.total
      if (node.heights) {
        for (let index = 0; index < remaining; index++) sum += node.heights[index]!
        return sum
      }
      if (!node.left || !node.right) break
      if (remaining < node.left.count) node = node.left
      else {
        sum += node.left.total
        remaining -= node.left.count
        node = node.right
      }
    }
    return sum
  }

  heightAt(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.keys.length) return 0
    let node = this.state.root!
    let remaining = index
    while (node.left && node.right) {
      if (remaining < node.left.count) node = node.left
      else {
        remaining -= node.left.count
        node = node.right
      }
    }
    return node.heights![remaining]!
  }

  withHeights(changes: Iterable<readonly [number, number]>): TranscriptGeometry {
    let root = this.state.root
    if (!root) return this
    for (const [index, height] of changes) {
      if (!Number.isInteger(index) || index < 0 || index >= this.keys.length) continue
      root = update(root, index, normalizedHeight(height))
    }
    return root === this.state.root ? this : TranscriptGeometry.fromState({ ...this.state, root })
  }

  private clamp(offset: number, viewport: number): number {
    return Math.min(nonnegative(offset), Math.max(0, this.total - nonnegative(viewport)))
  }

  indexOf(key: string): number {
    return this.state.indices.get(key) ?? -1
  }

  indexAt(offset: number): number {
    if (!this.state.root) return -1
    const position = nonnegative(offset)
    let node = this.state.root
    let index = 0
    let top = 0
    while (node.left && node.right) {
      if (position < top + node.left.total) node = node.left
      else {
        top += node.left.total
        index += node.left.count
        node = node.right
      }
    }
    const heights = node.heights!
    let leafIndex = 0
    while (leafIndex < heights.length - 1 && position >= top + heights[leafIndex]!)
      top += heights[leafIndex++]!
    return index + leafIndex
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
    if (bottom <= this.offsetAt(start)) return { start, end: start }
    const containing = this.indexAt(bottom)
    return { start, end: this.offsetAt(containing) < bottom ? containing + 1 : containing }
  }

  capture(scrollTop: number): TranscriptAnchor | null {
    const index = this.indexAt(scrollTop)
    if (index < 0) return null
    return {
      key: this.keys[index]!,
      offset: nonnegative(scrollTop) - this.offsetAt(index),
      index,
      previousGeometry: this
    }
  }

  /**
   * Find where a saved reading position lives in this geometry, as a row and the
   * distance its top sits above the viewport top. A rolling window may remove
   * the anchor; the nearest surviving row then stands in for it, keeping its
   * former viewport coordinate from the immutable original geometry.
   */
  locate(anchor: TranscriptAnchor | null): { index: number; offset: number } | null {
    if (!anchor || this.keys.length === 0) return null
    const index = this.state.indices.get(anchor.key)
    if (index !== undefined) return { index, offset: anchor.offset }
    const previous = anchor.previousGeometry
    const oldScrollTop = previous.offsetAt(anchor.index) + anchor.offset
    for (let distance = 1; distance < previous.keys.length; distance++) {
      for (const previousIndex of [anchor.index + distance, anchor.index - distance]) {
        const key = previous.keys[previousIndex]
        if (key === undefined) continue
        const nextIndex = this.state.indices.get(key)
        if (nextIndex === undefined) continue
        return { index: nextIndex, offset: oldScrollTop - previous.offsetAt(previousIndex) }
      }
    }
    return null
  }

  scrollOffset(index: number, options: TranscriptScrollOptions, viewport: number): number {
    if (this.keys.length === 0) return 0
    const target = Math.min(Math.floor(nonnegative(index)), this.keys.length - 1)
    const available = nonnegative(viewport)
    let offset = this.offsetAt(target)
    if (options.align === 'center') offset += (this.heightAt(target) - available) / 2
    else if (options.align === 'end') offset += this.heightAt(target) - available
    if (options.offset !== undefined && Number.isFinite(options.offset)) offset += options.offset
    return this.clamp(offset, available)
  }
}
