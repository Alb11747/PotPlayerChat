<script lang="ts">
  import {
    loadingState,
    messages,
    potplayerInstances,
    selectedPotplayerInfo,
    setPotPlayerHwnd
  } from '@/renderer/src/stores/chat-state.svelte'
  import { escapeHtml } from '@/utils/dom'
  import { formatRelativeTime } from '@/utils/strings'
  import { VList } from 'virtua/svelte'

  let isMainPotPlayer = $state(true)
  let scrolledToBottom = $state(false)
  let vlistRef: VList | null = $state(null)

  // Scroll to bottom when messages change
  $effect(() => {
    if (!messages || messages.length === 0) {
      scrolledToBottom = false
    } else if (!scrolledToBottom && vlistRef) {
      scrolledToBottom = true
      vlistRef.scrollToIndex(messages.length - 1, { align: 'end', smooth: false })
    }
  })
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
    >
      {#snippet children(msg)}
        <div class="chat-message">
          <span class="chat-time"
            >[{formatRelativeTime(msg.timestamp, selectedPotplayerInfo.videoStartTime)}]</span
          >
          <span class="chat-username" style="color: {msg.userColor}">{msg.username}:</span>
          <span class="chat-text">{escapeHtml(msg.message)}</span>
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

  .system {
    color: #a9a9a9;
    font-style: italic;
  }
  .error {
    color: #ff4d4d;
    font-weight: bold;
  }
</style>
