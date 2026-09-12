<script lang="ts">
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import { getSearchPattern, filterSearchMessages } from '@/renderer/src/core/search-messages'
  import { SharedSearchDataCache, mergeSearchMessages } from '@/renderer/src/core/search-data'
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

  let { context }: { context: SearchContext } = $props()

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const urlTracker = new UrlTracker(settings.chat)
  // The context captures one recording and its source-owned caches for this popup's lifetime.
  const sharedData = untrack(() => context.sharedData ?? new SharedSearchDataCache())
  const lifetime = new AbortController()

  let searchQuery = $state('')
  let caseSensitive = $state(false)
  let useRegex = $state(false)
  let scrolled = false
  let isLoading = $state(false)
  let isFiltering = $state(false)
  let loadError = $state('')
  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})
  let messages: readonly TwitchMessage[] = $state.raw([])
  let filteredMessages: readonly TwitchMessage[] = $state.raw([])
  let searchPattern: string | RegExp | undefined = $state.raw(undefined)
  let messageTimeline = $state.raw(chatService.usernameColorTimelineMap)
  let filteredTimeline = $state.raw(chatService.usernameColorTimelineMap)
  const renderContext = $derived({ pattern: searchPattern, timeline: filteredTimeline })
  let initialPosition: { index: number; options: { align: 'center' } } | undefined = $state.raw()
  let searchInputRef: HTMLInputElement | null = $state(null)
  let vlistRef: TranscriptHandle | null = $state(null)
  let navigationGeneration = 0
  let previousSearchSignature: string | undefined

  onMount(() => {
    searchInputRef?.focus()
    searchQuery = context.initialSearch ?? ''
    void loadAllMessages()
    window.api.onAppCacheCleared(handleAppCacheCleared)
    window.api.onSavedUrlsCleared(handleSavedUrlsCleared)
    return () => {
      lifetime.abort()
      navigationGeneration++
      window.api.offAppCacheCleared(handleAppCacheCleared)
      window.api.offSavedUrlsCleared(handleSavedUrlsCleared)
    }
  })

  $effect(() => {
    deleteNullishKeysInPlace(reloadServicesFunctionMap)
  })

  function handleAppCacheCleared(): void {
    vlistRef?.clearCache?.()
    clearRendererCache(chatService, urlTracker)
    for (const reloadServicesFunction of Object.values(reloadServicesFunctionMap))
      reloadServicesFunction?.()
  }

  function handleSavedUrlsCleared(): void {
    clearRendererSavedUrls(urlTracker)
  }

  async function publishMessages(next: readonly TwitchMessage[]): Promise<void> {
    await chatService.updateMessageDataCooperatively(next, lifetime.signal)
    lifetime.signal.throwIfAborted()
    messageTimeline = chatService.usernameColorTimelineMap
    messages = next
  }

  async function loadAllMessages(): Promise<void> {
    if (isLoading || lifetime.signal.aborted) return
    isLoading = true
    loadError = ''
    try {
      let potplayerInfo = context.potplayerInfo
      await chatService.updateVideoInfo(potplayerInfo, -1)
      lifetime.signal.throwIfAborted()

      // Keep the source's objects and ordered snapshot shared across Search windows.
      const prepared = await sharedData.prepare(
        context.initialMessages,
        context.loadedMessages,
        lifetime.signal
      )
      await publishMessages(prepared)
      await new Promise((resolve) => setTimeout(resolve, 0))
      lifetime.signal.throwIfAborted()

      if (!potplayerInfo?.hwnd) {
        const selectedHwnd = await window.api.getSelectedPotPlayerHWND()
        const instances = await window.api.getPotPlayers()
        lifetime.signal.throwIfAborted()
        const potplayerInstance = instances.find((p) => p.hwnd === selectedHwnd)
        if (!potplayerInstance?.hwnd) {
          loadError = 'No PotPlayer instance is connected.'
          return
        }
        const resolvedPotplayerInfo = await window.api.getPotplayerExtraInfo(potplayerInstance)
        lifetime.signal.throwIfAborted()
        if (!resolvedPotplayerInfo) {
          loadError = 'Recording information is unavailable.'
          return
        }
        potplayerInfo = resolvedPotplayerInfo
      }

      const videoStartTime = potplayerInfo.startTime
      const currentTime = await window.api.getCurrentVideoTime(potplayerInfo.hwnd)
      lifetime.signal.throwIfAborted()
      const defaultStartTime = videoStartTime + currentTime - 60 * 60 * 1000
      const defaultEndTime = videoStartTime + currentTime
      const { startTime = defaultStartTime, endTime = defaultEndTime } = context.searchRange || {}
      if (!isRangeInMessages(context.initialMessages, startTime, endTime)) {
        await chatService.updateVideoInfo(potplayerInfo, 0)
        lifetime.signal.throwIfAborted()
        const loaded = await chatService.getMessagesBetweenTimes(startTime, endTime)
        lifetime.signal.throwIfAborted()
        const merged = await mergeSearchMessages(messages, loaded, lifetime.signal)
        await publishMessages(merged)
      }
    } catch (error) {
      if (lifetime.signal.aborted) return
      loadError = error instanceof Error ? error.message : 'Unable to load chat messages.'
      console.error('Failed to load messages for search:', error)
    } finally {
      if (!lifetime.signal.aborted) isLoading = false
    }
  }

  async function targetMessageIndex(
    results: readonly TwitchMessage[],
    signal: AbortSignal
  ): Promise<number | null> {
    if (results.length === 0) return null
    const focused = context.focusedMessage
    if (focused) {
      return (
        findMessageIndex(results, focused.getId(), focused.timestamp) ??
        getClosestMessageIndex(results, focused.timestamp)
      )
    }
    const initial = context.initialMessages
    if (initial.length === 0) return null
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
    const dataset = messages
    const timeline = messageTimeline
    const query = searchQuery
    const sensitive = caseSensitive
    const regex = useRegex
    const controller = new AbortController()
    const signature = JSON.stringify([query, sensitive, regex])
    if (signature !== previousSearchSignature) {
      previousSearchSignature = signature
      navigationGeneration++
      scrolled = false
    }
    const generation = navigationGeneration
    const pattern = getSearchPattern(query, sensitive, regex)
    isFiltering = true
    void (async () => {
      try {
        const results = await filterSearchMessages(
          dataset,
          query,
          sensitive,
          regex,
          pattern,
          sharedData.textCache,
          controller.signal
        )
        const target = scrolled ? null : await targetMessageIndex(results, controller.signal)
        controller.signal.throwIfAborted()
        lifetime.signal.throwIfAborted()
        // Results and their highlighting/color data always describe the same completed query.
        filteredMessages = results
        searchPattern = pattern
        filteredTimeline = timeline
        const canPosition = !scrolled && generation === navigationGeneration && target !== null
        initialPosition = canPosition ? { index: target, options: { align: 'center' } } : undefined
        isFiltering = false
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
    if (event.key === 'Escape') window.close()
  }

  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }
</script>

<LinkPreview />

<div class="search-container" role="presentation" onkeydown={handleKeydown}>
  <header class="search-header">
    <input
      bind:this={searchInputRef}
      bind:value={searchQuery}
      type="search"
      aria-label="Search messages and usernames"
      placeholder="Search messages and usernames…"
      class="search-input"
    />
    <div class="search-options">
      <label><input type="checkbox" bind:checked={caseSensitive} /> Case sensitive</label>
      <label><input type="checkbox" bind:checked={useRegex} /> Regular expression</label>
    </div>
    <div class="search-context">
      <span class="recording-context" title={context.potplayerInfo.title}>
        {context.potplayerInfo.channel} · {context.potplayerInfo.title}
      </span>
      <span class="search-stats" role="status"
        >{filteredMessages.length} result{filteredMessages.length !== 1 ? 's' : ''}</span
      >
    </div>
  </header>

  {#if loadError || loadingState.state === 'error'}
    <div class="load-notice" role="alert">
      <span>{loadError || loadingState.errorMessage || 'Unable to load chat messages.'}</span>
      <button type="button" disabled={isLoading} onclick={() => loadAllMessages()}>Retry</button>
    </div>
  {/if}

  <div class="search-results" aria-busy={isLoading || isFiltering}>
    {#if filteredMessages.length > 0}
      <MessageTranscript
        bind:this={vlistRef}
        data={filteredMessages}
        {urlTracker}
        videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
        videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
        searchQuery={searchPattern}
        {renderContext}
        {initialPosition}
        gutter
        onuserinteraction={() => {
          scrolled = true
          navigationGeneration++
        }}
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
    {:else}
      <div class="search-state" role="status">
        {#if isLoading || isFiltering}
          <strong>Loading chat messages…</strong>
        {:else if loadError || loadingState.state === 'error'}
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
  .search-input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid var(--deck-line);
    border-radius: 4px;
    background: var(--deck-bg);
    color: var(--deck-text);
    font: inherit;
    font-size: 13px;
  }
  .search-input::placeholder {
    color: var(--deck-muted);
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
