<script lang="ts">
  import { previewState } from '../state/preview.svelte'
  import sanitizeHtml from 'sanitize-html'

  let previewElement: HTMLDivElement | null = $state(null)
  let previewStyle = $state('')

  $effect(() => {
    if (!previewElement || !previewState.url) return

    const rect = previewElement.getBoundingClientRect()
    const windowHeight = window.innerHeight
    const windowWidth = window.innerWidth

    let top = previewState.mousePosition.y + 20
    if (top + rect.height > windowHeight) {
      top = previewState.mousePosition.y - rect.height - 10
    }

    let left = previewState.mousePosition.x - rect.width / 2
    if (left < 0) {
      left = 5
    } else if (left + rect.width > windowWidth) {
      left = windowWidth - rect.width - 5
    }

    previewStyle = `top: ${top}px; left: ${left}px;`
  })

  const preview = $derived(previewState.urlTrackerInstance.getCachedPreview(previewState.url))
</script>

{#if previewState.url && previewState.urlTrackerInstance}
  <div
    class="link-preview"
    role="dialog"
    tabindex="0"
    aria-modal="true"
    bind:this={previewElement}
    style={previewStyle}
  >
    {#if previewState.urlTrackerInstance.hasPreview(previewState.url)}
      {#if preview && preview.status === 200}
        {#if preview.thumbnail}
          {#if !previewState.urlTrackerInstance.isFailedUrl(preview.link)}
            <img
              src={preview.thumbnail}
              onerror={() => {
                previewState.urlTrackerInstance.markFailedUrl(preview.link)
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
      {:else if preview && preview.status === 0}
        <div class="preview-error-content">
          <div class="preview-error-icon">⚠️</div>
          <div class="preview-error-text">Failed to load preview</div>
          <div class="preview-url">{preview.link}</div>
        </div>
      {/if}
    {:else if previewState.urlTrackerInstance.isPreviewLoading(previewState.url)}
      <div class="preview-loading-content">
        <div class="preview-loading-spinner">⏳</div>
        <div class="preview-loading-text">Loading preview...</div>
        <div class="preview-url">{previewState.url}</div>
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
    background: #2d2d35;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 400px;
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
</style>
