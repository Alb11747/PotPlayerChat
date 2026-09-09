import { describe, expect, it } from 'vitest'
import { TranscriptGeometry } from './transcript-geometry'

describe('transcript geometry', () => {
  it('finds the containing row, including the lower half of a tall final row', () => {
    const geometry = new TranscriptGeometry(['a', 'b', 'c'], [20, 30, 1000])
    expect(geometry.offsets).toEqual([0, 20, 50, 1050])
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
    expect(geometry.restore(null, 100)).toBe(0)
    expect(geometry.scrollOffset(0, {}, 100)).toBe(0)
    expect(geometry.visibleRange(10, 100)).toEqual({ start: 0, end: 0 })
  })

  it('normalizes invalid or missing heights while retaining fractional sizes', () => {
    const geometry = new TranscriptGeometry(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      [0, -10, NaN, Infinity, 0.5, 20.25]
    )
    expect(geometry.heights).toEqual([1, 1, 1, 1, 1, 20.25, 1])
    expect(geometry.total).toBe(26.25)
  })

  it('preserves row identity and its pixel offset across same-length replacements', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c'], [100, 150, 200])
    const anchor = original.capture(120)
    const shifted = new TranscriptGeometry(['b', 'c', 'd'], [150, 200, 100])
    expect(shifted.restore(anchor, 100)).toBe(20)
    const reordered = new TranscriptGeometry(['c', 'b', 'a'], [200, 150, 100])
    expect(reordered.restore(anchor, 100)).toBe(220)
  })

  it('keeps the successor in its former viewport position when the anchor is deleted', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const anchor = original.capture(120)
    const replacement = new TranscriptGeometry(['a', 'c', 'd'], [100, 100, 100])
    // c was 80px below the viewport top and must stay there. Both a and c
    // survive at distance one; selecting a would incorrectly restore to 120px.
    expect(replacement.restore(anchor, 50)).toBe(20)
  })

  it('uses the nearest preceding survivor when no successor survives', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c', 'd'], [100, 100, 100, 100])
    const replacement = new TranscriptGeometry(['x', 'a', 'b', 'y'], [200, 100, 100, 300])
    expect(replacement.restore(original.capture(220), 20)).toBe(420)
  })

  it('clamps restoration after shrinking and retains a bounded offset if all keys disappear', () => {
    const original = new TranscriptGeometry(['a', 'b', 'c'], [100, 100, 100])
    const anchor = original.capture(180)
    expect(new TranscriptGeometry(['a', 'b'], [100, 100]).restore(anchor, 100)).toBe(100)
    expect(new TranscriptGeometry(['x'], [50]).restore(anchor, 100)).toBe(0)
    expect(new TranscriptGeometry(['x'], [500]).restore(anchor, 100)).toBe(180)
  })

  it('captures an immutable snapshot of the caller-provided layout arrays', () => {
    const keys = ['a', 'b']
    const heights = [100, 200]
    const original = new TranscriptGeometry(keys, heights)
    const anchor = original.capture(110)
    keys[1] = 'changed'
    heights[0] = 200
    expect(new TranscriptGeometry(['b', 'c'], [200, 200]).restore(anchor, 100)).toBe(10)
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
})
