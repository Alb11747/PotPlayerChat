<script lang="ts">
  import { previewState } from '../state/preview.svelte'

  let previewElement: HTMLDivElement | null = $state(null)
  let previewStyle = $state('')

  function handleMouseMove(e: MouseEvent): void {
    previewState.mousePosition = { x: e.clientX, y: e.clientY }
    if (previewState.clearOnMove) {
      previewState.clearOnMove = false
      previewState.url = null
      previewState.emoteSegment = null
    }
  }

  $effect(() => {
    if (!previewElement) return
    document.addEventListener('mousemove', handleMouseMove, { capture: true })
    return () => document.removeEventListener('mousemove', handleMouseMove)
  })

  function updatePosition(): void {
    if (!previewElement || (!previewState.url && !emoteSegment)) return

    const rect = previewElement.getBoundingClientRect()
    const windowHeight = window.innerHeight
    const windowWidth = window.innerWidth

    let top = previewState.mousePosition.y + 20
    if (top + rect.height > windowHeight) {
      top = previewState.mousePosition.y - rect.height - 10
    }

    let left = previewState.mousePosition.x - rect.width / 2
    const margin = 5
    if (left < margin) {
      left = margin
    } else if (left + rect.width + margin > windowWidth) {
      left = windowWidth - rect.width - margin
    }

    previewStyle = `top: ${top}px; left: ${left}px;`
  }

  $effect(updatePosition)

  const preview = $derived(previewState.urlTrackerInstance?.getCachedPreview(previewState.url))
  const emoteSegment = $derived(previewState.emoteSegment)

  async function sanitizeTooltip(tooltip: string): Promise<string> {
    return await window.api.sanitizeHtml(tooltip)
  }
</script>

{#if (previewState.url && previewState.urlTrackerInstance) || emoteSegment}
  <div
    class="link-preview"
    role="dialog"
    tabindex="0"
    aria-modal="true"
    bind:this={previewElement}
    style={previewStyle}
  >
    {#if previewState.url && previewState.urlTrackerInstance}
      {#if previewState.urlTrackerInstance.hasPreview(previewState.url)}
        {#if preview && 200 <= preview.status && preview.status < 300}
          <div class="p-2 flex-1">
            {#if preview.thumbnail}
              {#if !previewState.urlTrackerInstance.isFailedUrl(preview.link)}
                <img
                  src={preview.thumbnail}
                  onload={updatePosition}
                  onerror={() => {
                    previewState.urlTrackerInstance.markFailedUrl(preview.link)
                  }}
                  alt="Link preview"
                  class="preview-thumbnail"
                />
              {:else}
                <span class="flex font-medium text-center justify-center color-error-soft pt-6 pb-2"
                  >Image failed to load</span
                >
              {/if}
            {/if}
            {#if preview.tooltip}
              <div class="preview-tooltip">
                {#await sanitizeTooltip(preview.tooltip)}
                  <span>Loading...</span>
                {:then sanitizedHtml}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html sanitizedHtml}
                {/await}
              </div>
            {/if}
            <div class="preview-url">{preview.link}</div>
          </div>
        {:else if preview}
          <div class="preview-error-content">
            <div class="text-4xl pb-3">⚠️</div>
            <div class="font-medium text-error-soft">Failed to load preview</div>
            <div class="preview-url">{preview.link}</div>
          </div>
        {/if}
      {:else if previewState.urlTrackerInstance.isPreviewLoading(previewState.url)}
        <div class="preview-loading-content">
          <div class="text-4xl animate-spin">⏳</div>
          <div class="font-medium">Loading preview...</div>
          <div class="preview-url">{previewState.url}</div>
        </div>
      {/if}
    {:else if emoteSegment}
      <div class="p-3 flex flex-col items-center gap-2">
        <img src={emoteSegment.url} alt={emoteSegment.name} class="emote-preview-image" />
        <div class="emote-preview-name">{emoteSegment.name}</div>
        <div class="emote-preview-source">
          Source: {emoteSegment.emote.type || emoteSegment.source || emoteSegment.emote.source}
        </div>
        {#if emoteSegment.emote.ownerName}
          <div class="emote-preview-author">
            Author: {emoteSegment.emote.ownerName}
          </div>
        {/if}
        {#if emoteSegment.attachedEmotes && emoteSegment.attachedEmotes.length > 0}
          <span class="emote-preview-divider"></span>
          <div class="zero-width-emotes-grid">
            {#each emoteSegment.attachedEmotes?.entries() || [] as [index, attachedEmote] (index)}
              <div class="zero-width-emote-item">
                <img
                  src={attachedEmote.url}
                  alt={attachedEmote.name}
                  class="zero-width-emote-image"
                />
                <div class="zero-width-emote-name">{attachedEmote.name}</div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .link-preview {
    width: max-content;
    height: max-content;
    position: fixed;
    z-index: 1000;
    background: var(--color-bg-modal);
    border: 1px solid var(--color-gray-5);
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--color-shadow-modal);
    max-width: 80vw;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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

  .preview-thumbnail {
    display: block;
    flex: 1 1 auto;
    width: fit-content;
    height: fit-content;
    max-width: 400px;
    max-height: 250px;
    object-fit: contain;
    margin-left: auto;
    margin-right: auto;
  }

  .preview-tooltip {
    color: var(--color-text-light);
    font-size: 12px;
    line-height: 0.8;
    white-space: pre-wrap;
    padding: 2px 0;
  }

  .preview-url {
    color: var(--color-text-muted);
    font-size: 12px;
    word-break: break-all;
  }

  .emote-preview-image {
    width: min(16rem, fit-content);
    height: min(8rem, fit-content);
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .emote-preview-name {
    font-size: 16px;
    font-weight: bold;
    color: var(--color-text-light);
  }

  .emote-preview-source,
  .emote-preview-author {
    font-size: 12px;
    color: var(--color-text-muted);
    line-height: 0.8;
    text-align: center;
  }

  .emote-preview-divider {
    width: 95%;
    height: 1px;
    background-color: var(--color-gray-5);
    margin: 2px 0;
  }

  .zero-width-emotes-grid {
    display: block;
    grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
    gap: 5px;
    justify-content: space-evenly;
    justify-items: stretch;
    align-items: center;
    width: 100%;
  }

  .zero-width-emote-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .zero-width-emote-image {
    max-width: 40px;
    max-height: 40px;
    object-fit: contain;
  }

  .zero-width-emote-name {
    font-size: 10px;
    color: var(--color-text-muted);
    text-align: center;
    word-break: break-all;
  }
</style>
