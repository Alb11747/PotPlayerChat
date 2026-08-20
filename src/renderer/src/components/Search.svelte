<script lang="ts">
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import {
    formattedTwitchMessageFactory,
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
  import { regExpEscape } from '@/utils/strings'
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
  let loadedMessages = $state(false)
  let loadAllMessagesPromise: Promise<void> | null = null
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

  // Load all messages when component mounts
  $effect(() => {
    if (loadedMessages || loadAllMessagesPromise) return
    loadAllMessagesPromise = loadAllMessages().finally(() => {
      loadAllMessagesPromise = null
    })
  })

  // Focus search input when component mounts
  onMount(() => {
    if (searchInputRef) searchInputRef.focus()
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
    if (loadedMessages) return
    loadedMessages = true

    try {
      let potplayerInfo = context.potplayerInfo
      focusedMessage = context.focusedMessage ?? null
      await chatService.updateVideoInfo(potplayerInfo, -1)
      if (context.initialSearch) searchQuery = context.initialSearch

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
          console.error('No PotPlayer instance found')
          return
        }
        const resolvedPotplayerInfo = await window.api.getPotplayerExtraInfo(potplayerInstance)
        if (!resolvedPotplayerInfo) {
          console.error('No PotPlayer info available')
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
      loadedMessages = false
      console.error('Failed to load messages for search:', error)
    }
  }

  function loadMessages(msgs: TwitchMessage[]): void {
    // Merge new messages with existing ones
    for (const msg of msgs) {
      const formattedMsg = formattedTwitchMessageFactory(msg)
      if (seenMessages.has(formattedMsg.getId())) continue // Skip duplicates
      seenMessages.add(formattedMsg.getId())
      messages.push(formattedMsg)
    }

    // Sort messages by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp)

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

  // Computed search pattern for highlighting
  const searchPattern: string | RegExp | undefined = $derived.by(() => {
    if (!searchQuery) return undefined
    if (useRegex || !caseSensitive) {
      try {
        const escapedQuery = useRegex ? searchQuery : regExpEscape(searchQuery)
        return new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi')
      } catch (error) {
        // Invalid regex, fall back to string search
        console.warn('Invalid regex pattern:', searchQuery, error)
        return searchQuery
      }
    }
    return searchQuery
  })

  // Filter messages when search query changes
  $effect(() => {
    updateFilteredMessages()
  })
  async function updateFilteredMessages(): Promise<void> {
    if (!searchQuery) {
      filteredMessages = messages
      return
    }

    const regex =
      useRegex && searchPattern instanceof RegExp
        ? new RegExp(searchPattern.source, searchPattern.flags)
        : null
    filteredMessages = messages.filter((msg) => {
      if (regex) return regex.test(msg.formattedMessage)
      if (caseSensitive) return msg.formattedMessage?.includes(searchQuery)
      return msg.formattedMessage?.toLowerCase().includes(searchQuery.toLowerCase())
    })

    scrolled = false
    scrollToTargetMessages()
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
  <div class="search-header">
    <h2>Search Chat Messages</h2>
    <div class="search-input-container">
      <input
        bind:this={searchInputRef}
        bind:value={searchQuery}
        type="text"
        placeholder="Search messages and usernames..."
        class="search-input"
      />
      <div class="search-options">
        <label class="search-option">
          <input type="checkbox" bind:checked={caseSensitive} class="search-checkbox" />
          <span class="search-option-text">Case sensitive</span>
        </label>
        <label class="search-option">
          <input type="checkbox" bind:checked={useRegex} class="search-checkbox" />
          <span class="search-option-text">Regular expression</span>
        </label>
      </div>
      <div class="search-stats">
        {#if searchQuery}
          {filteredMessages.length} result{filteredMessages.length !== 1 ? 's' : ''} found
        {:else}
          Enter search terms above
        {/if}
      </div>
    </div>
  </div>

  <div class="search-results">
    {#if filteredMessages.length > 0}
      <VList
        bind:this={vlistRef}
        data={filteredMessages}
        getKey={(item, i) => item?.getId() ?? i}
        itemSize={80}
        onscroll={() => {
          scrolled = true
        }}
      >
        {#snippet children(msg, i)}
          {#if msg}
            <button
              type="button"
              class="search-result-item"
              onclick={() => context.focusMessage(msg)}
            >
              <ChatMessage
                message={msg}
                videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
                videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
                {urlTracker}
                usernameColorTimelineMap={chatService.usernameColorTimelineMap ?? undefined}
                searchQuery={searchPattern}
                onUrlClick={handleUrlClick}
                onEmoteLoad={() => {
                  if (scrolled) return
                  scrollToTargetMessages()
                }}
                bind:reloadServicesFunction={reloadServicesFunctionMap[i]}
              />
            </button>
          {/if}
        {/snippet}
      </VList>
    {:else if searchQuery && filteredMessages.length === 0}
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">No messages found</div>
        <div class="no-results-hint">Try different search terms</div>
      </div>
    {:else}
      <div class="search-placeholder">
        <div class="placeholder-icon">💬</div>
        <div class="placeholder-text">Start typing to search through chat messages</div>
        <div class="placeholder-hint">Search by message content or username</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .search-container {
    width: 100%;
    height: 100%;
    min-height: fit-content;
    background: var(--color-black-dark);
    color: var(--color-text-light);

    --header-height: 10.4rem;
  }

  .search-header {
    flex: 0 1 auto;
    max-height: var(--header-height);
    background: var(--color-black-soft);
    border-bottom: 1px solid var(--color-gray-4);
    padding: 15px;
  }
  .search-header h2 {
    margin: 0 0 16px 0;
    color: var(--color-text-light);
    font-size: 18px;
    font-weight: 600;
  }

  .search-input-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .search-input {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid var(--color-gray-5);
    border-radius: 6px;
    background: var(--color-bg-modal);
    color: var(--color-text-light);
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .search-input:focus {
    border-color: var(--color-accent);
  }

  .search-options {
    display: flex;
    gap: 16px;
    margin-top: 4px;
    padding-left: 4px;
  }
  .search-stats {
    font-size: 12px;
    color: var(--color-text-muted);
    padding-left: 4px;
  }

  .search-option {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-light);
  }

  .search-checkbox {
    width: 14px;
    height: 14px;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .search-option-text {
    user-select: none;
  }

  .search-results {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 16px;
    width: 100%;
    height: calc(100% - var(--header-height));
    overflow: visible;
  }

  .search-result-item {
    padding: 8px 14px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    min-width: 100%;
    width: fit-content;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-bg-hover);
    color: inherit;
  }
  .search-result-item:hover {
    background: var(--color-bg-hover);
  }

  .no-results,
  .search-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    height: 200px;
    padding: 40px;
  }

  .no-results-icon,
  .placeholder-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.9;
  }

  .no-results-text,
  .placeholder-text {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--color-text-light);
  }

  .no-results-hint,
  .placeholder-hint {
    font-size: 14px;
    color: var(--color-text-muted);
  }

  :global(mark) {
    background: var(--color-accent);
    color: var(--color-white);
    padding: 1px 2px;
    border-radius: 2px;
  }
</style>
