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

  function mouseUpdateEmote(segment: Segment & { type: 'emote' | 'cheer' }): void {
    if (enableEmotePreviews && !currentPreviewType()) previewState.emoteSegment = segment
  }
</script>

<span
  class={segment.type === 'cheer' ? 'emote-cheer' : 'emote-group'}
  style:color={segment.type === 'cheer' ? segment.emote.color : ''}
>
  <img
    class="chat-emote"
    src={segment.url}
    alt={segment.name}
    loading="lazy"
    decoding="async"
    onload={() => {
      if (onEmoteLoad) onEmoteLoad(segment.emote)
    }}
    onerror={() => {
      urlTracker.markFailedUrl(segment.url)
    }}
    onmouseenter={() => mouseUpdateEmote(segment)}
    onmousemove={() => mouseUpdateEmote(segment)}
    onmouseleave={() => {
      if (enableEmotePreviews) onMouseLeavePreviewElement()
    }}
  />
  {#if segment.type === 'emote'}
    {#each segment.attachedEmotes?.entries() || [] as [attachedIndex, attachedEmote] ((message.getId(), attachedIndex))}
      {#if !urlTracker.isFailedUrl(segment.url)}
        <img
          class="chat-emote zero-width-emote"
          src={attachedEmote.url}
          alt={attachedEmote.alt}
          loading="lazy"
          decoding="async"
          onload={() => {
            if (onEmoteLoad) onEmoteLoad(attachedEmote.emote)
          }}
          onerror={() => {
            urlTracker.markFailedUrl(attachedEmote.url)
          }}
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
