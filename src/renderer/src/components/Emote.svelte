<script lang="ts">
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import type { Segment } from '@/renderer/src/core/chat-dom'
  import type { UrlTracker } from '@/renderer/src/core/url-tracker'
  import {
    clearPreview,
    focusPreviewElement,
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '@/renderer/src/state/preview.svelte'
  import { settings } from '../state/settings.svelte'
  import {
    openPreviewPopup,
    restorePreviewTrigger,
    shouldOpenExpandedPreview
  } from '../core/preview-window'
  import { urlsToSrcset } from '@/utils/dom'

  let {
    message,
    segment,
    urlTracker,
    enableEmotePreviews
  }: {
    message: TwitchMessage
    segment: Segment & { type: 'emote' | 'cheer' }
    urlTracker: UrlTracker
    enableEmotePreviews: boolean
  } = $props()

  const imageKey = $derived(Object.values(segment.urls)[0] ?? segment.name)
  const dimensions = $derived(urlTracker.getImageDimensions(imageKey))
  let baseImage: HTMLImageElement | undefined = $state()
  async function recordDecodedImage(image: HTMLImageElement, key: string): Promise<void> {
    const urls = segment.urls
    try {
      await image.decode()
    } catch {
      if (image.isConnected && key === imageKey)
        for (const url of Object.values(urls)) urlTracker.markFailedUrl(url)
      return
    }
    if (!image.isConnected || key !== imageKey || urlTracker.getImageDimensions(key)) return
    urlTracker.recordImageDimensions(key, image)
  }
  $effect(() => {
    // Clearing application caches does not reload an already mounted <img>.
    // Reuse its decoded resource to restore dimensions instead of leaving a placeholder.
    if (!dimensions && baseImage?.complete && baseImage.naturalWidth > 0) {
      void recordDecodedImage(baseImage, imageKey)
    }
  })
  const ratio = $derived(dimensions ? dimensions.width / dimensions.height : undefined)
  const frameWidth = $derived(
    dimensions
      ? `min(${dimensions.width}px, calc(var(--deck-emote-size, 2.5rem) * ${ratio}), 9rem)`
      : '9rem'
  )
  const frameHeight = $derived(
    dimensions
      ? `min(${dimensions.height}px, var(--deck-emote-size, 2.5rem), calc(9rem / ${ratio}))`
      : 'var(--deck-emote-size, 2.5rem)'
  )

  const emoteSizeMap: Record<string, string> = {
    '1': '0.5x',
    '2': '1x',
    '3': '1.5x',
    '4': '2x'
  }

  function mouseUpdateEmote(segment: Segment & { type: 'emote' | 'cheer' }): void {
    if (
      enableEmotePreviews &&
      settings.interface.previewMode === 'hover' &&
      !currentPreviewType()
    ) {
      previewState.emoteSegment = segment
    }
    if (previewState.emoteSegment?.name === segment.name)
      previewState.lastUpdateTime = performance.now()
  }

  function activate(event: MouseEvent | KeyboardEvent): void {
    if (
      !shouldOpenExpandedPreview(enableEmotePreviews, settings.interface.previewMode, event.ctrlKey)
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const trigger = event.currentTarget as HTMLElement
    clearPreview()
    openPreviewPopup({ kind: 'emote', segment, restoreFocus: () => restorePreviewTrigger(trigger) })
  }

  function onError(event: Event, urls: Record<string, string>): void {
    if (!(event.target instanceof HTMLImageElement)) return
    if (event.target.src) urlTracker.markFailedUrl(event.target.src)
    for (const url of Object.values(urls)) urlTracker.markFailedUrl(url)
  }
</script>

<span
  class="emote-container"
  class:cheer-emote-container={segment.type === 'cheer'}
  role="button"
  tabindex={enableEmotePreviews ? 0 : -1}
  aria-label={`Preview ${segment.name}`}
  aria-describedby={previewState.emoteSegment?.name === segment.name
    ? 'potplayerchat-hover-preview'
    : undefined}
  aria-disabled={!enableEmotePreviews}
  onclick={activate}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event)
    if (event.key === 'Escape') clearPreview()
  }}
  onfocus={(event) => {
    focusPreviewElement(event.currentTarget)
    mouseUpdateEmote(segment)
  }}
  onblur={clearPreview}
  onmouseenter={() => mouseUpdateEmote(segment)}
  onmousemove={() => mouseUpdateEmote(segment)}
  onmouseleave={() => {
    if (enableEmotePreviews) onMouseLeavePreviewElement()
  }}
>
  <span class="emote-frame" style:width={frameWidth} style:height={frameHeight}>
    {#if !dimensions}
      <span class="chat-emote" aria-hidden="true">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html segment.escaped}
      </span>
    {/if}
    <img
      bind:this={baseImage}
      class="chat-emote"
      srcset={urlsToSrcset(segment.urls, emoteSizeMap)}
      alt={segment.name}
      loading="lazy"
      decoding="async"
      onload={(event) => {
        if (event.currentTarget instanceof HTMLImageElement)
          void recordDecodedImage(event.currentTarget, imageKey)
      }}
      onerror={(event) => onError(event, segment.urls)}
    />
    {#if segment.type === 'emote'}
      {#each segment.attachedEmotes?.entries() || [] as [attachedIndex, attachedEmote] (`${message.getId()}-${attachedIndex}`)}
        {#if Object.values(attachedEmote.urls).some((url) => !urlTracker.isFailedUrl(url))}
          <img
            class="chat-emote zero-width-emote"
            srcset={urlsToSrcset(attachedEmote.urls, emoteSizeMap)}
            alt={attachedEmote.alt}
            loading="lazy"
            decoding="async"
            onerror={(event) => onError(event, attachedEmote.urls)}
          />
        {/if}
      {/each}
    {/if}
  </span>
  {#if segment.type === 'cheer'}
    <span class="bits" style:color={segment.type === 'cheer' ? segment.emote.color : ''}>
      {segment.bits}
    </span>
  {/if}
</span>

<style>
  .emote-container {
    display: inline-grid;
    grid-auto-flow: column;
    vertical-align: baseline;
  }

  .emote-container:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
  }

  .emote-frame {
    display: inline-grid;
    position: relative;
    margin-right: 0.125rem;
  }
  .emote-frame img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .emote-frame > span {
    position: absolute;
    max-width: 100%;
    overflow: hidden;
  }
  .chat-emote {
    grid-area: 1 / 1;
    justify-self: center;
    align-self: center;
    font-weight: 900;
  }
  .zero-width-emote {
    z-index: 1;
  }

  .cheer-emote-container > .bits {
    align-self: end;
    margin-right: 0.2rem;
  }
</style>
