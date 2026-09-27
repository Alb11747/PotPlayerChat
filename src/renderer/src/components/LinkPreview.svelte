<script lang="ts">
  import { findChildByText, urlsToSrcset } from '@/utils/dom'
  import { debounce } from '@/utils/functions'
  import { onMount } from 'svelte'
  import type { UrlTracker } from '../core/url-tracker'
  import { clearPreview, previewState } from '../state/preview.svelte'
  import { settings } from '../state/settings.svelte'

  const { defaultPosition }: { defaultPosition?: 'top' | 'bottom' } = $props()

  let previewElement: HTMLDivElement | null = $state(null)
  let previewStyle = $state('')

  function handleMouseMove(e: MouseEvent): void {
    previewState.mousePosition = { x: e.clientX, y: e.clientY }
    if (previewState.clearOnMove) {
      previewState.url = null
      previewState.emoteSegment = null
      previewState.clearOnMove = false
    } else if (performance.now() - previewState.lastUpdateTime > 10) {
      setTimeout(() => {
        if (performance.now() - previewState.lastUpdateTime > 10) {
          previewState.url = null
          previewState.emoteSegment = null
        }
      }, 0)
    }
  }

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true })
    return () => document.removeEventListener('mousemove', handleMouseMove, { capture: true })
  })

  $effect(() => {
    const urlTracker = previewState.urlTrackerInstance
    if (!urlTracker || !previewState.url) return
    if (!urlTracker.isPreviewLoading(previewState.url)) {
      urlTracker.getPreview(previewState.url)
    }
  })

  function updatePosition(): void {
    if (!previewElement || (!previewState.url && !emoteSegment)) return

    const rect = previewElement.getBoundingClientRect()
    const windowHeight = window.innerHeight
    const windowWidth = window.innerWidth

    const marginTop = 8
    const marginBottom = 25
    const isTopDefault = (defaultPosition ?? settings.interface.defaultPreviewPosition) === 'top'

    let top: number

    const bottomPositionTop = previewState.mousePosition.y + marginBottom
    const topPositionTop = previewState.mousePosition.y - rect.height - marginTop
    if (
      isTopDefault
        ? topPositionTop < marginTop
        : bottomPositionTop + rect.height > windowHeight - marginBottom
    ) {
      const bottomOverlap = bottomPositionTop + rect.height - (windowHeight - marginBottom)
      const topOverlap = marginTop - topPositionTop
      if (bottomOverlap > topOverlap) top = topPositionTop
      else top = bottomPositionTop
    } else {
      top = isTopDefault ? topPositionTop : bottomPositionTop
    }

    let left = previewState.mousePosition.x - rect.width / 2
    const marginX = 5
    if (left < marginX) {
      left = marginX
    } else if (left + rect.width + marginX > windowWidth) {
      left = windowWidth - rect.width - marginX
    }

    top = Math.max(5, Math.min(top, windowHeight - rect.height - 5))
    previewStyle = `top: ${top}px; left: ${left}px;`
  }

  $effect(updatePosition)

  let sanitizedTooltipHtml: string | null = $state(null)
  let tooltipElement: HTMLSpanElement | null = $state(null)
  let foundLinkInToolTip: boolean = $state(false)

  $effect(() => {
    const activePreview = preview
    sanitizedTooltipHtml = null
    foundLinkInToolTip = false
    if (!activePreview?.tooltip) return
    let cancelled = false
    sanitizeTooltip(activePreview.tooltip)
      .then((html) => {
        if (cancelled) return
        sanitizedTooltipHtml = html
        updatePosition()
        requestAnimationFrame(() => {
          updatePosition()
          if (cancelled || !tooltipElement) return
          const link = findChildByText(tooltipElement, activePreview.link)
          const linkClass = 'preview-url'
          if (!link) return
          foundLinkInToolTip = true
          const linkElement = document.createElement('span')
          linkElement.classList.add(linkClass)
          linkElement.appendChild(document.createElement('br'))
          if (link.previousSibling?.textContent?.trim() === 'URL:') link.previousSibling?.remove()
          link.textContent = link.textContent?.trim() ?? ''
          linkElement.appendChild(link.cloneNode(true))
          link.replaceWith(linkElement)
          sanitizedTooltipHtml = tooltipElement.innerHTML
        })
      })
      .catch(() => {
        if (!cancelled) sanitizedTooltipHtml = 'Preview details unavailable.'
      })
    return () => {
      cancelled = true
    }
  })

  const preview = $derived(
    previewState?.url && previewState?.urlTrackerInstance
      ? previewState.urlTrackerInstance.getCachedPreview(previewState.url)
      : null
  )
  const emoteSegment = $derived(previewState.emoteSegment)
  let emoteImageFailed = $state(false)
  $effect(() => {
    if (emoteSegment) emoteImageFailed = false
  })
  const emote = $derived(emoteSegment?.emote)
  const source = $derived.by(() => {
    if (emote && 'type' in emote) return emote.type
    if (emoteSegment && 'source' in emoteSegment) return emoteSegment.source
    if (emote && 'source' in emote) return emote.source
    return null
  })

  async function sanitizeTooltip(tooltip: string): Promise<string> {
    return await window.api.sanitizeHtml(tooltip)
  }

  const markSeenUrlDelayed = debounce(
    (urlTrackerInstance: UrlTracker | null, url: string): void => {
      if (previewState?.url !== url) return
      urlTrackerInstance?.markSeenUrl(url)
    },
    300
  )

  $effect(() => {
    if (!previewState.url || !preview?.link) return
    if (!preview.thumbnail || previewState.urlTrackerInstance?.isFailedUrl(previewState.url))
      markSeenUrlDelayed(previewState.urlTrackerInstance, previewState.url)
  })
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') clearPreview()
  }}
/>

{#if (previewState.url && previewState.urlTrackerInstance) || emoteSegment}
  <div
    id="potplayerchat-hover-preview"
    class="link-preview"
    role="tooltip"
    bind:this={previewElement}
    style={previewStyle}
  >
    {#if previewState.url && previewState.urlTrackerInstance}
      {#if previewState.urlTrackerInstance.isPreviewLoading(previewState.url)}
        <div class="preview-loading-content">Loading preview…</div>
      {:else if previewState.urlTrackerInstance.hasPreview(previewState.url)}
        {#if preview && 200 <= preview.status && preview.status < 300}
          <div class="preview-content p-2 flex-1">
            {#if preview.thumbnail}
              {#if previewState?.urlTrackerInstance?.isFailedUrl(previewState.url) === false}
                <img
                  src={preview.thumbnail}
                  data-url={previewState.url}
                  onload={(event: Event) => {
                    const target = event.currentTarget as HTMLImageElement
                    const url = target.getAttribute('data-url')
                    if (url) markSeenUrlDelayed(previewState.urlTrackerInstance, url)

                    updatePosition()
                    requestAnimationFrame(updatePosition)
                  }}
                  onerror={(event: Event) => {
                    const target = event.currentTarget as HTMLImageElement
                    const url = target.getAttribute('data-url')
                    if (url) {
                      markSeenUrlDelayed(previewState.urlTrackerInstance, url)
                      previewState?.urlTrackerInstance?.markFailedUrl(url)
                    }
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
                {#if !sanitizedTooltipHtml}
                  <span>Loading...</span>
                {:else}
                  <span bind:this={tooltipElement}>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html sanitizedTooltipHtml}
                  </span>
                {/if}
              </div>
            {/if}
            {#if !foundLinkInToolTip && preview.link}
              <div class="preview-url">{preview.link}</div>
            {/if}
          </div>
        {:else if preview}
          <div class="preview-error-content">
            <div class="text-4xl pb-3">⚠️</div>
            <div class="font-medium text-error-soft">Failed to load preview</div>
            <div class="preview-url">{preview.link}</div>
          </div>
        {/if}
      {/if}
    {:else if emoteSegment}
      <div class="p-3 flex flex-col items-center gap-2">
        {#if emoteImageFailed}
          <p>Image failed to load</p>
        {:else}
          <img
            onerror={() => {
              emoteImageFailed = true
            }}
            class="emote-preview-image"
            srcset={urlsToSrcset(emoteSegment.urls, {
              '1': '0.25x',
              '2': '0.5x',
              '3': '0.75x',
              '4': '1x'
            })}
            alt={emoteSegment.name}
            onload={() => {
              updatePosition()
              requestAnimationFrame(updatePosition)
            }}
          />
        {/if}
        <div class="emote-preview-name">{emoteSegment.name}</div>
        {#if source || ('ownerName' in emoteSegment.emote && emoteSegment.emote.ownerName)}
          <div class="emote-preview-metadata">
            {#if source}
              <div class="emote-preview-source">
                Source: {source}
              </div>
            {/if}
            {#if 'ownerName' in emoteSegment.emote && emoteSegment.emote.ownerName}
              <div class="emote-preview-author">
                Author: {emoteSegment.emote.ownerName}
              </div>
            {/if}
          </div>
        {/if}
        {#if emoteSegment.type === 'emote' && emoteSegment.attachedEmotes && emoteSegment.attachedEmotes.length > 0}
          <span class="emote-preview-divider"></span>
          <div class="zero-width-emotes-grid">
            {#each emoteSegment.attachedEmotes?.entries() || [] as [index, attachedEmote] (index)}
              <div class="zero-width-emote-item">
                <img
                  srcset={urlsToSrcset(attachedEmote.urls)}
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
    pointer-events: none;
    background: var(--deck-surface);
    color: var(--deck-text);
    border: 1px solid var(--deck-line);
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--color-shadow-modal);
    max-width: calc(100vw - 10px);
    max-height: calc(100vh - 10px);
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
    max-width: min(400px, calc(100vw - 32px));
    max-height: min(250px, 40vh);
    object-fit: contain;
    margin-left: auto;
    margin-right: auto;
  }

  .preview-tooltip {
    color: var(--color-text-light);
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding: 2px 0;
  }

  .preview-content {
    min-width: 0;
    max-width: min(480px, calc(100vw - 10px));
  }

  :global(.preview-url) {
    line-height: 1.2;
    padding-left: 0;
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

  .emote-preview-metadata {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .emote-preview-source,
  .emote-preview-author {
    font-size: 12px;
    color: var(--color-text-muted);
    line-height: 1.4;
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
