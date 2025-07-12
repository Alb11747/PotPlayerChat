<script lang="ts">
  import { isActionMessage, parseFullMessage } from '@/renderer/src/core/chat-dom'
  import { formatTime } from '@/utils/strings'
  import { getTwitchUserIdByName } from '@core/chat/twitch-api'
  import { mainEmoteService, type TwitchEmoteService } from '@core/chat/twitch-emotes'
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import type { TwitchEmote } from '@mkody/twitch-emoticons'

  import { UrlTracker } from '../state/url-tracker'
  import { previewState } from '../state/preview.svelte'

  interface Props {
    message: TwitchMessage
    videoStartTime?: number
    videoEndTime?: number
    urlTracker: UrlTracker
    usernameColorMap?: Map<string, { color: string; timestamp: number }>
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    onEmoteLoad?: (emote: TwitchEmote) => void
    enablePreviews?: boolean
    enableEmotes?: boolean
  }

  let {
    message,
    videoStartTime,
    videoEndTime,
    urlTracker,
    usernameColorMap,
    searchQuery,
    onUrlClick,
    onEmoteLoad,
    enablePreviews = true,
    enableEmotes = true
  }: Props = $props()

  // Handle URL click
  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    if (onUrlClick) {
      onUrlClick(url)
    } else {
      window.api.openUrl(url)
    }
  }

  // Handle URL hover to preload preview
  async function handleUrlHover(url: string): Promise<void> {
    if (!enablePreviews || !urlTracker.isPreviewLoading(url)) {
      await urlTracker.getPreview(url)
    }
  }

  let emoteService: TwitchEmoteService | null = $state(null)
  let channelUserId: number | null = $state(null)

  async function loadEmotes(): Promise<void> {
    if (!enableEmotes) return
    const id = await getTwitchUserIdByName(message.channel)
    if (!id) return
    channelUserId = parseInt(id, 10)
    const service = await mainEmoteService
    if (!service) return
    const fetchPromise = channelUserId
      ? service.fetchAllEmotes(channelUserId)
      : service.fetchAllEmotes()
    await fetchPromise
    emoteService = service
  }

  loadEmotes()

  // Highlight search terms in the message and parse emotes and parse emotes
  const { escapedUsername, parsedMessageSegments } = $derived.by(() => {
    if (!message) return { escapedUsername: '', parsedMessageSegments: [] }
    let emotes: Record<string, TwitchEmote[]> | undefined = undefined
    if (emoteService) emotes = emoteService.getEmotes(channelUserId)
    return parseFullMessage(message.username || '', message.message || '', {
      twitchMessage: message,
      twitchEmotes: emotes ?? undefined,
      searchQuery
    })
  })
</script>

<div class="chat-message">
  <span class="chat-time">
    {formatTime(message.timestamp, videoStartTime, videoEndTime)}
  </span>
  {#if message.type === 'chat'}
    <span class="chat-username" style="color: {message.color}">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html escapedUsername + ': '}
    </span>
    <span
      class="chat-text"
      style={isActionMessage(message.message) ? `color: ${message.color}` : ''}
    >
      {#each parsedMessageSegments?.entries() || [] as [index, segment] ((message.getId(), index))}
        {#if segment.type === 'emote' && !urlTracker.isFailedUrl(segment.url)}
          <span class="emote-group">
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
            />
            {#each segment.attachedEmotes?.entries() || [] as [attachedIndex, attachedEmote] ((message.getId(), index, attachedIndex))}
              {#if !urlTracker.isFailedUrl(segment.url)}
                <img
                  class="chat-emote zero-width-emote"
                  src={attachedEmote.url}
                  alt={attachedEmote.name}
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
          </span>
        {:else if segment.type === 'url'}
          <button
            class="chat-url"
            class:visited={urlTracker.isVisitedUrl(segment.url)}
            onclick={() => handleUrlClick(segment.url)}
            onmouseenter={(e) => {
              if (enablePreviews) {
                previewState.url = segment.url
                previewState.mousePosition = { x: e.clientX, y: e.clientY }
                previewState.urlTrackerInstance = urlTracker
                handleUrlHover(segment.url)
              }
            }}
            onmousemove={(e) => {
              if (enablePreviews) {
                previewState.mousePosition = { x: e.clientX, y: e.clientY }
              }
            }}
            onmouseleave={() => {
              if (enablePreviews) {
                previewState.url = null
              }
            }}
            type="button"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html segment.escaped}
          </button>
        {:else if segment.type === 'mention'}
          <span
            class="chat-username"
            style="color: {usernameColorMap?.get(segment.username)?.color || '#ffffff'}"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html segment.escaped}
          </span>
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
      Unknown message type: {(message as { type: string }).type}
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
    cursor: default;
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
    vertical-align: middle;
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

  :global(mark) {
    background: #4e8cff;
    color: white;
    border-radius: 4px;
  }
</style>
