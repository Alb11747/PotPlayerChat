<script lang="ts" generics="T, C = undefined">
  import { onMount, untrack, type Snippet } from 'svelte'
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

  /**
   * Scroll model. The browser owns the reading position: rows sit in normal
   * flow between two spacers, and Chromium's scroll anchoring keeps the first
   * visible content still when anything above it changes size, including
   * during native smooth scrolling and scrollbar drags. Geometry only decides
   * which rows to mount and how tall the spacers are.
   *
   * This component writes the scroll offset in just three cases, always from
   * the mounted DOM rather than from estimates:
   *  - following: pin to the bottom after every layout change;
   *  - a sticky target: an explicit scrollToIndex, held until user input;
   *  - a one-shot target: re-seat the reading row after the dataset is replaced,
   *    which native anchoring cannot do when its anchor node was removed.
   */
  interface Target {
    key: string
    options: TranscriptScrollOptions
    sticky: boolean
  }

  // A row hidden by less than this at the viewport top still counts as on screen.
  const EDGE = 1

  let viewport: HTMLDivElement
  let geometry = $state.raw(new TranscriptGeometry([], []))
  let range = $state.raw({ start: 0, end: 0 })
  let following = $state(false)
  let renderedData = $state.raw<readonly T[]>([])
  let renderedContext = $state.raw<C | undefined>()
  let target: Target | null = null
  // Geometric reading position, for restoring after the viewport was hidden.
  let anchor: TranscriptAnchor | null = null
  let lastTop = 0
  let overscan = false
  let edgeRow: HTMLElement | null = null
  // The row native anchoring should be holding, as last seen on screen.
  let held: { key: string; top: number; scrollTop: number } | null = null
  let hidden = true
  let disposed = false
  let initialized = false
  let pointerActive = false
  let inputUntil = 0
  let inputAt = 0
  let followedAt = 0
  let generation = 0
  let lastVersion = ''
  let observer: ResizeObserver | undefined
  const caches = createTranscriptCaches()
  let measurements = caches.measurements
  let estimates = caches.estimates
  const elements = caches.elements
  let preparation: { controller: AbortController; dirty: Set<string> } | null = null
  const visible = $derived(renderedData.slice(range.start, range.end))

  $effect(() => {
    const { start, end } = range
    untrack(() => onrangechange?.(start, end))
  })

  // Before publication, so the first rows mount where a following reader will be.
  $effect.pre(() => {
    const next = follow
    untrack(() => {
      following = next
      if (next) {
        followedAt = performance.now()
        target = null
        reconcile()
      }
    })
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
          if (key && !target && generation === startedGeneration)
            target = { key, options: position!.options ?? {}, sticky: true }
        } else if (!following && !target?.sticky) {
          // Native anchoring follows surviving DOM nodes, but a replacement can
          // remove them all. Re-seat the reading row once the new rows mount.
          const shown = viewport && viewport.clientHeight > 0
          const reading =
            !preserveOnReplace && replaced
              ? nextGeometry.capture(shown ? viewport.scrollTop : lastTop)
              : shown
                ? readingAnchor()
                : anchor
          const located = nextGeometry.locate(reading)
          anchor = located && {
            key: nextGeometry.keys[located.index]!,
            index: located.index,
            offset: located.offset,
            previousGeometry: nextGeometry
          }
          target = anchor && {
            key: anchor.key,
            options: { align: 'start', offset: anchor.offset },
            sticky: false
          }
        }
        measurements = nextMeasurements
        estimates = nextEstimates
        lastVersion = version
        renderedData = rows
        renderedContext = context
        geometry = nextGeometry
        onpublish?.(rows)
        preparation = null
        // Mount the rows around the destination now; reconcile() positions the
        // viewport from their real layout after this DOM update.
        updateRange(expectedTop())
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

  // Refined estimates only resize the spacers; native anchoring absorbs them.
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
      geometry = geometry.withHeights(heights)
    })
  })

  // Runs after every DOM update that can move rows, before the browser paints.
  // Reconciling may itself change the range or geometry and run this again; it
  // settles in a few passes. The bound keeps an unforeseen oscillation from
  // exhausting Svelte's update depth, which would stop the transcript for good.
  let passes = 0
  $effect(() => {
    void geometry
    void range
    void renderedData
    if (passes === 0) queueMicrotask(() => (passes = 0))
    if (++passes > 30) {
      if (passes === 31) {
        console.warn('Transcript layout did not settle; retrying on the next frame')
        requestAnimationFrame(reconcile)
      }
      return
    }
    untrack(reconcile)
  })

  function expectedTop(): number {
    const height = viewport?.clientHeight ?? 0
    if (following) return Math.max(0, geometry.total - height)
    const index = target ? geometry.indexOf(target.key) : -1
    if (index >= 0) return geometry.scrollOffset(index, target!.options, height)
    return viewport?.scrollTop ?? 0
  }

  /**
   * Mount one viewport of overscan on each side, with hysteresis: the range is
   * replaced only once it covers less than half of that or more than half
   * again. DOM offsets differ from geometry by subpixels (snapped spacers,
   * device-pixel scroll offsets), so an exact comparison can flip between two
   * ranges forever as each one nudges the offset the other way.
   */
  function updateRange(top: number): boolean {
    const height = viewport?.clientHeight ?? 0
    if (height === 0) return false
    const extra = overscan ? height : 0
    const needed = geometry.visibleRange(top, height, extra / 2)
    const allowed = geometry.visibleRange(top, height, extra * 1.5 + 100)
    if (
      range.start <= needed.start &&
      range.end >= needed.end &&
      range.start >= allowed.start &&
      range.end <= allowed.end
    )
      return false
    range = geometry.visibleRange(top, height, extra)
    return true
  }

  /**
   * Find the row native anchoring should hold and remember where it is.
   *
   * Rows are atomic anchor candidates (see the stylesheet), so the browser
   * would pick the row crossing the viewport top and hold its top edge, which
   * is off screen. When that row resizes (media loading as it scrolls into
   * view), everything the reader can see below it jumps. Exclude it whenever a
   * later row starts inside the viewport, so the anchor is the first row that
   * begins on screen and the change stays above it.
   */
  function trackAnchor(top: number): void {
    let index = geometry.indexAt(top)
    const crossing =
      index >= 0 &&
      geometry.offsetAt(index) < top - EDGE &&
      index + 1 < geometry.keys.length &&
      geometry.offsetAt(index + 1) < top + viewport.clientHeight
    const edge = crossing ? (elements.get(geometry.keys[index]!) ?? null) : null
    if (edge !== edgeRow) {
      edgeRow?.style.removeProperty('overflow-anchor')
      edge?.style.setProperty('overflow-anchor', 'none')
      edgeRow = edge
    }
    if (crossing) index++
    const key = geometry.keys[index]
    const element = key === undefined ? undefined : elements.get(key)
    held =
      element && !following
        ? {
            key: key!,
            top: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
            scrollTop: viewport.scrollTop
          }
        : null
  }

  /**
   * Chromium suppresses anchoring for a whole layout pass on some style changes
   * anywhere in the scroller (an element entering or leaving normal flow, for
   * one). If rows moved and the scroll offset did not change at all, nothing
   * compensated: put the held row back before this frame paints. Any offset
   * change means the browser or the reader moved it, and is left alone.
   */
  function holdAnchor(): void {
    if (!held || viewport.scrollTop !== held.scrollTop) return
    const element = elements.get(held.key)
    if (!element) return
    const drift =
      element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - held.top
    if (Math.abs(drift) > 0.5) setTop(viewport.scrollTop + drift)
  }

  /**
   * Whole device pixels. Background estimates keep resizing the spacer above a
   * reader; a fractional change cannot be absorbed by a scroll offset that
   * snaps to device pixels, and would shimmer the text by a subpixel each time.
   */
  function snap(height: number): number {
    const scale = window.devicePixelRatio || 1
    return Math.round(height * scale) / scale
  }

  function setTop(top: number): void {
    const next = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
    // Display scaling snaps offsets to device pixels; chasing the remainder
    // would rewrite the offset forever and interrupt native smooth scrolling.
    if (Math.abs(next - viewport.scrollTop) > 0.5) viewport.scrollTop = next
  }

  function measureRows(): void {
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
      if (Math.abs(height - geometry.heightAt(index)) > 0.01) heights.push([index, height])
    }
    // Mounted rows already occupy their real height, so this changes no DOM;
    // it keeps geometry offsets equal to DOM offsets for the next range.
    if (heights.length) geometry = geometry.withHeights(heights)
  }

  /**
   * The row native anchoring holds, read from the DOM: the first row starting
   * on screen, or the row crossing the viewport top when no row starts below it.
   */
  function readingAnchor(): TranscriptAnchor | null {
    const bounds = viewport.getBoundingClientRect()
    let found: TranscriptAnchor | null = null
    let foundTop = Infinity
    let crossing: TranscriptAnchor | null = null
    for (const [key, element] of elements) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue
      const index = geometry.indexOf(key)
      if (index < 0) continue
      const row = { key, index, offset: bounds.top - rect.top, previousGeometry: geometry }
      if (rect.top < bounds.top - EDGE) crossing = row
      else if (rect.top < foundTop) {
        foundTop = rect.top
        found = row
      }
    }
    return found ?? crossing ?? geometry.capture(viewport.scrollTop)
  }

  function alignTarget(): void {
    const current = target!
    const index = geometry.indexOf(current.key)
    if (index < 0) {
      // A queued navigation may name a row of a replacement still in preparation.
      if (!preparation) target = null
      return
    }
    const height = viewport.clientHeight
    const element = elements.get(current.key)
    if (!element) {
      // Not mounted yet: go where geometry expects it, then align once it is.
      setTop(geometry.scrollOffset(index, current.options, height))
      return
    }
    const rect = element.getBoundingClientRect()
    const { align, offset } = current.options
    const place =
      align === 'center' ? (height - rect.height) / 2 : align === 'end' ? height - rect.height : 0
    setTop(
      viewport.scrollTop +
        rect.top -
        viewport.getBoundingClientRect().top -
        place +
        (offset !== undefined && Number.isFinite(offset) ? offset : 0)
    )
    if (!current.sticky) target = null
  }

  /** Idempotent: read the real layout, then apply the one position this mode owns. */
  function reconcile(): void {
    if (disposed || !viewport) return
    if (viewport.clientHeight === 0) {
      hidden = true
      return
    }
    if (hidden) {
      hidden = false
      // A hidden scroller may come back at a different offset.
      if (!following && !target && anchor)
        target = {
          key: anchor.key,
          options: { align: 'start', offset: anchor.offset },
          sticky: false
        }
    }
    measureRows()
    if (following) setTop(viewport.scrollHeight)
    else if (target) alignTarget()
    else holdAnchor()
    lastTop = viewport.scrollTop
    const changed = updateRange(lastTop)
    trackAnchor(lastTop)
    // A one-shot target waits only for its row to mount.
    if (target && !target.sticky && !changed) target = null
    if (!following && !target) anchor = geometry.capture(lastTop)
  }

  function observeRow(node: HTMLElement, key: string): { destroy: () => void } {
    elements.set(key, node)
    observer?.observe(node)
    return {
      destroy: () => {
        observer?.unobserve(node)
        if (elements.get(key) === node) elements.delete(key)
        if (edgeRow === node) edgeRow = null
        if (held?.key === key) held = null
      }
    }
  }

  function leaveFollow(): void {
    if (!following) return
    following = false
    // Following ignores targets, so one may be left over; it must not take effect now.
    target = null
    onfollowchange?.(false)
  }

  /** Wheel, pointer and keyboard input take the position back from any target. */
  function userInput(): void {
    generation++
    target = null
    inputAt = performance.now()
    inputUntil = inputAt + 250
    onuserinteraction?.()
  }

  function onScroll(): void {
    if (!viewport || viewport.clientHeight === 0) return
    const top = viewport.scrollTop
    const bottom = viewport.scrollHeight - viewport.clientHeight - top <= 1
    const moved = top - lastTop
    lastTop = top
    // Scrolling that continues from an input (smooth or momentum movement, a
    // held scrollbar) is still the user's; layout-driven adjustments are not.
    // Layout-driven scroll events can arrive every frame, so the renewal is
    // capped: without it one input would claim them for as long as they last.
    const now = performance.now()
    const user = pointerActive || now < inputUntil
    if (user) inputUntil = Math.min(now + 250, inputAt + 2000)
    if (following) {
      if (!bottom) {
        // Pinning and content changes never move a following view upwards, so
        // any upward movement is the reader's, whatever produced it. The one
        // exception is a scroll already in flight when the owner resumed following,
        // which a held pointer cannot be.
        if (moved < -0.5 && (pointerActive || performance.now() - followedAt > 100)) leaveFollow()
        else {
          // Content grew under a following reader: re-pin, which also updates
          // the range and anchor from the pinned offset.
          reconcile()
          return
        }
      }
    } else if (bottom && user && moved > 0 && !target) {
      // Only arriving at the bottom counts: the first frames of scrolling away
      // from it are still within a pixel. Entering follow mode belongs to the
      // owner; Search/history transcripts and a parent reading historical
      // playback may intentionally decline it.
      onfollowchange?.(true)
    }
    updateRange(top)
    trackAnchor(top)
    if (!following && !target) anchor = geometry.capture(top)
    if (user) onuserscroll?.()
  }

  export function scrollToIndex(index: number, options: TranscriptScrollOptions = {}): void {
    const item = data[index]
    if (!item) return
    generation++
    const bottom = index === data.length - 1 && options.align === 'end'
    if (!bottom) leaveFollow()
    // A following view is already pinned to the bottom. Holding today's last row
    // as a target would pin that row, not the bottom, once following ends.
    target = following ? null : { key: getKey(item), options, sticky: true }
    reconcile()
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
  /** Record the reading row before the owner hides the transcript; it is re-seated when shown. */
  export function preservePosition(): void {
    if (!viewport || viewport.clientHeight === 0 || following || target) return
    anchor = readingAnchor()
  }

  onMount(() => {
    // Mount the viewport before its two extra viewports of overscan. Cold message
    // components are substantial work even when no offscreen text is measured.
    let overscanTask: ReturnType<typeof setTimeout> | undefined
    const overscanFrame = requestAnimationFrame(() => {
      overscanTask = setTimeout(() => {
        overscan = true
        if (viewport.clientHeight > 0) updateRange(viewport.scrollTop)
      }, 0)
    })
    // ResizeObserver runs before paint, so late media and viewport changes are
    // pinned or aligned in the frame that shows them.
    observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        if (entry.target === viewport)
          onviewportchange?.(viewport.clientWidth, viewport.clientHeight)
      reconcile()
    })
    observer.observe(viewport)
    for (const node of elements.values()) observer.observe(node)
    // A pinned or targeted position is re-applied as soon as row content
    // changes, not only at the next resize delivery: other observers and tasks
    // may read the layout in between. Free reading needs nothing; the browser
    // anchors it. Row mounts and spacer styles are this component's own work.
    const contentObserver = new MutationObserver((records) => {
      if (!following && !target) return
      const contentChanged = records.some((record) => {
        const element =
          record.target instanceof Element ? record.target : record.target.parentElement
        const row = element?.closest<HTMLElement>('[data-transcript-key]')
        return row && row !== record.target
      })
      if (contentChanged) reconcile()
    })
    contentObserver.observe(viewport, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
    reconcile()
    const pointerEnd = (): void => {
      pointerActive = false
    }
    // Chromium does not always deliver pointerup after a native scrollbar drag.
    const pointerMove = (event: PointerEvent): void => {
      if (event.buttons === 0) pointerActive = false
    }
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    window.addEventListener('pointermove', pointerMove)
    return () => {
      disposed = true
      preparation?.controller.abort()
      cancelAnimationFrame(overscanFrame)
      clearTimeout(overscanTask)
      observer?.disconnect()
      contentObserver.disconnect()
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerEnd)
      window.removeEventListener('pointermove', pointerMove)
    }
  })
</script>

<!-- This read-only scroll region is keyboard-focusable for native scrolling;
     it has no widget selection behavior. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="virtual-transcript"
  class:following
  bind:this={viewport}
  role="region"
  aria-label="Chat transcript"
  tabindex="0"
  onscroll={onScroll}
  onwheel={(event) => {
    userInput()
    if (event.deltaY < 0) leaveFollow()
  }}
  onpointerdown={() => {
    pointerActive = true
    userInput()
  }}
  onkeydown={(event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      userInput()
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)
      )
        leaveFollow()
    }
  }}
>
  <div
    class="spacer"
    aria-hidden="true"
    style:height={`${snap(geometry.offsetAt(range.start))}px`}
  ></div>
  {#each visible as item, index (getKey(item))}
    <div class="transcript-row" data-transcript-key={getKey(item)} use:observeRow={getKey(item)}>
      {@render children(item, range.start + index, renderedContext)}
    </div>
  {/each}
  <div
    class="spacer"
    aria-hidden="true"
    style:height={`${snap(Math.max(0, geometry.total - geometry.offsetAt(range.end)))}px`}
  ></div>
</div>

<style>
  .virtual-transcript {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    position: relative;
    outline-offset: -2px;
  }
  /* The bottom is pinned explicitly; anchoring to the top row would fight it. */
  .virtual-transcript.following {
    overflow-anchor: none;
  }
  .transcript-row {
    display: flow-root;
  }
  /* A row is anchored as a whole, by its top edge: never by content inside it,
     which would let the row's top move when the row itself reflows. */
  .transcript-row > :global(*) {
    overflow-anchor: none;
  }
  /* Rows are the only anchor candidates, never the estimated space around them. */
  .spacer {
    overflow-anchor: none;
  }
</style>
