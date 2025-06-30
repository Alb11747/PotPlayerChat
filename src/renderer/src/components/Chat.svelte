<script lang="ts">
  import {
    messages,
    potplayerInstances,
    setPotPlayerHwnd,
    loadingState,
    selectedPotplayerInfo
  } from '@/renderer/src/stores/chat-state.svelte'
  import { escapeHtml } from '@/utils/dom'
  import { formatRelativeTime } from '@/utils/strings'

  let isMainPotPlayer = $state(true)
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
    <div class="chat-messages">
      {#each messages as msg (msg.id)}
        <div class="chat-message">
          <span class="chat-time"
            >[{formatRelativeTime(msg.timestamp, selectedPotplayerInfo.videoStartTime)}]</span
          >
          <span class="chat-username" style="color: {msg.userColor}">{msg.username}:</span>
          <span class="chat-text">{escapeHtml(msg.message)}</span>
        </div>
      {/each}
    </div>
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
    display: flex;
    align-items: center;
    background: #23232b;
    color: #fff;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #333;
    font-size: 1rem;
  }

  .instances {
    display: flex;
    gap: 1rem;
  }
  .instances button {
    padding: 0 0.75rem;
    border: 1px solid #444;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: none;
    outline: none;
    min-width: 5rem;
    min-height: 0;
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
    background-color: #18181b;
    color: #efeff1;
    min-height: 80vh;
  }
  .chat-messages {
    min-height: 80vh;
    padding: 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    scrollbar-color: #333 #23232b;
    scrollbar-width: thin;
    height: 40%;
    box-sizing: border-box;
    overflow: auto;
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

  *::-webkit-scrollbar {
    width: 10px;
    background: #23232b;
  }
  *::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 6px;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: #4e8cff;
  }
</style>
