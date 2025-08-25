<script lang="ts">
  import type { CheerEmote, NativeTwitchEmote, TwitchEmote } from '@/core/chat/twitch-emotes'
  import type { TwitchMessage } from '@/core/chat/twitch-msg'
  import type { Segment } from '@/renderer/src/core/chat-dom'
  import type { UrlTracker } from '@/renderer/src/core/url-tracker'
  import {
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '@/renderer/src/state/preview.svelte'
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

  const emoteSizeMap: Record<string, string> = {
    '1': '0.5x',
    '2': '1x',
    '3': '1.5x',
    '4': '2x'
  }

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
  class="emote-container"
  class:cheer-emote-container={segment.type === 'cheer'}
  role="group"
  onmouseenter={() => mouseUpdateEmote(segment)}
  onmousemove={() => mouseUpdateEmote(segment)}
  onmouseleave={() => {
    if (enableEmotePreviews) onMouseLeavePreviewElement()
  }}
>
  <img
    class="chat-emote"
    srcset={urlsToSrcset(segment.urls, emoteSizeMap)}
    alt={segment.name}
    loading="lazy"
    decoding="async"
    onload={() => {
      if (onEmoteLoad) onEmoteLoad(segment.emote)
    }}
    onerror={(event) => onError(event, segment.urls)}
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
    <span class="bits" style:color={segment.type === 'cheer' ? segment.emote.color : ''}>
      {segment.bits}
    </span>
  {/if}
</span>

<style>
  .emote-container {
    display: inline-grid;
    grid-auto-flow: column;
    vertical-align: text-bottom;

    img {
      height: 2.6rem;
      max-width: 9rem;
      object-fit: contain;
    }
  }

  .chat-emote {
    grid-area: 1 / 1;
    justify-self: center;
    align-self: center;
    margin-right: 0.25rem;
    font-weight: 900;
  }
  .zero-width-emote {
    z-index: 1;
  }

  .cheer-emote-container {
    vertical-align: bottom;
  }
  .cheer-emote-container > .bits {
    align-self: end;
    margin-right: 0.2rem;
  }
</style>
