<script lang="ts">
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import {
    formattedTwitchMessageFactory,
    getSearchPattern,
    filterSearchMessages,
    type TwitchMessageFormatted
  } from '@/renderer/src/core/search-messages'
  import type { SearchContext } from '@/renderer/src/core/search-window'
  import {
    findIntersectingMessageIndex,
    findMessageIndex,
    getClosestMessageIndex,
    isRangeInMessages
  } from '@/utils/chat'
  import { deleteNullishKeysInPlace } from '@/utils/objects'
  import { onMount } from 'svelte'
  import { VList } from 'virtua/svelte'
  import LinkPreview from '../components/LinkPreview.svelte'
  import { clearRendererCache, clearRendererSavedUrls } from '../core/maintenance'
  import { UrlTracker } from '../core/url-tracker'
  import { settings } from '../state/settings.svelte'
  import ChatMessage from './ChatMessage.svelte'

  let { context }: { context: SearchContext } = $props()

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)

  const urlTracker = new UrlTracker(settings.chat)

  let searchQuery = $state('')
  let caseSensitive = $state(false)
  let useRegex = $state(false)

  let scrolled = $state(false)
  let isLoading = $state(false)
  let loadError = $state('')
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seenMessages = new Set<string>()
  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})
  let focusedMessage = $state<TwitchMessage | null>(null)
  let initialMessages = $state.raw<TwitchMessage[] | null>(null)
  let messages: TwitchMessageFormatted[] = $state.raw([])
  let filteredMessages: TwitchMessageFormatted[] = $state.raw([])

  const initialMessageMinTimestamp = $derived(
    initialMessages && initialMessages.length > 0
      ? Math.min(...initialMessages.map((msg) => msg.timestamp))
      : 0
  )
  const initialMessageMaxTimestamp = $derived(
    initialMessages && initialMessages.length > 0
      ? Math.max(...initialMessages.map((msg) => msg.timestamp))
      : 0
  )

  let searchInputRef: HTMLInputElement | null = $state(null)
  let vlistRef: VList<TwitchMessageFormatted> | null = $state(null)

  // Focus search input when component mounts
  onMount(() => {
    if (searchInputRef) searchInputRef.focus()
    searchQuery = context.initialSearch ?? ''
    void loadAllMessages()
    window.api.onAppCacheCleared(handleAppCacheCleared)
    window.api.onSavedUrlsCleared(handleSavedUrlsCleared)
    return () => {
      window.api.offAppCacheCleared(handleAppCacheCleared)
      window.api.offSavedUrlsCleared(handleSavedUrlsCleared)
    }
  })

  $effect(() => {
    deleteNullishKeysInPlace(reloadServicesFunctionMap)
  })

  function handleAppCacheCleared(): void {
    clearRendererCache(chatService, urlTracker)
    for (const reloadServicesFunction of Object.values(reloadServicesFunctionMap))
      reloadServicesFunction?.()
  }

  function handleSavedUrlsCleared(): void {
    clearRendererSavedUrls(urlTracker)
  }

  async function loadAllMessages(): Promise<void> {
    if (isLoading) return
    isLoading = true
    loadError = ''

    try {
      let potplayerInfo = context.potplayerInfo
      focusedMessage = context.focusedMessage ?? null
      await chatService.updateVideoInfo(potplayerInfo, -1)

      if (focusedMessage) console.debug('Focused message:', focusedMessage)

      if (context.initialMessages.length > 0) {
        console.debug('Initial messages:', context.initialMessages.length)
        initialMessages = context.initialMessages
        loadMessages(context.initialMessages)
        scrollToTargetMessages()
      }

      await new Promise((resolve) => setTimeout(resolve, 0))

      if (context.loadedMessages.length > 0) {
        console.debug('Preloaded messages:', context.loadedMessages.length)
        loadMessages(context.loadedMessages)
        scrollToTargetMessages()
      }

      if (!potplayerInfo?.hwnd) {
        const selectedHwnd = await window.api.getSelectedPotPlayerHWND()
        const instances = await window.api.getPotPlayers()
        const potplayerInstance = instances.find((p) => p.hwnd === selectedHwnd)
        if (!potplayerInstance?.hwnd) {
          loadError = 'No PotPlayer instance is connected.'
          return
        }
        const resolvedPotplayerInfo = await window.api.getPotplayerExtraInfo(potplayerInstance)
        if (!resolvedPotplayerInfo) {
          loadError = 'Recording information is unavailable.'
          return
        }
        potplayerInfo = resolvedPotplayerInfo
      }

      const videoStartTime = potplayerInfo.startTime
      const currentTime = await window.api.getCurrentVideoTime(potplayerInfo.hwnd)
      const defaultStartTime = videoStartTime + currentTime - 60 * 60 * 1000 // 1 hour before
      const defaultEndTime = videoStartTime + currentTime
      const { startTime = defaultStartTime, endTime = defaultEndTime } = context.searchRange || {}

      if (!initialMessages || !isRangeInMessages(initialMessages, startTime, endTime)) {
        await chatService.updateVideoInfo(potplayerInfo, 0)
        const loadedMsgs = await chatService.getMessagesBetweenTimes(startTime, endTime)

        console.debug('Loaded messages:', loadedMsgs.length)
        loadMessages(loadedMsgs)
        scrollToTargetMessages()
      }
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Unable to load chat messages.'
      console.error('Failed to load messages for search:', error)
    } finally {
      isLoading = false
    }
  }

  function loadMessages(msgs: TwitchMessage[]): void {
    const additions: TwitchMessageFormatted[] = []
    for (const msg of msgs) {
      const formattedMsg = formattedTwitchMessageFactory(msg)
      if (seenMessages.has(formattedMsg.getId())) continue // Skip duplicates
      seenMessages.add(formattedMsg.getId())
      additions.push(formattedMsg)
    }
    if (additions.length === 0) return

    // Raw state and the virtual transcript observe array identity, including an empty query.
    messages = [...messages, ...additions].sort((a, b) => a.timestamp - b.timestamp)

    // Update message data
    chatService.updateMessageData(messages)

    // Update filtered messages
    updateFilteredMessages()
  }

  function scrollToTargetMessages(): void {
    setTimeout(() => {
      if (!vlistRef || !filteredMessages || filteredMessages.length === 0) return

      let targetElementIndex = null

      if (focusedMessage) {
        targetElementIndex = findMessageIndex(
          filteredMessages,
          focusedMessage.getId(),
          focusedMessage.timestamp
        )

        if (targetElementIndex === null) {
          targetElementIndex = getClosestMessageIndex(filteredMessages, focusedMessage.timestamp)
        }
      } else if (initialMessages && initialMessages.length > 0) {
        targetElementIndex = findIntersectingMessageIndex(
          filteredMessages,
          initialMessages,
          initialMessageMinTimestamp,
          initialMessageMaxTimestamp,
          true
        )

        if (targetElementIndex === null) {
          targetElementIndex = getClosestMessageIndex(
            filteredMessages,
            initialMessages[initialMessages.length - 1]!.timestamp
          )
        }
      }

      if (targetElementIndex === null) return
      vlistRef.scrollToIndex(targetElementIndex, { align: 'center' })
    }, 0)
  }

  const searchPattern = $derived(getSearchPattern(searchQuery, caseSensitive, useRegex))

  $effect(() => {
    updateFilteredMessages()
  })

  function updateFilteredMessages(): void {
    filteredMessages = filterSearchMessages(
      messages,
      searchQuery,
      caseSensitive,
      useRegex,
      searchPattern
    )
    scrolled = false
    scrollToTargetMessages()
  }

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

  // Handle URL click
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

  <div class="search-results" aria-busy={isLoading}>
    {#if filteredMessages.length > 0}
      <VList
        bind:this={vlistRef}
        data={filteredMessages}
        getKey={(item, i) => item?.getId() ?? i}
        itemSize={48}
        onscroll={() => {
          scrolled = true
        }}
      >
        {#snippet children(msg, i)}
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
                message={msg}
                videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
                videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
                {urlTracker}
                usernameColorTimelineMap={chatService.usernameColorTimelineMap ?? undefined}
                searchQuery={searchPattern}
                onUsernameClick={context.onUsernameClick}
                onUrlClick={handleUrlClick}
                onEmoteLoad={() => {
                  if (!scrolled) scrollToTargetMessages()
                }}
                bind:reloadServicesFunction={reloadServicesFunctionMap[i]}
              />
            </div>
          {/if}
        {/snippet}
      </VList>
    {:else}
      <div class="search-state" role="status">
        {#if isLoading}
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
