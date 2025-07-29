<script lang="ts">
  import type { CheerEmote, NativeTwitchEmote, TwitchEmote } from '@/core/chat/twitch-emotes'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import type { Segment } from '@/renderer/src/core/chat-dom'
  import {
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '@/renderer/src/state/preview.svelte'
  import type { UrlTracker } from '@/renderer/src/state/url-tracker'
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
    onEmoteLoad?: (emote: TwitchEmote | NativeTwitchEmote | CheerEmote) => void
    enableEmotePreviews: boolean
  } = $props()

  let emoteElement: HTMLImageElement | null = $state(null)

  const emoteSizeMap: Record<string, string> = {
    '1': '0.5x',
    '2': '1x',
    '3': '1.5x',
    '4': '2x'
  }

  const isTallTwitchEmote = $derived.by(() => {
    if (!emoteElement) return false
    if (segment.type !== 'emote') return false
    if (segment.emote.type !== 'twitch') return false
    return emoteElement.naturalHeight > emoteElement.naturalWidth
  })

  function mouseUpdateEmote(segment: Segment & { type: 'emote' | 'cheer' }): void {
    if (enableEmotePreviews && !currentPreviewType()) {
      previewState.emoteSegment = segment
    }
    if (previewState.emoteSegment?.name === segment.name)
      previewState.lastUpdateTime = performance.now()
  }

  function onError(event: Event, urls: Record<string, string>): void {
    if (!(event.target instanceof HTMLImageElement)) return
    if (event.target.src) urlTracker.markFailedUrl(event.target.src)
    for (const url of Object.values(urls)) urlTracker.markFailedUrl(url)
  }
</script>

<span
  class={segment.type === 'cheer' ? 'emote-cheer' : 'emote-group'}
  style:color={segment.type === 'cheer' ? segment.emote.color : ''}
>
  <img
    bind:this={emoteElement}
    class="chat-emote"
    class:tall-twitch-emote={isTallTwitchEmote}
    srcset={urlsToSrcset(segment.urls, emoteSizeMap)}
    alt={segment.name}
    loading="lazy"
    decoding="async"
    onload={() => {
      if (onEmoteLoad) onEmoteLoad(segment.emote)
    }}
    onerror={(event) => onError(event, segment.urls)}
    onmouseenter={() => mouseUpdateEmote(segment)}
    onmousemove={() => mouseUpdateEmote(segment)}
    onmouseleave={() => {
      if (enableEmotePreviews) onMouseLeavePreviewElement()
    }}
  />
  {#if segment.type === 'emote'}
    {#each segment.attachedEmotes?.entries() || [] as [attachedIndex, attachedEmote] ((message.getId(), attachedIndex))}
      {#if Object.values(attachedEmote.urls).some((url) => !urlTracker.isFailedUrl(url))}
        <img
          class="chat-emote zero-width-emote"
          srcset={urlsToSrcset(attachedEmote.urls, emoteSizeMap)}
          alt={attachedEmote.alt}
          loading="lazy"
          decoding="async"
          onload={() => {
            if (onEmoteLoad) onEmoteLoad(attachedEmote.emote)
          }}
          onerror={(event) => onError(event, attachedEmote.urls)}
        />
      {/if}
    {/each}
  {:else if segment.type === 'cheer'}
    <span class="bits">
      {segment.bits}
    </span>
  {/if}
</span>

<style>
  .chat-emote {
    display: inline-block;
    justify-self: center;
    align-self: center;
    vertical-align: middle;
    max-height: 2.6rem;
    max-width: 9rem;
    margin-right: 0.25rem;
    object-fit: contain;
    font-weight: 900;
    grid-column: 1;
    grid-row: 1;
  }
  .tall-twitch-emote {
    max-height: 1.6rem;
  }

  .emote-group {
    display: inline-grid;
    position: relative;
    vertical-align: text-bottom;
  }
  .emote-group > .chat-emote,
  .emote-group > .zero-width-emote {
    grid-area: 1 / 1;
  }
  .zero-width-emote {
    grid-area: 1 / 1;
    width: auto;
    height: 100%;
    margin: 0;
    pointer-events: none;
    z-index: 1;
  }

  .emote-cheer {
    display: inline-block;
    width: fit-content;
  }
  .emote-cheer > .chat-emote {
    margin: 0;
  }
  .emote-cheer > .bits {
    vertical-align: center;
    margin-left: -0.25rem;
    margin-right: 0.25rem;
  }
</style>
