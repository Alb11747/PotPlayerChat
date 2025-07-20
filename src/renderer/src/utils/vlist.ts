import bounds from 'binary-searching'
import type { VList } from 'virtua/svelte'

// Assumes messages are sorted by timestamp ascending
const cmp = <T extends { timestamp: number }>(a: T, b: T): number => a.timestamp - b.timestamp

export function calculateTargetElement<T extends { getId: () => string; timestamp: number }>(
  vlist: VList<T> | null | undefined,
  messages: T[] | null | undefined
): { targetElement: T | null; targetViewportOffset: number } {
  if (!vlist || !messages || messages.length === 0)
    return { targetElement: null, targetViewportOffset: 0 }

  const scrollOffset = vlist.getScrollOffset()
  const viewportSize = vlist.getViewportSize()
  const center = scrollOffset + viewportSize / 2

  // Binary search for the first message where itemOffset + itemSize / 2 >= center
  let left = 0
  let right = messages.length - 1
  let resultIdx = -1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const itemOffset = vlist.getItemOffset(mid)
    const itemSize = vlist.getItemSize(mid)
    if (itemOffset + itemSize / 2 >= center) {
      resultIdx = mid
      right = mid - 1
    } else {
      left = mid + 1
    }
  }

  return resultIdx >= 0
    ? {
        targetElement: messages[resultIdx]!,
        targetViewportOffset: vlist.getItemOffset!(resultIdx) - scrollOffset
      }
    : { targetElement: null, targetViewportOffset: 0 }
}

export function scrollToTarget<T extends { getId: () => string; timestamp: number }>(
  vlist: VList<T> | null | undefined,
  messages: T[] | null | undefined,
  {
    targetElement = null,
    targetViewportOffset = 0,
    scrollToBottom = false
  }: { targetElement: T | null; targetViewportOffset: number; scrollToBottom: boolean }
): void {
  if (!vlist || !messages) return

  if (scrollToBottom) {
    vlist.scrollToIndex(messages.length - 1, { smooth: false, align: 'end' })
  } else if (targetElement) {
    const targetId = targetElement.getId()

    // Binary search for timestamp, then linear search for id
    const idx = bounds.ge(messages, { timestamp: targetElement.timestamp } as T, cmp)

    let targetIndex = -1
    for (
      let i = idx;
      i < messages.length && messages[i]!.timestamp === targetElement.timestamp;
      i++
    ) {
      if (messages[i]!.getId() === targetId) {
        targetIndex = i
        break
      }
    }
    if (targetIndex === -1) return

    vlist.scrollToIndex(targetIndex, { offset: -targetViewportOffset, smooth: false })
  }
}
