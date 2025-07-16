import type { VList } from 'virtua/svelte'

export function calculateTargetElement<T extends { getId: () => string }>(
  vlist?: VList<T>,
  messages?: T[]
): { targetElement: T | null; targetViewportOffset: number } {
  if (!vlist || !messages) return { targetElement: null, targetViewportOffset: 0 }

  for (let i = 0; i < messages.length; i++) {
    const itemOffset = vlist.getItemOffset(i)
    const itemSize = vlist.getItemSize(i)
    const scrollOffset = vlist.getScrollOffset()
    const viewportSize = vlist.getViewportSize()
    if (itemOffset + itemSize / 2 >= scrollOffset + viewportSize / 2) {
      return {
        targetElement: messages[i]!,
        targetViewportOffset: itemOffset - scrollOffset
      }
    }
  }

  return { targetElement: null, targetViewportOffset: 0 }
}

export function scrollToTarget<T extends { getId: () => string }>(
  vlist: VList<T>,
  messages: T[],
  {
    targetElement = null,
    targetViewportOffset = 0,
    scrollToBottom = false
  }: { targetElement: T | null; targetViewportOffset: number; scrollToBottom: boolean }
): void {
  if (!vlist) return

  if (scrollToBottom) {
    vlist.scrollToIndex(messages.length - 1, { smooth: false, align: 'end' })
  } else if (targetElement) {
    const targetId = targetElement.getId()
    const targetIndex = messages.findIndex((m) => m.getId() === targetId)
    if (targetIndex === -1) return
    vlist.scrollToIndex(targetIndex, { offset: -targetViewportOffset, smooth: false })
  }
}
