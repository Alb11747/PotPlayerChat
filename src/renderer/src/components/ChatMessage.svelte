<script lang="ts">
  import { isActionMessage, parseFullMessage, type Segment } from '@/renderer/src/core/chat-dom'
  import { formatTime } from '@/utils/strings'
  import { getMainBadgeService, getTwitchUserIdByName } from '@core/chat/twitch-api'
  import { mainEmoteService, type TwitchEmoteService } from '@core/chat/twitch-emotes'
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import type { TwitchEmote } from '@mkody/twitch-emoticons'

  import type { HelixChatBadgeVersion } from '@twurple/api'
  import {
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '../state/preview.svelte'
  import { settings } from '../state/settings.svelte'
  import { UrlTracker } from '../state/url-tracker'

  interface Props {
    message: TwitchMessage
    videoStartTime?: number
    videoEndTime?: number
    urlTracker: UrlTracker
    usernameColorMap?: Map<string, { color: string; timestamp: number }>
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    onEmoteLoad?: (emote: TwitchEmote) => void
    enableLinkPreviews?: boolean
    enableEmotePreviews?: boolean
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
    enableLinkPreviews = true,
    enableEmotePreviews = true,
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
    if (!enableLinkPreviews || !urlTracker.isPreviewLoading(url)) {
      await urlTracker.getPreview(url)
    }
  }

  let emoteService: TwitchEmoteService | null = $state(null)
  let channelUserId: number | null = $state(null)
  let badgeService: Awaited<ReturnType<typeof getMainBadgeService>> = $state(null)
  let badges: [string, HelixChatBadgeVersion][] = $state([])
  const badgeInfo: Map<string, string> | undefined = $derived(message?.badgeInfo)
  const subscriberMonths: string | undefined = $derived(badgeInfo?.get('subscriber'))

  async function loadServices(): Promise<void> {
    if (!enableEmotes) return
    const id = await getTwitchUserIdByName(message.channel)
    if (!id) return
    channelUserId = parseInt(id, 10)

    // Load emote service
    const emoteServiceInstance = await mainEmoteService
    if (emoteServiceInstance) {
      const fetchPromise = channelUserId
        ? emoteServiceInstance.fetchAllEmotes(channelUserId)
        : emoteServiceInstance.fetchAllEmotes()
      await fetchPromise
      emoteService = emoteServiceInstance
    }

    // Load badge service
    const badgeServiceInstance = await getMainBadgeService()
    if (badgeServiceInstance) {
      badgeService = badgeServiceInstance
      await loadBadges()
    }
  }

  async function loadBadges(): Promise<void> {
    if (!badgeService || !channelUserId || message.type !== 'chat') return
    const badgeList = message.badges
    if (!badgeList) return
    badges.length = 0
    for (const [badgeId, version] of badgeList) {
      const badgeData = await badgeService.getBadgeInfo(badgeId, version, channelUserId.toString())
      if (badgeData) badges.push([badgeId, badgeData])
    }
  }

  loadServices()

  const [systemText, systemMsg] = $derived(
    message.type === 'system' ? message?.getSystemTextAndMessage() || [] : []
  )

  // Highlight search terms in the message and parse emotes and parse emotes
  const { escapedUsername, parsedMessageSegments } = $derived.by(() => {
    if (!message || (message.type === 'system' && !systemMsg))
      return { escapedUsername: '', parsedMessageSegments: undefined }
    let emotes: Record<string, TwitchEmote[]> | undefined = undefined
    if (emoteService) emotes = emoteService.getEmotes(channelUserId)
    return parseFullMessage(message, {
      twitchEmotes: emotes ?? undefined,
      enableEmotes,
      showName: settings.interface.showName,
      searchQuery
    })
  })

  function mouseUpdateEmote(segment: Segment & { type: 'emote' }): void {
    if (enableEmotePreviews && !currentPreviewType()) previewState.emoteSegment = segment
  }

  function mouseUpdateUrl(segment: Segment & { type: 'url' }): void {
    if (enableLinkPreviews && !currentPreviewType()) {
      previewState.url = segment.url
      previewState.urlTrackerInstance = urlTracker
      handleUrlHover(segment.url)
    }
  }
</script>

<div class="chat-message" class:first-message={message.firstMsg === '1'}>
  {#if settings.interface.showTimestamps}
    <span class="chat-time">
      {formatTime(message.timestamp, videoStartTime, videoEndTime)}
    </span>
  {/if}
  {#if message.type === 'chat'}
    {#if settings.interface.showBadges && badges.length > 0}
      <span class="chat-badges">
        {#each badges as [badgeId, badge] (badgeId)}
          <img
            class="chat-badge"
            src={badge.getImageUrl(4)}
            alt={badge.title}
            title={badgeId === 'subscriber'
              ? `${badge.title} (${subscriberMonths} ${subscriberMonths === '1' ? 'Month' : 'Months'})`
              : badgeId === 'predictions'
                ? `${badge.title} - ${badgeInfo?.get('predictions')}`
                : badge.title}
            loading="lazy"
            decoding="async"
          />
        {/each}
      </span>
    {/if}
    <span class="chat-username" style="color: {message.color}">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html escapedUsername + ': '}
    </span>
  {:else if message.type === 'system'}
    <span class="chat-text chat-system"
      >{#if parsedMessageSegments}
        {systemText + ': '}
      {:else}
        {systemText}
      {/if}</span
    >
  {/if}
  {#if parsedMessageSegments}
    <span
      class="chat-text"
      style={isActionMessage(message.message) ? `color: ${message.color}` : ''}
    >
      {#each parsedMessageSegments.entries() || [] as [index, segment] ((message.getId(), index))}
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
              onmouseenter={() => mouseUpdateEmote(segment)}
              onmousemove={() => mouseUpdateEmote(segment)}
              onmouseleave={() => {
                if (enableEmotePreviews) onMouseLeavePreviewElement()
              }}
            />
            {#each segment.attachedEmotes?.entries() || [] as [attachedIndex, attachedEmote] ((message.getId(), index, attachedIndex))}
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
          </span>
        {:else if segment.type === 'url'}
          <button
            class="chat-url"
            class:visited={urlTracker.isVisitedUrl(segment.url)}
            onclick={() => handleUrlClick(segment.url)}
            onmouseenter={() => mouseUpdateUrl(segment)}
            onmousemove={() => mouseUpdateUrl(segment)}
            onmouseleave={() => {
              if (enableLinkPreviews) onMouseLeavePreviewElement()
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

  .chat-message.first-message {
    background-color: rgba(0, 255, 0, 0.1);
  }

  .chat-time {
    color: #a9a9a9;
    margin-right: 0.2rem;
  }
  .chat-username {
    margin-left: 0.1rem;
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

  .chat-badges {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    vertical-align: middle;
  }

  .chat-badge {
    height: 1.45rem;
    object-fit: contain;
    display: inline-flex;
    align-items: center;
    vertical-align: text-bottom;
  }
</style>
