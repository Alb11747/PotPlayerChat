<script lang="ts">
  import type { CheerEmote, NativeTwitchEmote, TwitchEmote } from '@/core/chat/twitch-emotes'
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
    onEmoteLoad,
    enableEmotePreviews
  }: {
    message: TwitchMessage
    segment: Segment & { type: 'emote' | 'cheer' }
    urlTracker: UrlTracker
    onEmoteLoad?: (data: {
      emote: TwitchEmote | NativeTwitchEmote | CheerEmote
      hash: string
    }) => void
    enableEmotePreviews: boolean
  } = $props()

  let imgLoaded = $state<boolean>(false)

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
  {#if !imgLoaded}
    <span class="chat-emote" aria-hidden="true">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html segment.escaped}
    </span>
  {/if}
  <img
    class="chat-emote"
    srcset={urlsToSrcset(segment.urls, emoteSizeMap)}
    alt={segment.name}
    loading="lazy"
    decoding="async"
    onload={() => {
      imgLoaded = true
      if (onEmoteLoad)
        onEmoteLoad({ emote: segment.emote, hash: `${message.getId()}-${segment.index}` })
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
          onload={() => {
            if (onEmoteLoad)
              onEmoteLoad({
                emote: attachedEmote.emote,
                hash: `${message.getId()}-${segment.index}-${attachedIndex}`
              })
          }}
          onerror={(event) => onError(event, attachedEmote.urls)}
        />
      {/if}
    {/each}
  {:else if segment.type === 'cheer'}
    <span class="bits" style:color={segment.type === 'cheer' ? segment.emote.color : ''}>
      {segment.bits}
    </span>
  {/if}
</span>

<style>
  .emote-container {
    display: inline-grid;
    grid-auto-flow: column;
    vertical-align: middle;

    img {
      height: var(--deck-emote-size, 2.5rem);
      max-height: max-content;
      max-width: 9rem;
      object-fit: contain;
    }
  }

  .emote-container:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
  }

  .chat-emote {
    grid-area: 1 / 1;
    justify-self: center;
    align-self: center;
    margin-right: 0.125rem;
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
