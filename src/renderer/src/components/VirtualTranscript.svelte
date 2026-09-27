<script lang="ts" generics="T, C = undefined">
  import { onMount, tick, untrack, type Snippet } from 'svelte'
  import { CooperativeWork } from '@/utils/cooperative-work'
  import { createTranscriptCaches } from '../core/transcript-cache'
  import { TranscriptGeometry, type TranscriptAnchor } from '../core/transcript-geometry'
  import type { TranscriptScrollOptions } from '../core/transcript-handle'

  let {
    data,
    renderContext,
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
    onuserscroll,
    onviewportchange,
    onrangechange,
    onpublish,
    children
  }: {
    data: readonly T[]
    renderContext?: C
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
    onuserscroll?: () => void
    onviewportchange?: (width: number, height: number) => void
    onrangechange?: (start: number, end: number) => void
    onpublish?: (rows: readonly T[]) => void
    children: Snippet<[T, number, C | undefined]>
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
  let inputIdleTimer: ReturnType<typeof setTimeout> | undefined
  let lastNativeTop = 0
  let anchor: TranscriptAnchor | null = null
  let navigation: { key: string; options: TranscriptScrollOptions } | null = null
  let lastVersion = ''
  let anchoredVersion = ''
  let initialized = false
  const caches = createTranscriptCaches()
  let measurements = caches.measurements
  let estimates = caches.estimates
  const elements = caches.elements
  let renderedData = $state.raw<readonly T[]>([])
  let renderedContext = $state.raw<C | undefined>()
  let preparation: { controller: AbortController; dirty: Set<string> } | null = null
  let fragment: { key: string; part: string; text: string; offset: number; top: number } | null =
    null
  const range = $derived(
    geometry.visibleRange(scrollTop, viewportHeight, overscanReady ? viewportHeight : 0)
  )
  const visible = $derived(renderedData.slice(range.start, range.end))

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

  // Publish rows and geometry together, so a pending large replacement cannot
  // render new messages against the old dataset's offsets or measurements.
  $effect.pre(() => {
    const rows = data
    const context = renderContext
    const version = layoutVersion
    const keyFor = getKey
    const heightFor = estimateHeight
    const versionFor = getMeasurementVersion
    const position = untrack(() => initialPosition)
    return untrack(() => {
      const pending = { controller: new AbortController(), dirty: new Set<string>() }
      preparation?.controller.abort()
      preparation = pending
      const invalidated = version !== lastVersion
      const startedGeneration = generation
      const { estimates: nextEstimates, measurements: nextMeasurements } = createTranscriptCaches()
      let replaced = rows.length !== geometry.keys.length
      const keyAt = (item: T, index: number): string => {
        const key = keyFor(item)
        if (key !== geometry.keys[index]) replaced = true
        return key
      }
      const heightAt = (item: T): number => {
        const key = keyFor(item)
        const estimate = heightFor(item)
        nextEstimates.set(key, estimate)
        const measured = invalidated ? undefined : measurements.get(key)
        if (
          measured &&
          (versionFor ? measured.version === versionFor(item) : measured.estimate === estimate)
        ) {
          nextMeasurements.set(key, measured)
          return measured.height
        }
        nextMeasurements.delete(key)
        return estimate
      }
      const publish = (nextGeometry: TranscriptGeometry): void => {
        if (disposed || pending.controller.signal.aborted) return
        if (!initialized && rows.length) {
          initialized = true
          const key = position && nextGeometry.keys[position.index]
          if (key && !navigation && generation === startedGeneration)
            navigation = { key, options: position!.options ?? {} }
        }
        if (!preserveOnReplace && replaced) {
          anchor = null
          fragment = null
        }
        measurements = nextMeasurements
        estimates = nextEstimates
        lastVersion = version
        renderedData = rows
        renderedContext = context
        geometry = nextGeometry
        onpublish?.(rows)
        preparation = null
        scrollTop = layoutTarget()
        void tick().then(settleLayout)
      }
      if (rows.length <= 1000) {
        const keys: string[] = []
        const heights: number[] = []
        rows.forEach((item, index) => {
          keys.push(keyAt(item, index))
          heights.push(heightAt(item))
        })
        publish(new TranscriptGeometry(keys, heights))
      } else {
        void (async () => {
          try {
            let nextGeometry = await TranscriptGeometry.create(
              rows,
              keyAt,
              heightAt,
              pending.controller.signal
            )
            const work = new CooperativeWork(pending.controller.signal)
            // Measurements and estimates may improve while building. Replay them
            // before publication without losing DOM-authoritative row heights.
            const changedHeights: [number, number][] = []
            for (const key of pending.dirty) {
              pending.dirty.delete(key)
              const index = nextGeometry.indexOf(key)
              if (index >= 0) changedHeights.push([index, heightAt(rows[index]!)])
              const pause = work.checkpoint()
              if (pause) await pause
            }
            work.throwIfAborted()
            nextGeometry = nextGeometry.withHeights(changedHeights)
            publish(nextGeometry)
          } catch (error) {
            if (!pending.controller.signal.aborted) throw error
          }
        })()
      }
      return () => {
        pending.controller.abort()
        if (preparation === pending) preparation = null
      }
    })
  })

  $effect.pre(() => {
    const changes = estimateChanges
    if (!changes?.length) return
    untrack(() => {
      const heights: [number, number][] = []
      for (const key of changes) {
        preparation?.dirty.add(key)
        const index = geometry.indexOf(key)
        if (index < 0) continue
        const item = renderedData[index]!
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
        heights.push([index, height])
      }
      const nextGeometry = geometry.withHeights(heights)
      if (nextGeometry === geometry) return
      geometry = nextGeometry
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
        previousGeometry: geometry
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
      if (!preparation) navigation = null
    }
    return anchor
      ? geometry.restore(anchor, height)
      : Math.max(0, Math.min(scrollTop, geometry.total - height))
  }

  function restoreReadingPosition(): void {
    if (following || navigation || !anchor) return
    // Native input may move before its scroll event updates the reading anchor.
    if (inputActive && viewport.scrollTop !== lastNativeTop) return
    const element = elements.get(anchor.key)
    if (!element) return
    const top = viewport.getBoundingClientRect().top
    const part =
      fragment &&
      element.querySelector<HTMLElement>(`[data-message-part="${CSS.escape(fragment.part)}"]`)
    const rect =
      fragment &&
      part?.textContent === fragment.text &&
      textRange(part, fragment.offset)?.getBoundingClientRect()
    const correction =
      rect && rect.height > 0
        ? rect.top - top - fragment!.top
        : element.getBoundingClientRect().top - top + anchor.offset
    if (Math.abs(correction) > 0.01) setScroll(viewport.scrollTop + correction)
  }

  function measureMountedRows(): boolean {
    const heights: [number, number][] = []
    for (const [key, element] of elements) {
      const index = geometry.indexOf(key)
      if (index < 0) continue
      const height = element.getBoundingClientRect().height
      if (height <= 0) continue
      measurements.set(key, {
        height,
        estimate: estimates.get(key) ?? 1,
        version: getMeasurementVersion?.(renderedData[index]!)
      })
      preparation?.dirty.add(key)
      if (Math.abs(height - geometry.heightAt(index)) <= 0.01) continue
      heights.push([index, height])
    }
    const nextGeometry = geometry.withHeights(heights)
    if (nextGeometry === geometry) return false
    geometry = nextGeometry
    return true
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
      // Native scroll offsets lose subpixel precision far into large transcripts.
      // Recapturing each programmatic correction would accumulate that rounding
      // into the reading anchor. Reflow does change the first visible text fragment,
      // so capture it once after each actual layout-version change.
      if (following || navigation || !anchor || anchoredVersion !== lastVersion) {
        preservePosition()
        anchoredVersion = lastVersion
      }
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

  function endInput(): void {
    clearTimeout(inputIdleTimer)
    inputIdleTimer = undefined
    inputActive = false
  }

  function refreshInput(): void {
    clearTimeout(inputIdleTimer)
    // scrollend can belong to an earlier programmatic correction and arrive
    // before a new wheel/key movement. Expire ownership on inactivity instead,
    // allowing native smooth scrolling to renew it and held drags to retain it.
    if (pointerActive) return
    inputIdleTimer = setTimeout(() => {
      // The browser may update its offset before delivering the final scroll.
      if (viewport.scrollTop !== lastNativeTop) onScroll()
      endInput()
    }, 250)
  }

  function userIntent(): void {
    preservePosition()
    generation++
    navigation = null
    programmaticTop = null
    inputActive = true
    refreshInput()
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
    refreshInput()
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
    onuserscroll?.()
  }

  export function scrollToIndex(index: number, options: TranscriptScrollOptions = {}): void {
    const item = data[index]
    if (!item) return
    generation++
    endInput()
    if (!(index === data.length - 1 && options.align === 'end')) stopFollowing()
    navigation = { key: getKey(item), options }
    queueLayout()
  }
  export function getItemOffset(index: number): number {
    return geometry.offsetAt(index)
  }
  export function getItemSize(index: number): number {
    return geometry.heightAt(index)
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
    // Decoding can update a mounted message after this frame's ResizeObserver
    // delivery. Pin that DOM change in its own microtask instead of waiting for
    // the next frame. Restore the existing reader anchor too; ResizeObserver
    // still owns geometry measurement, and input alone captures a new anchor.
    const contentObserver = new MutationObserver(() => {
      if (following) setScroll(viewport.scrollHeight)
      else restoreReadingPosition()
    })
    contentObserver.observe(viewport, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
    viewportHeight = viewport.clientHeight
    queueLayout()
    const pointerEnd = (): void => {
      if (!pointerActive) return
      if (viewport.scrollTop !== lastNativeTop) onScroll()
      pointerActive = false
      endInput()
    }
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    return () => {
      disposed = true
      endInput()
      preparation?.controller.abort()
      generation++
      cancelAnimationFrame(overscanFrame)
      clearTimeout(overscanTask)
      observer?.disconnect()
      contentObserver.disconnect()
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
  <div aria-hidden="true" style:height={`${geometry.offsetAt(range.start)}px`}></div>
  {#each visible as item, index (getKey(item))}
    <div class="transcript-row" data-transcript-key={getKey(item)} use:observeRow={getKey(item)}>
      {@render children(item, range.start + index, renderedContext)}
    </div>
  {/each}
  <div
    aria-hidden="true"
    style:height={`${Math.max(0, geometry.total - geometry.offsetAt(range.end))}px`}
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
