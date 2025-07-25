<script lang="ts">
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import {
    convertRawIrcMessagesToTwitchMessages,
    TwitchChatMessage,
    TwitchSystemMessage,
    type TwitchMessage
  } from '@/core/chat/twitch-msg'
  import type {} from '@/types/preload'
  import { isRangeInMessages } from '@/utils/chat'
  import { regExpEscape } from '@/utils/strings'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { VList } from 'virtua/svelte'
  import LinkPreview from '../components/LinkPreview.svelte'
  import { settings } from '../state/settings.svelte'
  import { UrlTracker } from '../state/url-tracker'
  import ChatMessage from './ChatMessage.svelte'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)

  if (!chatService.usernameColorCache)
    chatService.usernameColorCache = new SvelteMap<string, { color: string; timestamp: number }>()

  type TwitchMessageFormatted = TwitchMessage & { formattedMessage: string }
  function formattedTwitchMessageFactory(msg: TwitchMessage): TwitchMessageFormatted {
    if (msg.type === 'chat') {
      const newObj = Object.create(TwitchChatMessage.prototype)
      Object.assign(newObj, msg)
      newObj.formattedMessage = `${msg.username}: ${msg.message}`
      return newObj
    } else if (msg.type === 'system') {
      const newObj = Object.create(TwitchSystemMessage.prototype)
      Object.assign(newObj, msg)
      newObj.formattedMessage = newObj.getSystemText()
      return newObj
    }
    throw new Error('Invalid message type')
  }

  const urlTracker = new UrlTracker(settings.chat)

  let searchQuery = $state('')
  let caseSensitive = $state(false)
  let useRegex = $state(false)

  let loadedMessages = $state(false)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seenMessages = new Set<string>()
  let initialMessages: TwitchMessage[] = $state.raw([])
  let messages: TwitchMessageFormatted[] = $state.raw([])
  let filteredMessages: TwitchMessageFormatted[] = $state.raw([])

  const initialMessageIds = $derived.by(() => new Set(initialMessages.map((msg) => msg.getId())))

  let searchInputRef: HTMLInputElement | null = $state(null)
  let vlistRef: VList<TwitchMessageFormatted> | null = $state(null)

  // Load all messages when component mounts
  $effect(() => {
    loadAllMessages()
  })

  // Focus search input when component mounts
  onMount(() => {
    if (searchInputRef) searchInputRef.focus()
  })

  async function loadAllMessages(): Promise<void> {
    if (vlistRef && loadedMessages) return
    loadedMessages = true

    try {
      const searchInfo = await window.api.getSearchInfo()
      if (!searchInfo) {
        console.error('No search info available')
        return
      }

      await chatService.updateVideoInfo(searchInfo.potplayerInfo, -1)
      if (searchInfo.initialSearch) searchQuery = searchInfo.initialSearch

      const dec = new TextDecoder()

      if (searchInfo.initialMessagesRaw) {
        const initialMsgs = convertRawIrcMessagesToTwitchMessages(
          dec.decode(searchInfo.initialMessagesRaw as unknown as ArrayBuffer)
        )
        console.debug('Initial messages:', initialMsgs.length)
        initialMessages = initialMsgs
        loadMessages(initialMsgs)
        scrollToInitialMessages()
      }

      await new Promise((resolve) => setTimeout(resolve, 0))

      const messagesRaw = await window.api.getMessagesRaw()
      if (messagesRaw) {
        const messages = convertRawIrcMessagesToTwitchMessages(
          dec.decode(messagesRaw as unknown as ArrayBuffer)
        )
        console.debug('Preloaded messages:', messages.length)
        loadMessages(messages)
        scrollToInitialMessages()
      }

      if (!searchInfo.potplayerInfo?.hwnd) {
        const selectedHwnd = await window.api.getSelectedPotPlayerHWND()
        const instances = await window.api.getPotPlayers()
        const potplayerInstance = instances.find((p) => p.hwnd === selectedHwnd)
        if (!potplayerInstance?.hwnd) {
          console.error('No PotPlayer instance found')
          return
        }
        const potplayerInfo = await window.api.getPotplayerExtraInfo(potplayerInstance)
        if (!potplayerInfo) {
          console.error('No PotPlayer info available')
          return
        }
        searchInfo.potplayerInfo = potplayerInfo
      }

      const videoStartTime = searchInfo.potplayerInfo.startTime
      const currentTime = await window.api.getCurrentVideoTime(searchInfo.potplayerInfo.hwnd)
      const defaultStartTime = videoStartTime + currentTime - 60 * 60 * 1000 // 1 hour before
      const defaultEndTime = videoStartTime + currentTime
      const { startTime = defaultStartTime, endTime = defaultEndTime } =
        searchInfo.searchRange || {}

      if (!isRangeInMessages(initialMessages, startTime, endTime)) {
        await chatService.updateVideoInfo(searchInfo.potplayerInfo, 0)
        const loadedMsgs = await chatService.getMessagesBetweenTimes(startTime, endTime)

        console.debug('Loaded messages:', loadedMsgs.length)
        loadMessages(loadedMsgs)
        scrollToInitialMessages()
      }
    } catch (error) {
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

    // Update filtered messages
    updateFilteredMessages()
  }

  function scrollToInitialMessages(): void {
    setTimeout(() => {
      if (!vlistRef || !filteredMessages || filteredMessages.length === 0) return
      const targetElementIndex = filteredMessages.findLastIndex((msg) =>
        initialMessageIds.has(msg.getId())
      )
      if (targetElementIndex === -1) return
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
      filteredMessages = []
      return
    }

    filteredMessages = messages.filter((msg) => {
      if (useRegex && typeof searchPattern === 'object')
        return searchPattern.test(msg.formattedMessage)
      if (caseSensitive) return msg.formattedMessage?.includes(searchQuery)
      return msg.formattedMessage?.toLowerCase().includes(searchQuery.toLowerCase())
    })

    scrollToInitialMessages()
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
        getKey={(_, i) => filteredMessages[i]?.getId() ?? i}
        itemSize={80}
      >
        {#snippet children(msg)}
          <button type="button" class="search-result-item">
            <ChatMessage
              message={msg}
              videoStartTime={chatService?.currentPotPlayerInfo?.startTime}
              videoEndTime={chatService?.currentPotPlayerInfo?.endTime}
              {urlTracker}
              usernameColorMap={chatService.usernameColorCache ?? undefined}
              searchQuery={searchPattern}
              onUrlClick={handleUrlClick}
            />
          </button>
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
