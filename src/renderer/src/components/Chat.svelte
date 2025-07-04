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
  import { linkPreviewService, type LinkPreview } from '@/utils/link-preview'
  import { formatRelativeTime } from '@/utils/strings'
  import { UrlTracker } from '@/utils/url-tracker'
  import sanitizeHtml from 'sanitize-html'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { VList } from 'virtua/svelte'

  let messages: TwitchChatMessage[] = $state([])
  let isMainPotPlayer = $state(true)
  let vlistRef: VList | null = $state(null)
  let scrollToBottom = $state(true)
  let lastScrollOffset: number | null = $state(null)

  // Create URL tracker with bloom filter
  let urlTracker = $state(new UrlTracker())

  // Link preview state
  // svelte-ignore non_reactive_update
  let linkPreviews = new SvelteMap<string, LinkPreview>()
  let failedPreviews = new SvelteSet<string>()
  let showPreviewForUrl = $state<string | null>(null)

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

  // Handle URL click with preview fetching
  async function handleUrlClick(url: string): Promise<void> {
    urlTracker.addUrl(url)
    window.api.openUrl(url)
  }

  // Handle URL hover to preload preview
  async function handleUrlHover(url: string): Promise<void> {
    if (!linkPreviews.has(url) && !linkPreviewService.isLoading(url)) {
      const preview = await linkPreviewService.getPreview(url)
      if (preview) {
        linkPreviews.set(url, preview)
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
                  onclick={() => handleUrlClick(segment.content)}
                  onmouseenter={() => {
                    handleUrlHover(segment.content)
                    showPreviewForUrl = segment.content
                  }}
                  onmouseleave={() => {
                    showPreviewForUrl = null
                  }}
                  type="button"
                >
                  {segment.content}
                </button>
                {#if showPreviewForUrl === segment.content}
                  {#if linkPreviews.has(segment.content)}
                    {#each [linkPreviews.get(segment.content)] as preview ((msg.id, index, preview?.link))}
                      {#if preview && preview.status === 200}
                        <div class="link-preview" role="dialog" tabindex="0" aria-modal="true">
                          {#if preview.thumbnail}
                            {#if !failedPreviews.has(preview.link)}
                              <img
                                src={preview.thumbnail}
                                onerror={() => {
                                  failedPreviews.add(preview.link)
                                }}
                                alt="Link preview"
                                class="preview-thumbnail"
                              />
                            {:else}
                              <span class="preview-error-text">Image failed to load</span>
                            {/if}
                          {/if}
                          <div class="preview-content">
                            {#if preview.tooltip}
                              <div class="preview-tooltip">
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                {@html sanitizeHtml(preview.tooltip)}
                              </div>
                            {/if}
                            <div class="preview-url">{preview.link}</div>
                          </div>
                        </div>
                      {:else if preview && preview.status === 0}
                        <div
                          class="link-preview link-preview-error"
                          role="dialog"
                          tabindex="0"
                          aria-modal="true"
                        >
                          <div class="preview-error-content">
                            <div class="preview-error-icon">⚠️</div>
                            <div class="preview-error-text">Failed to load preview</div>
                            <div class="preview-url">{preview.link}</div>
                          </div>
                        </div>
                      {/if}
                    {/each}
                  {:else if linkPreviewService.isLoading(segment.content)}
                    <div
                      class="link-preview link-preview-loading"
                      role="dialog"
                      tabindex="0"
                      aria-modal="true"
                    >
                      <div class="preview-loading-content">
                        <div class="preview-loading-spinner">⏳</div>
                        <div class="preview-loading-text">Loading preview...</div>
                        <div class="preview-url">{segment.content}</div>
                      </div>
                    </div>
                  {/if}
                {/if}
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

  .link-preview {
    position: absolute;
    z-index: 1000;
    background: #2d2d35;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 400px;
    margin-top: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .link-preview-loading {
    border-color: #4e8cff;
    background: #1f2a3d;
  }
  .link-preview-error {
    border-color: #ff4d4d;
    background: #2d1f1f;
  }
  .preview-loading-content {
    padding: 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .preview-error-icon,
  .preview-error-content,
  .preview-loading-spinner {
    font-size: 24px;
  }
  .preview-loading-spinner {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .preview-error-text {
    margin-top: 2rem;
    color: #ff6b6b;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    justify-content: center;
    display: flex;
    align-items: center;
  }
  .preview-loading-text {
    color: #6b9eff;
    font-size: 14px;
    font-weight: 500;
  }
  .preview-thumbnail {
    width: 100%;
    height: 200px;
    object-fit: contain;
    display: block;
  }
  .preview-content {
    padding: 12px;
    flex: 1;
  }
  .preview-tooltip {
    color: #efeff1;
    font-size: 12px;
    line-height: 0.8;
    white-space: pre-wrap;
    padding: 2px 0;
  }
  .preview-url {
    color: #a9a9a9;
    font-size: 12px;
    word-break: break-all;
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
