import { describe, expect, it } from 'vitest'
import { TranscriptGeometry, type TranscriptAnchor } from './transcript-geometry'

/** The scroll offset that puts a saved reading position back, or null when no row survives. */
function restore(geometry: TranscriptGeometry, anchor: TranscriptAnchor | null): number | null {
  const located = geometry.locate(anchor)
  return located && geometry.offsetAt(located.index) + located.offset
}

describe('transcript geometry', () => {
  it('finds the containing row, including the lower half of a tall final row', () => {
    const geometry = new TranscriptGeometry(['a', 'b', 'c'], [20, 30, 1000])
    expect(
      Array.from({ length: geometry.keys.length + 1 }, (_, index) => geometry.offsetAt(index))
    ).toEqual([0, 20, 50, 1050])
    expect(geometry.indexAt(-20)).toBe(0)
    expect(geometry.indexAt(20)).toBe(1)
    expect(geometry.indexAt(900)).toBe(2)
    expect(geometry.indexAt(2000)).toBe(2)
    expect(geometry.capture(900)).toMatchObject({ key: 'c', offset: 850, index: 2 })
  })

  it('handles empty transcripts without invalid indices or offsets', () => {
    const geometry = new TranscriptGeometry([], [])
    expect(geometry.total).toBe(0)
    expect(geometry.indexAt(10)).toBe(-1)
    expect(geometry.capture(10)).toBeNull()
    expect(geometry.locate(null)).toBeNull()
    expect(geometry.scrollOffset(0, {}, 100)).toBe(0)
    expect(geometry.visibleRange(10, 100)).toEqual({ start: 0, end: 0 })
  })

  it('normalizes invalid or missing heights while retaining fractional sizes', () => {
    const geometry = new TranscriptGeometry(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      [0, -10, NaN, Infinity, 0.5, 20.25]
    )
    expect(
      Array.from({ length: geometry.keys.length }, (_, index) => geometry.heightAt(index))
    ).toEqual([1, 1, 1, 1, 1, 20.25, 1])
    expect(geometry.total).toBe(26.25)
  })

  it('preserves row identity and its pixel offset across same-length replacements', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c'], [100, 150, 200])
    const anchor = original.capture(120)
    const shifted = new TranscriptGeometry(['b', 'c', 'd'], [150, 200, 100])
    expect(restore(shifted, anchor)).toBe(20)
    const reordered = new TranscriptGeometry(['c', 'b', 'a'], [200, 150, 100])
    expect(restore(reordered, anchor)).toBe(220)
  })

  it('keeps the successor in its former viewport position when the anchor is deleted', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const anchor = original.capture(120)
    const replacement = new TranscriptGeometry(['a', 'c', 'd'], [100, 100, 100])
    // c was 80px below the viewport top and must stay there. Both a and c
    // survive at distance one; selecting a would incorrectly restore to 120px.
    expect(restore(replacement, anchor)).toBe(20)
  })

  it('uses the nearest preceding survivor when no successor survives', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const replacement = new TranscriptGeometry(['x', 'a', 'b', 'y'], [200, 100, 100, 300])
    expect(restore(replacement, original.capture(220))).toBe(420)
  })

  it('keeps the offset on a surviving row and reports no position if all keys disappear', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c'], [100, 100, 100])
    const anchor = original.capture(180)
    expect(restore(new TranscriptGeometry(['a', 'b'], [100, 100]), anchor)).toBe(180)
    expect(restore(new TranscriptGeometry(['x'], [50]), anchor)).toBeNull()
  })

  it('captures an immutable snapshot of the caller-provided layout arrays', () => {
    const keys = ['a', 'b']
    const heights = [100, 200]
    const original = new TranscriptGeometry(keys, heights)
    const anchor = original.capture(110)
    keys[1] = 'changed'
    heights[0] = 200
    expect(restore(new TranscriptGeometry(['b', 'c'], [200, 200]), anchor)).toBe(10)
  })

  it('returns only intersecting rows with an exclusive end and bounded overscan', () => {
    const geometry = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    expect(geometry.visibleRange(100, 100, 0)).toEqual({ start: 1, end: 2 })
    expect(geometry.visibleRange(100, 100)).toEqual({ start: 0, end: 3 })
    expect(geometry.visibleRange(290, 100, 20)).toEqual({ start: 2, end: 4 })
    expect(geometry.visibleRange(100, 0, 0)).toEqual({ start: 1, end: 1 })
  })

  it('aligns navigation and applies signed offsets before clamping to the scrollable extent', () => {
    const geometry = new TranscriptGeometry(['a', 'b', 'c'], [100, 200, 300])
    expect(geometry.scrollOffset(1, {}, 100)).toBe(100)
    expect(geometry.scrollOffset(1, { align: 'center' }, 100)).toBe(150)
    expect(geometry.scrollOffset(1, { align: 'end' }, 100)).toBe(200)
    expect(geometry.scrollOffset(1, { offset: -20 }, 100)).toBe(80)
    expect(geometry.scrollOffset(2, { align: 'end' }, 100)).toBe(500)
    expect(geometry.scrollOffset(20, { offset: 1000 }, 100)).toBe(500)
  })
  it('updates fractional row heights without changing an earlier geometry or its removed anchor', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const anchor = original.capture(120)
    const updated = original.withHeights(
      new Map([
        [0, 175.25],
        [2, 125.5]
      ])
    )
    expect(updated.keys).toBe(original.keys)
    expect(original.offsetAt(2)).toBe(200)
    expect(updated.offsetAt(2)).toBe(275.25)
    expect(updated.heightAt(2)).toBe(125.5)
    expect(updated.total).toBe(500.75)
    expect(restore(new TranscriptGeometry(['a', 'c', 'd'], [100, 100, 100]), anchor)).toBe(20)
    expect(updated.withHeights(new Map([[0, 175.25]]))).toBe(updated)
  })

  it('matches a simple prefix-sum model across deterministic batches and query boundaries', () => {
    let seed = 123456
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const keys = Array.from({ length: 257 }, (_, index) => `row-${index}`)
    const heights = keys.map(() => 1 + Math.floor(random() * 10000) / 4)
    let geometry = new TranscriptGeometry(keys, heights)
    for (let batch = 0; batch < 30; batch++) {
      const changes = new Map<number, number>()
      for (let row = 0; row < 17; row++) {
        const index = Math.floor(random() * keys.length)
        const height = 1 + Math.floor(random() * 10000) / 4
        changes.set(index, height)
        heights[index] = height
      }
      geometry = geometry.withHeights(changes)
      let offset = 0
      for (let index = 0; index < keys.length; index++) {
        expect(geometry.offsetAt(index)).toBe(offset)
        expect(geometry.heightAt(index)).toBe(heights[index])
        expect(geometry.indexOf(keys[index]!)).toBe(index)
        expect(geometry.indexAt(offset)).toBe(index)
        expect(geometry.indexAt(offset + heights[index]! - 0.125)).toBe(index)
        offset += heights[index]!
      }
      expect(geometry.offsetAt(keys.length)).toBe(offset)
      expect(geometry.total).toBe(offset)
      expect(geometry.visibleRange(0, offset, 0)).toEqual({ start: 0, end: keys.length })
    }
  })

  it('ignores invalid update indices and normalizes updated heights', () => {
    const geometry = new TranscriptGeometry(['a', 'b', 'c'], [10, 20, 30])
    const updated = geometry.withHeights(
      new Map([
        [-1, 999],
        [3, 999],
        [0.5, 999],
        [0, NaN],
        [1, -5]
      ])
    )
    expect(updated.total).toBe(32)
    expect(updated.heightAt(0)).toBe(1)
    expect(updated.heightAt(1)).toBe(1)
    expect(updated.offsetAt(-1)).toBe(0)
    expect(updated.heightAt(3)).toBe(0)
    expect(new TranscriptGeometry([], []).withHeights(new Map([[0, 20]])).total).toBe(0)
  })

  it('cooperatively constructs the same geometry and retains no mutable source keys', async () => {
    const rows = Array.from({ length: 2049 }, (_, index) => ({
      key: `row-${index}`,
      height: 20.25 + index
    }))
    const geometry = await TranscriptGeometry.create(
      rows,
      (row) => row.key,
      (row) => row.height
    )
    const reference = new TranscriptGeometry(
      rows.map((row) => row.key),
      rows.map((row) => row.height)
    )
    rows[0]!.key = 'changed'
    rows[0]!.height = 500
    expect(geometry.keys[0]).toBe('row-0')
    expect(geometry.total).toBe(reference.total)
    for (let index = 0; index < rows.length; index++) {
      expect(geometry.offsetAt(index)).toBe(reference.offsetAt(index))
      expect(geometry.heightAt(index)).toBe(reference.heightAt(index))
    }
  })

  it('cancels preparation before publishing a partial layout', async () => {
    const controller = new AbortController()
    const reason = new Error('replacement superseded')
    const rows = Array.from({ length: 2000 }, (_, index) => index)
    await expect(
      TranscriptGeometry.create(
        rows,
        String,
        (index) => {
          if (index === 20) controller.abort(reason)
          return 30
        },
        controller.signal
      )
    ).rejects.toBe(reason)
  })
  it.each([1, 63, 64, 65, 127, 128, 129, 2049])(
    'preserves every row boundary and immutable updates across a %i-row tree',
    async (count) => {
      const keys = Array.from({ length: count }, (_, index) => `row-${index}`)
      const heights = keys.map((_, index) => 23.1 + (index % 7) * 0.3)
      const original = new TranscriptGeometry(keys, heights)
      const updated = original.withHeights(
        heights.map((height, index) => [index, height + 11.2] as const)
      )
      const cooperative = await TranscriptGeometry.create(
        keys,
        (key) => key,
        (_, index) => heights[index]! + 11.2
      )
      for (let index = 0; index < count; index++) {
        expect(original.heightAt(index)).toBe(heights[index])
        expect(updated.heightAt(index)).toBe(heights[index]! + 11.2)
        expect(updated.offsetAt(index)).toBe(cooperative.offsetAt(index))
        expect(updated.indexAt(updated.offsetAt(index))).toBe(index)
        expect(updated.indexAt(updated.offsetAt(index) + 0.01)).toBe(index)
        if (index > 0) expect(updated.indexAt(updated.offsetAt(index) - 0.01)).toBe(index - 1)
      }
      expect(updated.total).toBe(cooperative.total)
      expect(updated.indexAt(updated.total)).toBe(count - 1)
    }
  )

  it('locates a saved position on its own row or the nearest surviving neighbour', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const anchor = original.capture(120)
    expect(original.locate(anchor)).toEqual({ index: 1, offset: 20 })
    // Rows above may change; the position stays relative to its own row.
    expect(new TranscriptGeometry(['x', 'b', 'c'], [300, 50, 50]).locate(anchor)).toEqual({
      index: 1,
      offset: 20
    })
    // With b removed, c stood 80px below the viewport top.
    expect(new TranscriptGeometry(['a', 'c', 'd'], [100, 100, 100]).locate(anchor)).toEqual({
      index: 1,
      offset: -80
    })
    expect(new TranscriptGeometry(['x', 'y'], [10, 10]).locate(anchor)).toBeNull()
    expect(original.locate(null)).toBeNull()
  })
})
