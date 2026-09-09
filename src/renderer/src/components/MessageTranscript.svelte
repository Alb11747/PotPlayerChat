<script lang="ts" generics="T extends TwitchMessage">
  import { onMount, untrack, type Snippet } from 'svelte'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import {
    MessagePresentationStore,
    presentationOptions,
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
  import { settings } from '../state/settings.svelte'
  import VirtualTranscript from './VirtualTranscript.svelte'

  let {
    data,
    urlTracker,
    videoStartTime,
    videoEndTime,
    getElapsedTime,
    searchQuery,
    gutter = false,
    follow = false,
    preserveOnReplace = true,
    onfollowchange,
    onuserinteraction,
    children: renderMessage
  }: {
    data: T[]
    urlTracker: UrlTracker
    videoStartTime?: number
    videoEndTime?: number
    getElapsedTime?: (message: T) => number | undefined
    searchQuery?: string | RegExp
    gutter?: boolean
    follow?: boolean
    preserveOnReplace?: boolean
    onfollowchange?: (following: boolean) => void
    onuserinteraction?: () => void
    children: Snippet<[T, number, MessagePresentationStore]>
  } = $props()

  const store = new MessagePresentationStore()
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
  const options = $derived(presentationOptions({ videoStartTime, videoEndTime, searchQuery }))
  const layoutVersion = $derived(JSON.stringify([metrics, width, options, gutter, fontVersion]))

  $effect(() => {
    const ids = data.map((message) => message.getId())
    untrack(() => {
      store.retain(ids)
      const keep = new Set(ids)
      for (const key of Object.keys(elapsedOptions)) if (!keep.has(key)) delete elapsedOptions[key]
    })
  })

  $effect(() => {
    if (!list || !queuedNavigation) return
    const request = queuedNavigation
    queuedNavigation = null
    const index = data.findIndex((message) => message.getId() === request.key)
    if (index < 0) return
    untrack(() => list?.scrollToIndex(index, request.options))
  })

  function estimateHeight(message: T): number {
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
        settings.interface.enableInlineImagePreviews
      ) + (gutter ? metrics.padding * 2 : 0)
    )
  }

  export function scrollToIndex(index: number, options?: TranscriptScrollOptions): void {
    if (list) list.scrollToIndex(index, options)
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

  onMount(() => {
    const refresh = (): void => {
      const next = readMessageMetrics(container)
      if (JSON.stringify(next) !== JSON.stringify(metrics)) metrics = next
      if (!width) width = container.clientWidth
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
      store.clear()
    }
  })
</script>

<div class="message-transcript" bind:this={container}>
  {#if metrics}
    <VirtualTranscript
      bind:this={list}
      {data}
      getKey={(message) => message.getId()}
      {estimateHeight}
      {layoutVersion}
      {follow}
      {preserveOnReplace}
      {onfollowchange}
      {onuserinteraction}
      onviewportchange={(nextWidth) => {
        if (nextWidth > 0) width = nextWidth
      }}
    >
      {#snippet children(message, index)}
        {@render renderMessage(message, index, store)}
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
