<script lang="ts" generics="T">
  import { onMount, tick, untrack, type Snippet } from 'svelte'
  import { createTranscriptCaches } from '../core/transcript-cache'
  import { TranscriptGeometry, type TranscriptAnchor } from '../core/transcript-geometry'
  import type { TranscriptScrollOptions } from '../core/transcript-handle'

  let {
    data,
    getKey,
    estimateHeight,
    estimateChanges,
    getMeasurementVersion,
    initialPosition,
    layoutVersion = '',
    follow = false,
    preserveOnReplace = true,
    onfollowchange,
    onuserinteraction,
    onviewportchange,
    onrangechange,
    children
  }: {
    data: T[]
    getKey: (item: T) => string
    estimateHeight: (item: T) => number
    estimateChanges?: readonly string[]
    getMeasurementVersion?: (item: T) => unknown
    initialPosition?: { index: number; options?: TranscriptScrollOptions }
    layoutVersion?: string
    follow?: boolean
    preserveOnReplace?: boolean
    onfollowchange?: (following: boolean) => void
    onuserinteraction?: () => void
    onviewportchange?: (width: number, height: number) => void
    onrangechange?: (start: number, end: number) => void
    children: Snippet<[T, number]>
  } = $props()

  let viewport: HTMLDivElement
  let geometry = $state.raw(new TranscriptGeometry([], []))
  let scrollTop = $state(0)
  let viewportHeight = $state(0)
  let overscanReady = $state(false)
  let following = false
  let observer: ResizeObserver | undefined
  let frame = 0
  let disposed = false
  let settling = false
  let settleAgain = false
  let generation = 0
  let programmaticTop: number | null = null
  let inputActive = false
  let pointerActive = false
  let lastNativeTop = 0
  let anchor: TranscriptAnchor | null = null
  let navigation: { key: string; options: TranscriptScrollOptions } | null = null
  let lastVersion = ''
  let initialized = false
  const { measurements, estimates, elements } = createTranscriptCaches()
  let fragment: { key: string; part: string; text: string; offset: number; top: number } | null =
    null
  const range = $derived(
    geometry.visibleRange(scrollTop, viewportHeight, overscanReady ? viewportHeight : 0)
  )
  const visible = $derived(data.slice(range.start, range.end))

  $effect(() => {
    const { start, end } = range
    untrack(() => onrangechange?.(start, end))
  })

  $effect(() => {
    following = follow
    if (following) {
      navigation = null
      queueLayout()
    }
  })

  // The model is keyed by message identity, including equal-length rolling windows.
  $effect.pre(() => {
    const version = layoutVersion
    const keys = data.map(getKey)
    const nextEstimates = data.map(estimateHeight)
    const measurementVersions = getMeasurementVersion ? data.map(getMeasurementVersion) : null
    untrack(() => {
      if (!initialized && keys.length) {
        initialized = true
        const key = initialPosition && keys[initialPosition.index]
        if (key) navigation = { key, options: initialPosition!.options ?? {} }
      }
      const invalidated = version !== lastVersion
      if (invalidated) measurements.clear()
      lastVersion = version
      const retained = new Set(keys)
      for (const key of measurements.keys()) if (!retained.has(key)) measurements.delete(key)
      estimates.clear()
      keys.forEach((key, index) => estimates.set(key, nextEstimates[index]!))
      const heights = keys.map((key, index) => {
        const measured = measurements.get(key)
        return measured &&
          (measurementVersions
            ? measured.version === measurementVersions[index]
            : measured.estimate === nextEstimates[index])
          ? measured.height
          : nextEstimates[index]!
      })
      const changed =
        keys.length !== geometry.keys.length ||
        keys.some(
          (key, index) => key !== geometry.keys[index] || heights[index] !== geometry.heights[index]
        )
      if (!changed && !invalidated) return
      if (!preserveOnReplace && keys.some((key, index) => key !== geometry.keys[index])) {
        anchor = null
        fragment = null
      }
      geometry = new TranscriptGeometry(keys, heights)
      scrollTop = layoutTarget()
      // Spacer updates may not cause a ResizeObserver callback. Settle after
      // this DOM update rather than leaving the old native offset for a frame.
      void tick().then(settleLayout)
    })
  })

  $effect.pre(() => {
    const changes = estimateChanges
    if (!changes?.length) return
    untrack(() => {
      const heights = [...geometry.heights]
      let changed = false
      for (const key of changes) {
        const index = geometry.indexOf(key)
        if (index < 0) continue
        const item = data[index]!
        const estimate = estimateHeight(item)
        estimates.set(key, estimate)
        const measured = measurements.get(key)
        const height =
          measured &&
          (getMeasurementVersion
            ? measured.version === getMeasurementVersion(item)
            : measured.estimate === estimate)
            ? measured.height
            : estimate
        if (height !== heights[index]) {
          heights[index] = height
          changed = true
        }
      }
      if (!changed) return
      geometry = new TranscriptGeometry(geometry.keys, heights)
      scrollTop = layoutTarget()
      void tick().then(settleLayout)
    })
  })

  function setScroll(top: number): void {
    if (!viewport || viewport.clientHeight === 0) return
    viewport.scrollTop = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
    programmaticTop = viewport.scrollTop
    scrollTop = viewport.scrollTop
    lastNativeTop = viewport.scrollTop
  }

  function textRange(part: HTMLElement, offset: number): Range | null {
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT)
    let node: Node | null
    let remaining = offset
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0
      if (length > remaining) {
        const result = document.createRange()
        result.setStart(node, remaining)
        result.setEnd(node, Math.min(length, remaining + 1))
        return result
      }
      remaining -= length
    }
    return null
  }

  function captureFragment(): void {
    fragment = null
    if (!viewport || !anchor) return
    const element = elements.get(anchor.key)
    if (!element) return
    const top = viewport.getBoundingClientRect().top
    // Prefer the message body: timestamps may disappear, and a sender prefix
    // can stay on its old line while the body wraps onto a different one.
    const parts = [...element.querySelectorAll<HTMLElement>('[data-message-part]')].sort(
      (a, b) =>
        Number(b.dataset['messagePart']?.startsWith('segment-')) -
        Number(a.dataset['messagePart']?.startsWith('segment-'))
    )
    for (const part of parts) {
      // Probe text ranges, since an inline element may span several wrapped lines.
      const length = part.textContent?.length ?? 0
      if (!length) continue
      let low = 0
      let high = length - 1
      let found = -1
      while (low <= high) {
        const mid = (low + high) >>> 1
        const rect = textRange(part, mid)?.getBoundingClientRect()
        if (rect && rect.height > 0 && rect.bottom > top) {
          found = mid
          high = mid - 1
        } else low = mid + 1
      }
      if (found < 0) continue
      const rect = textRange(part, found)?.getBoundingClientRect()
      if (!rect || rect.top > top + viewport.clientHeight) continue
      fragment = {
        key: anchor.key,
        part: part.dataset['messagePart']!,
        text: part.textContent ?? '',
        offset: found,
        top: rect.top - top
      }
      return
    }
  }

  export function preservePosition(): void {
    if (!viewport || viewport.clientHeight === 0) return
    anchor = geometry.capture(viewport.scrollTop)
    // A native scroll can arrive after content changed but before ResizeObserver.
    // Use the rendered row for identity and offset instead of stale estimated heights.
    const top = viewport.getBoundingClientRect().top
    let firstTop = Infinity
    for (const [key, element] of elements) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom <= top || rect.top >= top + viewport.clientHeight || rect.top >= firstTop)
        continue
      const index = geometry.indexOf(key)
      if (index < 0) continue
      firstTop = rect.top
      anchor = {
        key,
        index,
        offset: top - rect.top,
        previousKeys: geometry.keys,
        previousOffsets: geometry.offsets
      }
    }
    captureFragment()
  }

  function layoutTarget(): number {
    const height = viewport?.clientHeight ?? viewportHeight
    if (following) return Math.max(0, geometry.total - height)
    if (navigation) {
      const index = geometry.indexOf(navigation.key)
      if (index >= 0) return geometry.scrollOffset(index, navigation.options, height)
      navigation = null
    }
    return anchor
      ? geometry.restore(anchor, height)
      : Math.max(0, Math.min(scrollTop, geometry.total - height))
  }

  function measureMountedRows(): boolean {
    let changed = false
    const heights = [...geometry.heights]
    for (const [key, element] of elements) {
      const index = geometry.indexOf(key)
      if (index < 0) continue
      const height = element.getBoundingClientRect().height
      if (height <= 0) continue
      measurements.set(key, {
        height,
        estimate: estimates.get(key) ?? 1,
        version: getMeasurementVersion?.(data[index]!)
      })
      if (Math.abs(height - heights[index]!) <= 0.01) continue
      heights[index] = height
      changed = true
    }
    if (changed) geometry = new TranscriptGeometry(geometry.keys, heights)
    return changed
  }

  function queueLayout(): void {
    if (!frame && !disposed)
      frame = requestAnimationFrame(() => {
        frame = 0
        void settleLayout()
      })
  }

  async function settleLayout(): Promise<void> {
    if (disposed || !viewport || viewport.clientHeight === 0) return
    if (settling) {
      settleAgain = true
      return
    }
    settling = true
    try {
      const currentGeneration = generation
      const savedFragment = fragment
      // Read current DOM, not sizes queued by an older layout revision. A second
      // pass also measures newly mounted rows after a distant navigation.
      for (let pass = 0; pass < 2; pass++) {
        measureMountedRows()
        scrollTop = layoutTarget()
        await tick()
        if (disposed || generation !== currentGeneration) return
      }
      setScroll(following ? viewport.scrollHeight : layoutTarget())
      if (!following && !navigation && savedFragment) {
        const element = elements.get(savedFragment.key)
        const part = element?.querySelector<HTMLElement>(
          `[data-message-part="${CSS.escape(savedFragment.part)}"]`
        )
        const rect =
          part?.textContent === savedFragment.text &&
          textRange(part, savedFragment.offset)?.getBoundingClientRect()
        if (rect && rect.height > 0)
          setScroll(
            viewport.scrollTop + rect.top - viewport.getBoundingClientRect().top - savedFragment.top
          )
      }
      preservePosition()
    } finally {
      settling = false
      if (settleAgain) {
        settleAgain = false
        // A concurrent estimate or ResizeObserver callback still belongs to
        // this paint. Coalesce it without postponing the final bottom correction.
        queueMicrotask(() => void settleLayout())
      }
    }
  }

  function observeRow(node: HTMLElement, key: string): { destroy: () => void } {
    elements.set(key, node)
    observer?.observe(node)
    return {
      destroy: () => {
        observer?.unobserve(node)
        if (elements.get(key) === node) elements.delete(key)
      }
    }
  }

  function userIntent(): void {
    generation++
    navigation = null
    programmaticTop = null
    inputActive = true
    onuserinteraction?.()
  }

  function stopFollowing(): void {
    if (!following) return
    following = false
    onfollowchange?.(false)
  }

  function onScroll(): void {
    if (!viewport) return
    const currentTop = viewport.scrollTop
    const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const nativeClamp = lastNativeTop > maximum + 1 && Math.abs(currentTop - maximum) <= 1
    lastNativeTop = currentTop
    if (programmaticTop !== null && Math.abs(currentTop - programmaticTop) <= 1) return
    programmaticTop = null
    // Layout and native scroll clamping emit scroll events too. Only explicit
    // wheel, keyboard or pointer sessions may replace the reading anchor.
    if (!inputActive || nativeClamp) {
      queueLayout()
      return
    }
    generation++
    navigation = null
    scrollTop = currentTop
    const bottom = maximum - currentTop <= 1
    if (bottom !== following) {
      // Entering follow mode belongs to the owner. Search/history transcripts
      // and a parent reading historical playback may intentionally decline it.
      if (!bottom) following = false
      onfollowchange?.(bottom)
    }
    preservePosition()
  }

  export function scrollToIndex(index: number, options: TranscriptScrollOptions = {}): void {
    const item = data[index]
    if (!item) return
    generation++
    inputActive = false
    if (!(index === data.length - 1 && options.align === 'end')) stopFollowing()
    navigation = { key: getKey(item), options }
    queueLayout()
  }
  export function getItemOffset(index: number): number {
    return geometry.offsets[index] ?? 0
  }
  export function getItemSize(index: number): number {
    return geometry.heights[index] ?? 0
  }
  export function getScrollOffset(): number {
    return viewport?.scrollTop ?? 0
  }
  export function getScrollSize(): number {
    return geometry.total
  }
  export function getViewportSize(): number {
    return viewport?.clientHeight ?? 0
  }

  onMount(() => {
    // Mount the viewport before its two extra viewports of overscan. Cold message
    // components are substantial work even when no offscreen text is measured.
    let overscanTask: ReturnType<typeof setTimeout> | undefined
    const overscanFrame = requestAnimationFrame(() => {
      overscanTask = setTimeout(() => {
        overscanReady = true
      }, 0)
    })
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === viewport) {
          if (viewport.clientHeight > 0) viewportHeight = viewport.clientHeight
          onviewportchange?.(viewport.clientWidth, viewport.clientHeight)
        }
      }
      // ResizeObserver runs before paint. Keep the native bottom pinned now,
      // including fractional CSS rounding, and settle readers in this same frame.
      if (following) setScroll(viewport.scrollHeight)
      cancelAnimationFrame(frame)
      frame = 0
      void settleLayout()
    })
    observer.observe(viewport)
    for (const node of elements.values()) observer.observe(node)
    viewportHeight = viewport.clientHeight
    queueLayout()
    const pointerEnd = (): void => {
      if (pointerActive && viewport.scrollTop !== lastNativeTop) onScroll()
      pointerActive = false
      inputActive = false
    }
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    return () => {
      disposed = true
      generation++
      cancelAnimationFrame(overscanFrame)
      clearTimeout(overscanTask)
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerEnd)
    }
  })
</script>

<!-- This read-only scroll region is keyboard-focusable for native scrolling;
     it has no widget selection behavior. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="virtual-transcript"
  bind:this={viewport}
  role="region"
  aria-label="Chat transcript"
  tabindex="0"
  onscroll={onScroll}
  onscrollend={() => {
    if (!pointerActive) inputActive = false
  }}
  onwheel={(event) => {
    userIntent()
    if (event.deltaY < 0) stopFollowing()
  }}
  onpointerdown={() => {
    pointerActive = true
    userIntent()
  }}
  onkeydown={(event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      userIntent()
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)
      )
        stopFollowing()
    }
  }}
>
  <div aria-hidden="true" style:height={`${geometry.offsets[range.start] ?? 0}px`}></div>
  {#each visible as item, index (getKey(item))}
    <div class="transcript-row" data-transcript-key={getKey(item)} use:observeRow={getKey(item)}>
      {@render children(item, range.start + index)}
    </div>
  {/each}
  <div
    aria-hidden="true"
    style:height={`${Math.max(0, geometry.total - (geometry.offsets[range.end] ?? 0))}px`}
  ></div>
</div>

<style>
  .virtual-transcript {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: none;
    scrollbar-gutter: stable;
    position: relative;
    outline-offset: -2px;
  }
  .transcript-row {
    display: flow-root;
    overflow-anchor: none;
  }
</style>
