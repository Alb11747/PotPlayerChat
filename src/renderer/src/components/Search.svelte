<script lang="ts">
  import type { TwitchChatMessage } from '@/chat/twitch-chat'
  import type {} from '@/preload/types/index.d.ts'
  import { chatService, updateSelectedPotPlayerInfo } from '@/renderer/src/stores/chat-state.svelte'
  import type { HWND } from '@/types/globals'
  import { UrlTracker } from '@/utils/url-tracker'
  import { onMount } from 'svelte'
  import { VList } from 'virtua/svelte'
  import ChatMessage from './ChatMessage.svelte'

  let searchQuery = $state('')
  let caseSensitive = $state(false)
  let useRegex = $state(false)
  let messages: TwitchChatMessage[] & { formattedMessage: string } = $state([])
  let filteredMessages: TwitchChatMessage[] = $state([])
  let vlistRef: VList | null = $state(null)
  let searchInputRef: HTMLInputElement | null = $state(null)
  let selectedPotplayerInfo: { hwnd: HWND; title: string } | null = $state(null)
  let videoStartTime: number | null = $state(null)

  // Create URL tracker with bloom filter
  let urlTracker = $state(new UrlTracker())

  // Load all messages when component mounts
  onMount(loadAllMessages)

  // Focus search input when component mounts
  onMount(() => {
    if (searchInputRef) {
      searchInputRef.focus()
    }
  })

  async function loadAllMessages(): Promise<void> {
    try {
      const selectedPotplayerHwnd = await window.api.getSelectedPotPlayerHWND()
      const potplayerInstances = await window.api.getPotPlayers()
      selectedPotplayerInfo = potplayerInstances.find((p) => p.hwnd === selectedPotplayerHwnd)
      if (!selectedPotplayerInfo) {
        console.warn('No selected PotPlayer instance found')
        return
      }
      await updateSelectedPotPlayerInfo(selectedPotplayerInfo)
      videoStartTime = chatService.lastPotPlayerInfo?.startTime || null

      // Get a wide time range to capture all messages
      const currentTime = await window.api.getCurrentTime(selectedPotplayerInfo.hwnd)
      const msgs = await chatService.getMessagesAroundTime(
        currentTime,
        60 * 60 * 1000, // 1 hour before
        5 * 60 * 1000 // 5 minutes after
      )
      msgs.forEach((msg) => {
        msg.formattedMessage = `${msg.username || ''}: ${msg.message || ''}`
      })
      messages = msgs
    } catch (error) {
      console.error('Failed to load messages for search:', error)
    }
  }

  // Computed search pattern for highlighting
  let searchPattern = $derived.by(() => {
    if (!searchQuery.trim()) return undefined
    if (useRegex || !caseSensitive) {
      try {
        const escapedQuery = useRegex ? searchQuery : RegExp.escape(searchQuery)
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
    if (searchQuery.trim() === '') {
      filteredMessages = []
      return
    }

    filteredMessages = messages.filter((msg) => {
      if (useRegex) {
        try {
          const regex = new RegExp(searchQuery, caseSensitive ? 'g' : 'gi')
          return regex.test(msg.formattedMessage)
        } catch (error) {
          // Invalid regex, fall back to string search
          console.warn('Invalid regex pattern:', searchQuery, error)
        }
      }
      if (caseSensitive) {
        return msg.formattedMessage.includes(searchQuery)
      } else {
        return msg.formattedMessage.toLowerCase().includes(searchQuery.toLowerCase())
      }
    })
  })

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      window.close()
    }
  }

  function jumpToMessage(timestamp: number): void {
    // Send message to main window to jump to specific time
    window.api.jumpToTime?.(timestamp)
  }

  // Handle URL click
  function handleUrlClick(url: string): void {
    urlTracker.addUrl(url)
    window.api.openUrl(url)
  }
</script>

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
        {#if searchQuery.trim()}
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
        getKey={(_, i) => filteredMessages[i].getId()}
        itemSize={80}
      >
        {#snippet children(msg)}
          <button
            type="button"
            class="search-result-item"
            onclick={() => jumpToMessage(msg.timestamp)}
          >
            <ChatMessage
              message={msg}
              {videoStartTime}
              {urlTracker}
              searchQuery={searchPattern}
              onUrlClick={handleUrlClick}
              enablePreviews={true}
            />
          </button>
        {/snippet}
      </VList>
    {:else if searchQuery.trim() && filteredMessages.length === 0}
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
    background: #18181b;
    color: #efeff1;

    --header-height: 10.4rem;
  }

  .search-header {
    flex: 0 1 auto;
    max-height: var(--header-height);
    background: #23232b;
    border-bottom: 1px solid #333;
    padding: 15px;
  }
  .search-header h2 {
    margin: 0 0 16px 0;
    color: #efeff1;
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
    border: 1px solid #444;
    border-radius: 6px;
    background: #2d2d35;
    color: #efeff1;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .search-input:focus {
    border-color: #4e8cff;
  }

  .search-options {
    display: flex;
    gap: 16px;
    margin-top: 4px;
    padding-left: 4px;
  }
  .search-stats {
    font-size: 12px;
    color: #a9a9a9;
    padding-left: 4px;
  }

  .search-option {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: #efeff1;
  }

  .search-checkbox {
    width: 14px;
    height: 14px;
    accent-color: #4e8cff;
    cursor: pointer;
  }

  .search-option-text {
    user-select: none;
  }

  .search-results {
    flex: 1 1 auto;
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
    border-bottom: 1px solid #2d2d35;
    color: inherit;
  }
  .search-result-item:hover {
    background: #2d2d35;
  }

  .no-results,
  .search-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    text-align: center;
    padding: 40px;
  }

  .no-results-icon,
  .placeholder-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .no-results-text,
  .placeholder-text {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 8px;
    color: #efeff1;
  }

  .no-results-hint,
  .placeholder-hint {
    font-size: 14px;
    color: #a9a9a9;
  }

  :global(mark) {
    background: #4e8cff;
    color: white;
    padding: 1px 2px;
    border-radius: 2px;
  }
</style>
