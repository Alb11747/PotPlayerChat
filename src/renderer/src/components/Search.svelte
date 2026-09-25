<script lang="ts">
  import '../assets/search-input.css'
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import { getSearchPattern, filterSearchMessages } from '@/renderer/src/core/search-messages'
  import { SharedSearchDataCache, mergeSearchMessages } from '@/renderer/src/core/search-data'
  import { selectSearchPreview } from '@/renderer/src/core/search-preview'
  import { SearchMessagePager, type SearchPageDirection } from '../core/search-paging'
  import type { SearchContext } from '@/renderer/src/core/search-window'
  import { findMessageIndex, getClosestMessageIndex, isRangeInMessages } from '@/utils/chat'
  import { CooperativeWork } from '@/utils/cooperative-work'
  import { deleteNullishKeysInPlace } from '@/utils/objects'
  import { onMount, tick, untrack } from 'svelte'
  import MessageTranscript from './MessageTranscript.svelte'
  import type { TranscriptHandle } from '../core/transcript-handle'
  import LinkPreview from '../components/LinkPreview.svelte'
  import { clearRendererCache, clearRendererSavedUrls } from '../core/maintenance'
  import { UrlTracker } from '../core/url-tracker'
  import { settings } from '../state/settings.svelte'
  import ChatMessage from './ChatMessage.svelte'

  let { context, earlyInput }: { context: SearchContext; earlyInput?: HTMLInputElement } = $props()

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const urlTracker = new UrlTracker(settings.chat)
  // The context captures one recording and its source-owned caches for this popup's lifetime.
  const sharedData = untrack(() => context.sharedData ?? new SharedSearchDataCache())
  const lifetime = new AbortController()
  const preview = untrack(() => ({
    ...context.preview,
    // A callback from an older popup may choose another target within its
    // captured recording. Select that neighborhood without consulting live chat.
    messages: selectSearchPreview(
      context.initialMessages,
      context.loadedMessages,
      context.focusedMessage
    )
  }))
  let presentationSeed = $state.raw(
    preview.presentation?.validity.valid ? preview.presentation : undefined
  )
  chatService.currentPotPlayerInfo = untrack(() => context.potplayerInfo)

  let searchQuery = $state(untrack(() => earlyInput?.value ?? context.initialSearch ?? ''))
  let caseSensitive = $state(false)
  let useRegex = $state(false)
  let scrolled = false
  let isLoading = $state(false)
  let isFiltering = $state(false)
  let loadError = $state('')
  let pageErrors = $state({ older: '', newer: '' })
  let pagingDirection: SearchPageDirection | null = $state(null)
  let pageController = new AbortController()
  let fullController: AbortController | undefined
  let edgeInput = false
  let previousQuery = untrack(() => searchQuery)
  let browsingTarget = untrack(() => context.focusedMessage)
  let pager = untrack(() => createPager(preview.messages))
  let browsingMessages = $state.raw(pager.messages)
  let browsingTimeline = $state.raw(
    untrack(() => presentationSeed?.mentionColors ?? chatService.usernameColorTimelineMap)
  )
  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})
  let messages: readonly TwitchMessage[] = $state.raw(preview.messages)
  let completeDataset = $state(false)
  let completeResults = $state(false)
  let transcriptStarted = $state(false)
  let backgroundStarted = false
  let filteredMessages: readonly TwitchMessage[] = $state.raw([])
  let renderedMessages: readonly TwitchMessage[] = $state.raw([])
  const isPublishing = $derived(transcriptStarted && renderedMessages !== filteredMessages)
  let searchPattern: string | RegExp | undefined = $state.raw(undefined)
  let messageTimeline = $state.raw(
    untrack(() => presentationSeed?.mentionColors ?? chatService.usernameColorTimelineMap)
  )
  let filteredTimeline = $state.raw(untrack(() => messageTimeline))
  const renderContext = $derived({ pattern: searchPattern, timeline: filteredTimeline })
  let initialPosition: { index: number; options: { align: 'center' } } | undefined = $state.raw()
  let searchInputRef: HTMLInputElement | null = $state(null)
  let vlistRef: TranscriptHandle | null = $state(null)
  let navigationGeneration = 0
  let positionedGeneration = -1
  let previousSearchSignature: string | undefined
  let historyRange: Promise<{ start: number; end: number }> | undefined

  onMount(() => {
    const stopWork = (): void => {
      lifetime.abort()
      fullController?.abort()
      pageController.abort()
      pager.dispose()
      navigationGeneration++
    }
    const updateQuery = (): void => {
      searchQuery = earlyInput!.value
    }
    if (earlyInput) earlyInput.addEventListener('input', updateQuery)
    else searchInputRef?.focus()
    window.addEventListener('pagehide', stopWork)
    window.api.onAppCacheCleared(handleAppCacheCleared)
    window.api.onSavedUrlsCleared(handleSavedUrlsCleared)
    if (!searchQuery && browsingMessages.length === 0) void loadPage('older')
    return () => {
      earlyInput?.removeEventListener('input', updateQuery)
      stopWork()
      window.removeEventListener('pagehide', stopWork)
      window.api.offAppCacheCleared(handleAppCacheCleared)
      window.api.offSavedUrlsCleared(handleSavedUrlsCleared)
    }
  })

  $effect(() => {
    deleteNullishKeysInPlace(reloadServicesFunctionMap)
  })

  function handleAppCacheCleared(): void {
    presentationSeed = undefined
    vlistRef?.clearCache?.()
    clearRendererCache(chatService, urlTracker)
    for (const reloadServicesFunction of Object.values(reloadServicesFunctionMap))
      reloadServicesFunction?.()
  }

  function handleSavedUrlsCleared(): void {
    clearRendererSavedUrls(urlTracker)
  }

  function createPager(
    seed: readonly TwitchMessage[],
    extra: readonly TwitchMessage[] = []
  ): SearchMessagePager {
    return new SearchMessagePager({
      sources: [context.initialMessages, context.loadedMessages, extra],
      preview: seed,
      history: {
        resolveRange: async (signal) => {
          historyRange ??= (async () => {
            if (context.searchRange)
              return { start: context.searchRange.startTime, end: context.searchRange.endTime }
            const currentTime = await window.api.getCurrentVideoTime(context.potplayerInfo.hwnd)
            const end = context.potplayerInfo.startTime + currentTime
            return { start: end - 60 * 60 * 1000, end }
          })().catch((error) => {
            historyRange = undefined
            throw error
          })
          const range = await historyRange
          signal.throwIfAborted()
          return range
        },
        fetchRange: (start, end, signal) => chatService.getMessagesInRange(start, end, signal)
      }
    })
  }

  function firstVisibleMessage(): TwitchMessage | undefined {
    if (!vlistRef || renderedMessages.length === 0) return undefined
    const top = vlistRef.getScrollOffset()
    let low = 0
    let high = renderedMessages.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (vlistRef.getItemOffset(middle) + vlistRef.getItemSize(middle) <= top) low = middle + 1
      else high = middle
    }
    return renderedMessages[low]
  }

  function changeSearchMode(query: string): void {
    if (!!query === !!previousQuery) {
      previousQuery = query
      return
    }
    previousQuery = query
    edgeInput = false
    pageController.abort()
    pageController = new AbortController()
    pagingDirection = null
    pageErrors = { older: '', newer: '' }
    if (query) {
      backgroundStarted = false
      return
    }
    fullController?.abort()
    fullController = undefined
    isLoading = false
    backgroundStarted = false
    loadError = ''
    loadingState.state = 'idle'
    const visible = firstVisibleMessage()
    browsingTarget = visible ?? context.focusedMessage
    const seed = visible
      ? selectSearchPreview(messages, context.loadedMessages, visible)
      : preview.messages
    pager.dispose()
    pager = createPager(seed, messages)
    browsingMessages = pager.messages
    // Keep the completed result's colors until the bounded neighborhood is rebuilt.
    browsingTimeline = filteredTimeline
    if (visible) {
      vlistRef?.preservePosition()
      scrolled = true
    }
    if (browsingMessages.length === 0) void loadPage('older')
  }

  async function loadPage(direction: SearchPageDirection): Promise<void> {
    if (searchQuery || pagingDirection || lifetime.signal.aborted || pager.isExhausted(direction))
      return
    const currentPager = pager
    const { signal } = pageController
    edgeInput = false
    pagingDirection = direction
    pageErrors[direction] = ''
    try {
      const next = await currentPager.page(direction, signal)
      signal.throwIfAborted()
      lifetime.signal.throwIfAborted()
      browsingMessages = next
    } catch (error) {
      if (signal.aborted || lifetime.signal.aborted) return
      pageErrors[direction] =
        error instanceof Error ? error.message : 'Unable to load chat messages.'
    } finally {
      if (!signal.aborted && currentPager === pager) pagingDirection = null
    }
  }

  function handleRangeChange(): void {
    if (
      searchQuery ||
      !edgeInput ||
      pagingDirection ||
      isFiltering ||
      isPublishing ||
      !vlistRef ||
      renderedMessages !== browsingMessages
    )
      return
    const top = vlistRef.getScrollOffset()
    const height = vlistRef.getViewportSize()
    const remaining = vlistRef.getScrollSize() - top - height
    const candidates: SearchPageDirection[] =
      remaining < top ? ['newer', 'older'] : ['older', 'newer']
    const direction = candidates.find(
      (side) =>
        (side === 'older' ? top : remaining) <= height &&
        !pageErrors[side] &&
        !pager.isExhausted(side)
    )
    if (direction) void loadPage(direction)
  }

  function handleUserInteraction(): void {
    scrolled = true
    navigationGeneration++
    edgeInput = true
    // Wheel input at an already reached boundary need not change the rendered range.
    requestAnimationFrame(() => {
      if (!lifetime.signal.aborted) handleRangeChange()
    })
  }

  async function publishMessages(
    next: readonly TwitchMessage[],
    signal: AbortSignal
  ): Promise<void> {
    await chatService.updateMessageDataCooperatively(next, signal)
    signal.throwIfAborted()
    messageTimeline = chatService.usernameColorTimelineMap
    messages = next
    completeDataset = true
  }

  function startBackgroundAfterPaint(): void {
    if (!searchQuery || backgroundStarted || lifetime.signal.aborted) return
    backgroundStarted = true
    // Publication precedes DOM updates. Two frames allow the bounded viewport
    // to paint before any full-history preparation starts on the shared thread.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        lifetime.signal.removeEventListener('abort', cancel)
        if (!lifetime.signal.aborted && searchQuery) void loadAllMessages()
      })
    })
    const cancel = (): void => cancelAnimationFrame(frame)
    lifetime.signal.addEventListener('abort', cancel, { once: true })
  }

  function handleTranscriptPublish(rows: readonly TwitchMessage[]): void {
    renderedMessages = rows
    if (rows === filteredMessages) startBackgroundAfterPaint()
  }

  async function loadAllMessages(): Promise<void> {
    if (!searchQuery || isLoading || lifetime.signal.aborted) return
    const controller = new AbortController()
    fullController = controller
    const { signal } = controller
    isLoading = true
    loadError = ''
    try {
      let potplayerInfo = context.potplayerInfo
      await chatService.updateVideoInfo(potplayerInfo, -1)
      signal.throwIfAborted()

      // Keep the source's objects and ordered snapshot shared across Search windows.
      const prepared = await sharedData.prepare(
        context.initialMessages,
        context.loadedMessages,
        signal
      )
      await publishMessages(prepared, signal)
      await new Promise((resolve) => setTimeout(resolve, 0))
      signal.throwIfAborted()

      if (!potplayerInfo?.hwnd) {
        const selectedHwnd = await window.api.getSelectedPotPlayerHWND()
        const instances = await window.api.getPotPlayers()
        signal.throwIfAborted()
        const potplayerInstance = instances.find((p) => p.hwnd === selectedHwnd)
        if (!potplayerInstance?.hwnd) {
          loadError = 'No PotPlayer instance is connected.'
          return
        }
        const resolvedPotplayerInfo = await window.api.getPotplayerExtraInfo(potplayerInstance)
        signal.throwIfAborted()
        if (!resolvedPotplayerInfo) {
          loadError = 'Recording information is unavailable.'
          return
        }
        potplayerInfo = resolvedPotplayerInfo
      }

      const videoStartTime = potplayerInfo.startTime
      const currentTime = await window.api.getCurrentVideoTime(potplayerInfo.hwnd)
      signal.throwIfAborted()
      const defaultStartTime = videoStartTime + currentTime - 60 * 60 * 1000
      const defaultEndTime = videoStartTime + currentTime
      const { startTime = defaultStartTime, endTime = defaultEndTime } = context.searchRange || {}
      if (!isRangeInMessages(context.initialMessages, startTime, endTime)) {
        await chatService.updateVideoInfo(potplayerInfo, 0)
        signal.throwIfAborted()
        const loaded = await chatService.getMessagesBetweenTimes(startTime, endTime)
        signal.throwIfAborted()
        const merged = await mergeSearchMessages(messages, loaded, signal)
        await publishMessages(merged, signal)
      }
    } catch (error) {
      if (signal.aborted || lifetime.signal.aborted) return
      loadError = error instanceof Error ? error.message : 'Unable to load chat messages.'
      console.error('Failed to load messages for search:', error)
    } finally {
      if (fullController === controller && !lifetime.signal.aborted) isLoading = false
    }
  }

  async function targetMessageIndex(
    results: readonly TwitchMessage[],
    signal: AbortSignal,
    initial: readonly TwitchMessage[] = context.initialMessages
  ): Promise<number | null> {
    if (results.length === 0) return null
    const focused = searchQuery ? context.focusedMessage : browsingTarget
    if (focused) {
      return (
        findMessageIndex(results, focused.getId(), focused.timestamp) ??
        getClosestMessageIndex(results, focused.timestamp)
      )
    }
    if (initial.length === 0) return results.length - 1
    // Walk backward without a reversed array or a full timestamp allocation.
    const work = new CooperativeWork(signal)
    for (let i = initial.length - 1; i >= 0; i--) {
      const message = initial[i]!
      const index = findMessageIndex(results, message.getId(), message.timestamp)
      if (index !== null) return index
      const pause = work.checkpoint()
      if (pause) await pause
    }
    return getClosestMessageIndex(results, initial[initial.length - 1]!.timestamp)
  }

  // One pipeline owns filtering, highlight publication, and subsequent navigation.
  $effect(() => {
    const query = searchQuery
    const sensitive = caseSensitive
    const regex = useRegex
    const controller = new AbortController()
    const signature = query ? JSON.stringify([query, sensitive, regex]) : ''
    if (signature !== previousSearchSignature) {
      previousSearchSignature = signature
      navigationGeneration++
      scrolled = false
    }
    untrack(() => changeSearchMode(query))
    const dataset = query ? messages : browsingMessages
    const complete = query ? completeDataset : true
    const timeline = query ? messageTimeline : browsingTimeline
    const generation = navigationGeneration
    const pattern = getSearchPattern(query, sensitive, regex)
    isFiltering = true
    void (async () => {
      try {
        let publishedTimeline = timeline
        if (!query) {
          // A cold preview has no captured mention colors. Prepare only admitted
          // rows, keeping source colors as fallback for mentions before this slice.
          await chatService.updateMessageDataCooperatively(dataset, controller.signal)
          const colors = chatService.usernameColorTimelineMap
          publishedTimeline = {
            get: (username, timestamp) =>
              colors.get(username, timestamp) ?? timeline.get(username, timestamp)
          }
        }
        const results = await filterSearchMessages(
          dataset,
          query,
          sensitive,
          regex,
          pattern,
          sharedData.textCache,
          controller.signal
        )
        const target =
          scrolled || positionedGeneration === generation
            ? null
            : await targetMessageIndex(
                results,
                controller.signal,
                complete ? context.initialMessages : preview.messages
              )
        controller.signal.throwIfAborted()
        lifetime.signal.throwIfAborted()
        // Results and their highlighting/color data always describe the same completed query.
        filteredMessages = results
        searchPattern = pattern
        filteredTimeline = publishedTimeline
        completeResults = complete
        if (results.length > 0) transcriptStarted = true
        const canPosition = !scrolled && generation === navigationGeneration && target !== null
        initialPosition = canPosition ? { index: target, options: { align: 'center' } } : undefined
        isFiltering = false
        if (canPosition) positionedGeneration = generation
        startBackgroundAfterPaint()
        await tick()
        if (
          !controller.signal.aborted &&
          !lifetime.signal.aborted &&
          !scrolled &&
          generation === navigationGeneration &&
          target !== null
        ) {
          vlistRef?.scrollToIndex(target, { align: 'center' })
        }
      } catch (error) {
        if (controller.signal.aborted || lifetime.signal.aborted) return
        isFiltering = false
        loadError = error instanceof Error ? error.message : 'Unable to search chat messages.'
        console.error('Failed to filter search messages:', error)
        startBackgroundAfterPaint()
      }
    })()
    return () => controller.abort()
  })

  function activateResult(event: MouseEvent, message: TwitchMessage): void {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, [role="button"]')
    )
      return
    if (window.getSelection()?.toString()) return
    context.focusMessage(message)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.isComposing) window.close()
  }

  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }
</script>

<LinkPreview />

<div class="search-container" role="presentation" onkeydown={handleKeydown}>
  <header class="search-header" class:with-early-input={!!earlyInput}>
    {#if !earlyInput}
      <input
        bind:this={searchInputRef}
        bind:value={searchQuery}
        type="search"
        aria-label="Search messages and usernames"
        placeholder="Search messages and usernames…"
        class="search-input"
      />
    {/if}
    <div class="search-options">
      <label><input type="checkbox" bind:checked={caseSensitive} /> Case sensitive</label>
      <label><input type="checkbox" bind:checked={useRegex} /> Regular expression</label>
    </div>
    <div class="search-context">
      <span class="recording-context" title={context.potplayerInfo.title}>
        {context.potplayerInfo.channel} · {context.potplayerInfo.title}
      </span>
      <span class="search-stats" role="status"
        >{#if !searchQuery}{filteredMessages.length} messages loaded{#if pagingDirection}
            · Loading {pagingDirection}…{/if}{:else if isFiltering || isPublishing || (!completeResults && !loadError)}Searching…{:else if completeResults}{filteredMessages.length}
          result{filteredMessages.length !== 1 ? 's' : ''}{:else}Partial history{/if}</span
      >
    </div>
  </header>

  {#if searchQuery && (loadError || loadingState.state === 'error')}
    <div class="load-notice" role="alert">
      <span>{loadError || loadingState.errorMessage || 'Unable to load chat messages.'}</span>
      <button type="button" disabled={isLoading} onclick={() => loadAllMessages()}>Retry</button>
    </div>
  {/if}

  {#if !searchQuery}
    {#each ['older', 'newer'] as const as direction (direction)}
      {#if pageErrors[direction]}
        <div class="load-notice" role="alert">
          <span>{pageErrors[direction]}</span>
          <button
            type="button"
            disabled={pagingDirection !== null}
            onclick={() => loadPage(direction)}>Retry {direction} messages</button
          >
        </div>
      {/if}
    {/each}
  {/if}

  <div
    class="search-results"
    aria-busy={pagingDirection !== null ||
      isLoading ||
      isFiltering ||
      isPublishing ||
      (!!searchQuery && !completeResults && !loadError)}
  >
    {#if transcriptStarted}
      <MessageTranscript
        bind:this={vlistRef}
        data={filteredMessages}
        {urlTracker}
        videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
        videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
        searchQuery={searchPattern}
        {renderContext}
        {presentationSeed}
        onpublish={handleTranscriptPublish}
        {initialPosition}
        gutter
        onuserinteraction={handleUserInteraction}
        onuserscroll={() => {
          edgeInput = true
          handleRangeChange()
        }}
        onrangechange={handleRangeChange}
      >
        {#snippet children(msg, i, presentationStore, renderedContext)}
          {#if msg}
            <div
              class="search-result-item"
              role="group"
              aria-label="Search result"
              onpointerup={(event) => {
                if (event.button === 0) activateResult(event, msg)
              }}
            >
              <button
                class="return-message"
                type="button"
                aria-label="Return to this message in chat"
                title="Return to message in chat"
                onclick={() => context.focusMessage(msg)}>↩</button
              >
              <ChatMessage
                {presentationStore}
                message={msg}
                videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
                videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
                {urlTracker}
                usernameColorTimelineMap={renderedContext?.timeline ?? undefined}
                searchQuery={renderedContext?.pattern}
                onUsernameClick={context.onUsernameClick}
                onUrlClick={handleUrlClick}
                bind:reloadServicesFunction={reloadServicesFunctionMap[i]}
              />
            </div>
          {/if}
        {/snippet}
      </MessageTranscript>
    {/if}
    {#if filteredMessages.length === 0}
      <div class="search-state" role="status">
        {#if pagingDirection || isLoading || isFiltering || (!!searchQuery && !completeResults && !loadError)}
          <strong>{searchQuery ? 'Searching…' : 'Loading messages…'}</strong>
        {:else if loadError || loadingState.state === 'error' || pageErrors.older || pageErrors.newer}
          <strong>Messages are unavailable</strong>
          <span>Retry when the recording or connection is available.</span>
        {:else if loadingState.state === 'chat-not-found'}
          <strong>No chat found for this recording</strong>
          <span>Check the recording information and chat source.</span>
        {:else if searchQuery}
          <strong>No messages found</strong>
          <span>Try different search terms.</span>
        {:else}
          <strong>No messages in this range</strong>
          <span>Open Search from a recording with loaded chat.</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .search-container {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--deck-bg);
    color: var(--deck-text);
  }
  .search-header {
    flex: none;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--deck-surface);
    border-bottom: 1px solid var(--deck-line);
  }
  .search-header.with-early-input {
    padding-top: 8px;
  }
  .search-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 12px;
  }
  .search-options label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .search-options input {
    margin: 0;
    accent-color: var(--deck-accent);
  }
  .search-context {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--deck-muted);
    font-size: 11px;
    line-height: 1.4;
  }
  .recording-context {
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-stats {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .search-results {
    position: relative;
    min-height: 0;
    flex: 1;
    width: 100%;
    overflow: hidden;
  }
  .search-result-item {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    padding: var(--deck-message-gap, 5px) 30px var(--deck-message-gap, 5px) 12px;
    cursor: pointer;
    user-select: text;
    overflow-wrap: anywhere;
    font-size: var(--deck-message-size, 13px);
    line-height: var(--deck-message-line-height, 1.45);
  }
  .search-result-item:hover,
  .search-result-item:focus-within {
    background: var(--deck-hover);
  }
  .return-message {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--deck-muted);
    opacity: 0;
    cursor: pointer;
  }
  .search-result-item:hover .return-message,
  .search-result-item:focus-within .return-message {
    opacity: 1;
  }
  .return-message:hover {
    background: var(--deck-selection);
    color: var(--deck-text);
  }
  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
  }
  .search-state {
    position: absolute;
    inset: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 24px;
    text-align: center;
    color: var(--deck-muted);
    font-size: 13px;
  }
  .search-state strong {
    font-weight: 600;
    color: var(--deck-text);
  }
  .load-notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--deck-line);
    font-size: 12px;
  }
  .load-notice span {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
  }
  .load-notice button {
    padding: 4px 8px;
    color: var(--deck-text);
    background: var(--deck-surface);
    border: 1px solid var(--deck-line);
    border-radius: 3px;
    cursor: pointer;
  }
  :global(mark) {
    background: var(--deck-selection);
    color: var(--deck-text);
    padding: 0 1px;
    border-radius: 2px;
  }
</style>
