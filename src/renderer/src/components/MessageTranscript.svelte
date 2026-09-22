<script lang="ts" generics="T extends TwitchMessage, C = undefined">
  import { onMount, untrack, type Snippet } from 'svelte'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import {
    MessagePresentationStore,
    presentationOptions,
    type MessagePresentationSeed,
    type MessagePresentationOptions
  } from '../core/message-presentation'
  import {
    clearMessageLayoutCache,
    measureMessage,
    readMessageMetrics,
    type MessageMetrics
  } from '../core/message-layout'
  import type { UrlTracker } from '../core/url-tracker'
  import type { TranscriptHandle, TranscriptScrollOptions } from '../core/transcript-handle'
  import { TranscriptEstimator } from '../core/transcript-estimator'
  import { createMessageLayoutDependencies } from '../core/transcript-cache'
  import { CooperativeWork } from '@/utils/cooperative-work'
  import type { TimelineMap } from '@/utils/datastructs'
  import { settings } from '../state/settings.svelte'
  import VirtualTranscript from './VirtualTranscript.svelte'

  let {
    data,
    urlTracker,
    videoStartTime,
    videoEndTime,
    getElapsedTime,
    searchQuery,
    initialPosition,
    gutter = false,
    follow = false,
    preserveOnReplace = true,
    onfollowchange,
    onuserinteraction,
    onuserscroll,
    onrangechange,
    renderContext,
    presentationSeed,
    onpublish,
    children: renderMessage
  }: {
    data: readonly T[]
    urlTracker: UrlTracker
    videoStartTime?: number
    videoEndTime?: number
    getElapsedTime?: (message: T) => number | undefined
    searchQuery?: string | RegExp
    initialPosition?: { index: number; options?: TranscriptScrollOptions }
    gutter?: boolean
    follow?: boolean
    preserveOnReplace?: boolean
    onfollowchange?: (following: boolean) => void
    onuserinteraction?: () => void
    onuserscroll?: () => void
    onrangechange?: (start: number, end: number) => void
    renderContext?: C
    presentationSeed?: MessagePresentationSeed
    onpublish?: (rows: readonly T[]) => void
    children: Snippet<[T, number, MessagePresentationStore, C | undefined]>
  } = $props()

  const store = new MessagePresentationStore()
  // Consume once before any estimates or mounted rows; clearing must never reseed stale assets.
  untrack(() => {
    if (presentationSeed) store.seed(presentationSeed)
  })
  const elapsedOptions: Record<
    string,
    { base: MessagePresentationOptions; value: MessagePresentationOptions }
  > = Object.create(null)
  let container: HTMLDivElement
  let list: TranscriptHandle | null = $state(null)
  let queuedNavigation: { key: string; options?: TranscriptScrollOptions } | null = $state.raw(null)
  let metrics = $state.raw<MessageMetrics | null>(null)
  let width = $state(0)
  let fontVersion = $state(0)
  let cacheVersion = $state(0)
  let estimateChanges = $state.raw<readonly string[]>([])
  let dependencies = createMessageLayoutDependencies()
  let preparedData = $state.raw<readonly T[]>([])
  let preparedLayoutVersion = $state('')
  let preparedContext = $state.raw<C | undefined>(undefined)
  let preparationRevision = 0
  let cleanupController: AbortController | undefined
  const options = $derived(presentationOptions({ videoStartTime, videoEndTime, searchQuery }))
  const inlinePreviews = $derived(settings.interface.enableInlineImagePreviews)
  const layoutVersion = $derived(
    JSON.stringify([
      metrics,
      width,
      options,
      searchQuery?.toString(),
      gutter,
      fontVersion,
      cacheVersion,
      inlinePreviews
    ])
  )
  const estimator = new TranscriptEstimator<T>({
    getKey: (message) => message.getId(),
    measure: (message) => {
      const result = urlTracker.collectLayoutUrls(() => measureHeight(message))
      dependencies.record(message.getId(), result.urls)
      return result.value
    },
    publish: (keys) => {
      estimateChanges = keys
    }
  })

  $effect.pre(() => {
    const rows = data
    const version = layoutVersion
    const context = renderContext
    if (!metrics || width <= 0) return
    const controller = new AbortController()
    const revision = ++preparationRevision
    untrack(() => {
      if (rows.length <= 1000 && preparedData.length <= 1000) {
        const ids = rows.map((message) => message.getId())
        dependencies.retain(rows)
        const keep = new Set(ids)
        for (const key of Object.keys(elapsedOptions))
          if (!keep.has(key)) delete elapsedOptions[key]
        estimator.replace(rows, version)
        preparedData = rows
        preparedLayoutVersion = version
        preparedContext = context
      } else {
        void prepareRows(rows, version, context, controller.signal, revision).catch(
          (error: unknown) => {
            if (!controller.signal.aborted) console.error('Failed to prepare transcript:', error)
          }
        )
      }
    })
    return () => controller.abort()
  })

  async function prepareRows(
    rows: readonly T[],
    version: string,
    context: C | undefined,
    signal: AbortSignal,
    revision: number
  ): Promise<void> {
    if (preparedData === rows) {
      await estimator.replaceCooperatively(rows, version, signal)
      signal.throwIfAborted()
      preparedLayoutVersion = version
      preparedContext = context
      return
    }
    const work = new CooperativeWork(signal)
    const nextDependencies = await dependencies.fork(rows, signal)
    const keep = nextDependencies
    for (const key in elapsedOptions) {
      if (!keep.has(key)) delete elapsedOptions[key]
      const pause = work.checkpoint()
      if (pause) await pause
    }
    await estimator.replaceCooperatively(rows, version, signal)
    await nextDependencies.completeFork()
    work.throwIfAborted()
    if (revision !== preparationRevision) return
    dependencies = nextDependencies
    preparedData = rows
    preparedLayoutVersion = version
    preparedContext = context
  }

  function releaseOldPresentations(rows: readonly T[]): void {
    // VirtualTranscript initially publishes its empty geometry while reporting viewport width.
    // Retain assets until the currently requested replacement has actually been published.
    if (rows !== preparedData || preparedData !== data) return
    onpublish?.(rows)
    cleanupController?.abort()
    const controller = new AbortController()
    cleanupController = controller
    // Retention follows actual rendered rows, not an abandoned preparation.
    void store.retainCooperatively(dependencies, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error('Failed to release transcript cache:', error)
    })
  }

  function invalidateRows(keys: Iterable<string>): void {
    // These are DOM-content revisions, separate from improving an estimate.
    const ids = Array.from(keys)
    for (const key of ids) dependencies.invalidate(key)
    estimator.invalidate(ids)
  }

  $effect(() =>
    store.subscribeLayout((change) => {
      if (change.kind === 'all') cacheVersion++
      else if (change.kind === 'message') invalidateRows([change.id])
      else invalidateRows(dependencies.channels.get(change.channel) ?? [])
    })
  )

  $effect(() =>
    urlTracker.subscribeLayout((url) => {
      if (url === undefined) cacheVersion++
      else invalidateRows(dependencies.urls.get(url) ?? [])
    })
  )

  $effect(() => {
    if (!list || !queuedNavigation || preparedData !== data) return
    const request = queuedNavigation
    queuedNavigation = null
    const index = preparedData.findIndex((message) => message.getId() === request.key)
    if (index < 0) return
    untrack(() => list?.scrollToIndex(index, request.options))
  })

  function measureHeight(message: T): number {
    if (!metrics) return 48
    let messageOptions = options
    if (getElapsedTime) {
      const elapsedTime = getElapsedTime(message)
      const key = message.getId()
      let cached = elapsedOptions[key]
      if (cached?.base !== options || cached.value.elapsedTime !== elapsedTime) {
        cached = { base: options, value: { ...options, elapsedTime } }
        elapsedOptions[key] = cached
      }
      messageOptions = cached.value
    }
    const presentation = store.get(message, messageOptions)
    return (
      measureMessage(
        presentation,
        Math.max(1, width - (gutter ? 42 : 0)),
        metrics,
        urlTracker,
        inlinePreviews
      ) + (gutter ? metrics.padding * 2 : 0)
    )
  }

  export function scrollToIndex(index: number, options?: TranscriptScrollOptions): void {
    estimator.prioritize(Math.max(0, index - 16), Math.min(data.length, index + 17))
    if (list && preparedData === data) list.scrollToIndex(index, options)
    else if (data[index]) queuedNavigation = { key: data[index].getId(), options }
  }
  export function getItemOffset(index: number): number {
    return list?.getItemOffset(index) ?? 0
  }
  export function getItemSize(index: number): number {
    return list?.getItemSize(index) ?? 0
  }
  export function getScrollOffset(): number {
    return list?.getScrollOffset() ?? 0
  }
  export function getScrollSize(): number {
    return list?.getScrollSize() ?? 0
  }
  export function getViewportSize(): number {
    return list?.getViewportSize() ?? 0
  }
  export function preservePosition(): void {
    list?.preservePosition()
  }
  export function clearCache(): void {
    store.clear()
  }
  export function capturePresentation(
    messages: readonly TwitchMessage[],
    timeline?: Pick<TimelineMap<string, string>, 'get'>
  ): MessagePresentationSeed {
    return store.capture(messages, timeline)
  }

  onMount(() => {
    const refresh = (): void => {
      const next = readMessageMetrics(container)
      if (JSON.stringify(next) !== JSON.stringify(metrics)) metrics = next
    }
    const fontsChanged = (): void => {
      clearMessageLayoutCache()
      fontVersion++
      refresh()
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-layout']
    })
    document.fonts.addEventListener('loadingdone', fontsChanged)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', fontsChanged)
      estimator.dispose()
      cleanupController?.abort()
      // Captured popup assets outlive a transcript; only explicit cache clearing revokes them.
      store.clear(false)
    }
  })
</script>

<div class="message-transcript" bind:this={container}>
  {#if metrics}
    <VirtualTranscript
      bind:this={list}
      data={preparedData}
      renderContext={preparedContext}
      getKey={(message) => message.getId()}
      estimateHeight={(message) => estimator.get(message.getId())}
      {estimateChanges}
      getMeasurementVersion={(message) => dependencies.versions.get(message.getId()) ?? 0}
      layoutVersion={preparedLayoutVersion}
      {initialPosition}
      {follow}
      {preserveOnReplace}
      {onfollowchange}
      onuserinteraction={() => {
        queuedNavigation = null
        onuserinteraction?.()
      }}
      {onuserscroll}
      onrangechange={(start, end) => {
        estimator.prioritize(start, end)
        onrangechange?.(start, end)
      }}
      onpublish={releaseOldPresentations}
      onviewportchange={(nextWidth) => {
        if (nextWidth > 0) width = nextWidth
      }}
    >
      {#snippet children(message, index, context)}
        {@render renderMessage(message, index, store, context)}
      {/snippet}
    </VirtualTranscript>
  {/if}
</div>

<style>
  .message-transcript {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>
