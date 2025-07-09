<script lang="ts">
  import type { TwitchMessage } from '@/chat/twitch-msg'
  import { parseFullMessage } from '@/renderer/src/core/chat-dom'
  import { formatRelativeTime } from '@/utils/strings'
  import { UrlTracker } from '@/utils/url-tracker'
  import sanitizeHtml from 'sanitize-html'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

  interface Props {
    message: TwitchMessage
    videoStartTime: number | null
    urlTracker: UrlTracker
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    enablePreviews?: boolean
  }

  let {
    message,
    videoStartTime,
    urlTracker,
    searchQuery,
    onUrlClick,
    enablePreviews = true
  }: Props = $props()

  // Link preview state - these need to be global or passed in
  // svelte-ignore non_reactive_update
  let linkPreviews = new SvelteMap<string, LinkPreview>()
  let failedPreviews = new SvelteSet<string>()
  let showPreviewForUrl = $state<string | null>(null)
  let previewElement: HTMLDivElement | null = $state(null)
  let mousePosition = $state({ x: 0, y: 0 })

  // Handle URL click
  function handleUrlClick(url: string): void {
    urlTracker.addUrl(url)
    if (onUrlClick) {
      onUrlClick(url)
    } else {
      window.api.openUrl(url)
    }
  }

  // Handle URL hover to preload preview
  async function handleUrlHover(url: string): Promise<void> {
    if (!enablePreviews || (!linkPreviews.has(url) && !linkPreviewService.isLoading(url))) {
      const preview = await linkPreviewService.getPreview(url)
      if (preview) {
        linkPreviews.set(url, preview)
      }
    }
  }

  // Highlight search terms in the message
  const { escapedUsername, parsedMessageSegments } = $derived.by(() => {
    if (!message) return { escapedUsername: '', parsedMessageSegments: [] }
    return parseFullMessage(message.username, message.message, searchQuery)
  })
</script>

<div class="chat-message">
  <span class="chat-time">
    [{formatRelativeTime(message.timestamp, videoStartTime)}]
  </span>
  {#if message.type === 'chat'}
    <span class="chat-username" style="color: {message.color}">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html escapedUsername + ': '}
    </span>
    <span class="chat-text">
      {#each parsedMessageSegments?.entries() || [] as [index, segment] ((message.getId(), index))}
        {#if segment.type === 'url'}
          <button
            class="chat-url"
            class:visited={urlTracker.hasUrl(segment.url)}
            onclick={() => handleUrlClick(segment.url)}
            onmouseenter={() => {
              if (enablePreviews) {
                showPreviewForUrl = segment.url
                handleUrlHover(segment.url)
              }
            }}
            onmousemove={(e) => {
              if (enablePreviews) {
                mousePosition = { x: e.clientX, y: e.clientY }
              }
            }}
            onmouseleave={() => {
              if (enablePreviews) {
                showPreviewForUrl = null
              }
            }}
            type="button"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html segment.escaped}
          </button>
          {#if enablePreviews && showPreviewForUrl === segment.url}
            {#if linkPreviews.has(segment.url)}
              {#each [linkPreviews.get(segment.url)] as preview ((message.getId(), index, preview?.link))}
                {#if preview && preview.status === 200}
                  <div
                    class="link-preview"
                    role="dialog"
                    tabindex="0"
                    aria-modal="true"
                    bind:this={previewElement}
                    style:left="{mousePosition.x - previewElement?.clientWidth / 2}px"
                  >
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
                    bind:this={previewElement}
                    style:left="{mousePosition.x - previewElement?.clientWidth / 2}px"
                  >
                    <div class="preview-error-content">
                      <div class="preview-error-icon">⚠️</div>
                      <div class="preview-error-text">Failed to load preview</div>
                      <div class="preview-url">{preview.link}</div>
                    </div>
                  </div>
                {/if}
              {/each}
            {:else if linkPreviewService.isLoading(segment.url)}
              <div
                class="link-preview link-preview-loading"
                role="dialog"
                tabindex="0"
                aria-modal="true"
                bind:this={previewElement}
                style:left="{mousePosition.x - previewElement?.clientWidth / 2}px"
              >
                <div class="preview-loading-content">
                  <div class="preview-loading-spinner">⏳</div>
                  <div class="preview-loading-text">Loading preview...</div>
                  <div class="preview-url">{segment.url}</div>
                </div>
              </div>
            {/if}
          {/if}
        {:else}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html segment.escaped}
        {/if}
      {/each}
    </span>
  {:else if message.type === 'system'}
    <span class="chat-text chat-system">{message.getSystemText()}</span>
  {:else}
    <span class="chat-text">
      Unknown message type: {message.type}
    </span>
  {/if}
</div>

<style>
  .chat-message {
    width: 100%;
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
  .chat-system {
    color: #c0c0c0;
    font-style: italic;
    font-weight: 500;
  }

  .chat-url {
    width: fit-content;
    height: fit-content;
    text-align: left;
    justify-content: flex-start;
    display: inline;
    font: inherit;
    color: #4e8cff;
    text-decoration: underline;
    cursor: pointer;
    transition: color 0.2s ease;
    background: none;
    border: none;
    outline: none;
    padding: 0;
    margin: 0;
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
    width: max-content;
    height: max-content;
    position: fixed;
    z-index: 1000;
    background: #2d2d35;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 400px;
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

  .preview-loading-content,
  .preview-error-content {
    padding: 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .preview-error-icon,
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
    color: #ff6b6b;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
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

  :global(mark) {
    background: #4e8cff;
    color: white;
    border-radius: 4px;
  }
</style>
