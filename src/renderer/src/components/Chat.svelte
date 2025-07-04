<script lang="ts">
  import type { TwitchChatMessage } from '@/chat/twitch-chat'
  import {
    chatService,
    loadingState,
    potplayerInstances,
    selectedPotplayerInfo,
    setPotPlayerHwnd,
    videoTimeHistory
  } from '@/renderer/src/stores/chat-state.svelte'
  import { parseMessage } from '@/utils/dom'
  import { formatRelativeTime } from '@/utils/strings'
  import { UrlTracker } from '@/utils/url-tracker'
  import { VList } from 'virtua/svelte'

  let messages: TwitchChatMessage[] = $state([])
  let isMainPotPlayer = $state(true)
  let vlistRef: VList | null = $state(null)
  let scrollToBottom = $state(true)
  let lastScrollOffset: number | null = $state(null)

  // Create URL tracker with bloom filter
  let urlTracker = $state(new UrlTracker())

  $effect(() => {
    const chatIntervalId = setInterval(async () => {
      const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
      if (predictedTime === null) return
      messages = await chatService.getMessagesForTime(predictedTime)
    }, 200)

    return () => {
      clearInterval(chatIntervalId)
    }
  })

  // Scroll to bottom when messages change
  $effect(() => {
    if (!vlistRef || !messages || messages.length === 0) return

    if (scrollToBottom) {
      vlistRef.scrollToIndex(messages.length - 1, { align: 'end', smooth: false })
    }
  })

  // Handle user scroll detection
  function handleScroll(currentScrollOffset: number): void {
    const scrolledUp = lastScrollOffset !== null ? currentScrollOffset < lastScrollOffset : false
    lastScrollOffset = currentScrollOffset

    // If the user scrolls up
    if (scrolledUp) {
      if (scrollToBottom) {
        // console.debug('User scrolled away from bottom, disabling auto-scroll')
        scrollToBottom = false
        return
      }
    }

    if (!vlistRef || !messages || messages.length === 0 || lastScrollOffset === null) return

    // Check if user is at the bottom
    const isAtBottom =
      vlistRef.getScrollOffset() + vlistRef.getViewportSize() >= vlistRef.getScrollSize()

    if (isAtBottom) {
      if (!scrollToBottom) {
        // console.debug('User scrolled to bottom, enabling auto-scroll')
        scrollToBottom = true
      }
    }
  }
</script>

<div class="topbar">
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
      getKey={(_, i) => i}
      initialTopMostItemIndex={messages.length - 1}
      onscroll={handleScroll}
    >
      {#snippet children(msg)}
        <div class="chat-message">
          <span class="chat-time"
            >[{formatRelativeTime(msg.timestamp, selectedPotplayerInfo.videoStartTime)}]</span
          >
          <span class="chat-username" style="color: {msg.userColor}">{msg.username}:</span>
          <span class="chat-text">
            {#each parseMessage(msg.message).entries() as [index, segment] ((msg.id, index))}
              {#if segment.type === 'url'}
                <button
                  class="chat-url"
                  class:visited={urlTracker.hasUrl(segment.content)}
                  onclick={() => {
                    urlTracker.addUrl(segment.content)
                    window.api.openUrl(segment.content)
                  }}
                  type="button"
                >
                  {segment.content}
                </button>
              {:else}
                {segment.content}
              {/if}
            {/each}
          </span>
        </div>
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
  .topbar {
    flex: 0 1 content;
    max-height: 5rem;
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
    height: calc(100vh - 5rem);
    background-color: #18181b;
    color: #efeff1;
    padding-bottom: 0.5rem;
    overflow: auto;
  }

  .chat-message {
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }

  .chat-time {
    color: #a9a9a9;
    margin-right: 0.5rem;
  }
  .chat-username {
    font-weight: bold;
  }
  .chat-text {
    white-space: pre-wrap;
  }

  .chat-url {
    color: #4e8cff;
    text-decoration: underline;
    cursor: pointer;
    transition: color 0.2s ease;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    display: inline;
  }

  .chat-url:hover {
    color: #6b9eff;
    text-decoration: none;
  }

  .chat-url.visited,
  .chat-url:focus-visible {
    color: #a855f7;
  }

  .system {
    color: #a9a9a9;
    font-style: italic;
  }
  .error {
    color: #ff4d4d;
    font-weight: bold;
  }
</style>
