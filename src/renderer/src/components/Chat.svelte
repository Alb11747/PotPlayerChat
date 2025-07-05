<script lang="ts">
  import type { TwitchChatMessage } from '@/chat/twitch-chat'
  import { CurrentVideoTimeHistory } from '@/utils/time'
  import { UrlTracker } from '@/utils/url-tracker'
  import { onMount } from 'svelte'
  import type { VList as VListType } from 'virtua/lib/svelte'
  import { VList } from 'virtua/svelte'
  import {
    chatService,
    loadingState,
    potplayerInstances,
    selectedPotplayerInfo,
    setPotPlayerHwnd
  } from '../stores/chat-state.svelte'
  import ChatMessage from './ChatMessage.svelte'

  let messages: TwitchChatMessage[] = $state([])
  let isMainPotPlayer = $state(true)
  let vlistRef: VListType<unknown> = $state(null)
  let scrollToBottom = $state(true)

  // Create URL tracker with bloom filter
  let urlTracker = $state(new UrlTracker())

  const videoTimeHistory = new CurrentVideoTimeHistory()
  window.api.onSetCurrentTime((_: Event, time: number) => {
    videoTimeHistory.addSample(time)
    updateChatMessages()
  })

  let chatIntervalId: ReturnType<typeof setTimeout> | null = null
  async function updateChatMessages(): Promise<void> {
    if (chatIntervalId) clearTimeout(chatIntervalId)

    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const newMessages = await chatService.getMessagesForTime(predictedTime, true)
    if (!newMessages || newMessages.length === 0) return
    const lastMessage = messages[messages.length - 1] || null
    const nextMessage =
      lastMessage && lastMessage.timestamp > predictedTime ? newMessages.pop() : null

    if (messages !== newMessages) {
      messages = newMessages
      if (scrollToBottom) vlistRef?.scrollTo(vlistRef.getScrollSize())
    }

    if (nextMessage) {
      const waitTime = videoTimeHistory.getPredictedTimeUntil(nextMessage.timestamp)
      // console.debug(`Waiting ${waitTime}ms before fetching next messages`)
      if (waitTime !== null) chatIntervalId = setTimeout(updateChatMessages, waitTime)
    }
  }

  onMount(() => {
    updateChatMessages()
    return () => {
      if (chatIntervalId) clearTimeout(chatIntervalId)
    }
  })

  // Handle user scroll detection
  function handleScroll(currentScrollOffset: number): void {
    if (!vlistRef || !messages || messages.length === 0) return

    // Check if user is at the bottom
    const isAtBottom =
      currentScrollOffset + vlistRef.getViewportSize() >= vlistRef.getScrollSize() - 1

    if (isAtBottom) {
      if (!scrollToBottom) {
        // console.debug('User scrolled to bottom, enabling auto-scroll')
        scrollToBottom = true
      }
    } else {
      if (scrollToBottom) {
        // console.debug('User scrolled away from bottom, disabling auto-scroll')
        scrollToBottom = false
      }
    }
  }

  // Handle URL click
  function handleUrlClick(url: string): void {
    urlTracker.addUrl(url)
    window.api.openUrl(url)
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'f') {
      event.preventDefault()
      window.api.openSearchWindow()
    }
  }

  // Set up keyboard listener
  $effect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="header" onkeydown={handleKeydown}>
  <div class="instances">
    <button
      class:main={isMainPotPlayer}
      onclick={() => {
        isMainPotPlayer = true
        setPotPlayerHwnd(null)
      }}
      aria-pressed={isMainPotPlayer}
      style="cursor: pointer;"
    >
      Main
    </button>

    {#each potplayerInstances as inst (inst.hwnd)}
      <button
        class:main={inst.hwnd === selectedPotplayerInfo.hwnd}
        onclick={() => {
          isMainPotPlayer = false
          setPotPlayerHwnd(inst.hwnd)
        }}
        aria-pressed={inst.hwnd === selectedPotplayerInfo.hwnd}
        style="cursor: pointer;"
      >
        {inst.title}
      </button>
    {/each}
  </div>
</div>

<div class="chat-container">
  {#if messages}
    <VList
      bind:this={vlistRef}
      data={messages}
      getKey={(_, i) => messages[i].id}
      initialTopMostItemIndex={messages.length - 1}
      shift={true}
      onscroll={handleScroll}
      ssrCount={20}
    >
      {#snippet children(msg)}
        <ChatMessage
          message={msg}
          videoStartTime={selectedPotplayerInfo.startTime}
          {urlTracker}
          onUrlClick={handleUrlClick}
          enablePreviews={true}
        />
      {/snippet}
    </VList>
  {:else if loadingState?.state === 'loading'}
    <div class="chat-message system">Loading chat...</div>
  {:else if loadingState?.state === 'error'}
    <div class="chat-message error">{loadingState.errorMessage}</div>
  {:else if loadingState?.state === 'channel-not-found'}
    <div class="chat-message system">Channel not found.</div>
  {:else}
    <div class="chat-message system">Unknown error occurred.</div>
  {/if}
</div>

<style>
  .header {
    flex: 0 1 auto;
    width: 100%;
    contain: content;
    align-items: center;
    background: #23232b;
    color: #fff;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid #333;
    font-size: 1rem;
  }

  .instances {
    display: flex;
    gap: 1rem;
    max-height: 4.5rem;
    scrollbar-width: thin;
  }
  .instances button {
    padding: 0 0.5rem;
    border: 1px solid #444;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: none;
    outline: none;
    min-width: 4.5rem;
    max-height: 4rem;
    overflow: auto;
    scrollbar-color: #333 #23232b;
    scrollbar-width: thin;
  }
  .instances button:hover {
    background: none;
    border-color: #2b4675;
  }
  .instances button.main {
    color: #4e8cff;
    font-weight: bold;
    background: none;
    border-color: #4e8cff;
  }

  .chat-container {
    flex: 1 1 auto;
    width: 100%;
    height: fit-content;
    background-color: #18181b;
    color: #efeff1;
    padding-bottom: 0.5rem;
    overflow: auto;
  }

  .system {
    color: #a9a9a9;
    font-style: italic;
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }

  .error {
    color: #ff4d4d;
    font-weight: bold;
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }
</style>
