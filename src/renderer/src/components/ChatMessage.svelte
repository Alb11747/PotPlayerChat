<script lang="ts">
  import { isActionMessage, parseFullMessage, type Segment } from '@/renderer/src/core/chat-dom'
  import { formatTime } from '@/utils/strings'
  import {
    setConfig,
    TwitchBadgeService,
    TwitchCheerEmoteService,
    TwitchEmoteService,
    TwitchUserService
  } from '@core/chat/twitch-api'
  import type { CheerEmote, NativeTwitchEmote } from '@core/chat/twitch-emotes'
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import { Collection, TwitchEmote, type Emote } from '@mkody/twitch-emoticons'

  import type { HelixChatBadgeVersion } from '@twurple/api'
  import { onMount } from 'svelte'
  import conf from '../state/config'
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
    elapsedTime?: number
    urlTracker: UrlTracker
    usernameColorMap?: Map<string, { color: string; timestamp: number }>
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    onUsernameClick?: (info: { username: string }) => void
    onEmoteLoad?: (emote: CheerEmote | TwitchEmote | NativeTwitchEmote) => void
    enableLinkPreviews?: boolean
    enableEmotePreviews?: boolean
    enableEmotes?: boolean
    enableBadges?: boolean
    requireHttpInUrl?: boolean
    reloadServicesFunction?: () => void
  }

  let {
    message,
    videoStartTime,
    videoEndTime,
    elapsedTime,
    urlTracker,
    usernameColorMap,
    searchQuery,
    onUrlClick,
    onUsernameClick,
    onEmoteLoad,
    enableLinkPreviews = settings.interface.enableLinkPreviews,
    enableEmotePreviews = settings.interface.enableEmotePreviews,
    enableEmotes = settings.interface.enableEmotes,
    enableBadges = settings.interface.enableBadges,
    requireHttpInUrl = settings.interface.requireHttpInUrl,
    reloadServicesFunction = $bindable()
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

  let channelUserId: number | null = $state(null)
  let badges: [string, HelixChatBadgeVersion][] = $state([])
  const badgeInfo: Map<string, string> | undefined = $derived(
    message.type === 'chat' ? message.badgeInfo : undefined
  )
  const subscriberMonths: string | undefined = $derived(badgeInfo?.get('subscriber'))
  let cheerEmotes: Map<string, CheerEmote> | null = $state.raw(null)

  async function loadServices(): Promise<void> {
    setConfig(conf)

    const id = await TwitchUserService.getUserIdByName(message.channel)
    if (id) channelUserId = parseInt(id, 10)

    if (enableBadges) {
      // Load badge service
      loadBadges()
    }

    if (enableEmotes) {
      // Load emote service
      loadEmotes()
      // Load cheer emote service
      loadCheerEmotes().then(loadEmotes)
    }
  }

  onMount(() => {
    reloadServicesFunction = loadServices
    return () => {
      if (reloadServicesFunction === loadServices) reloadServicesFunction = undefined
    }
  })

  async function loadBadges(): Promise<void> {
    if (!channelUserId || !message || message.type !== 'chat') return
    const badgeList = message.badges
    if (!badgeList) return
    badges.length = 0
    for (const [badgeId, version] of badgeList) {
      const badgeData = await TwitchBadgeService.getBadgeInfo(
        badgeId,
        version,
        channelUserId.toString()
      )
      if (badgeData) badges.push([badgeId, badgeData])
    }
  }

  async function loadCheerEmotes(): Promise<void> {
    if (!message.bits || !channelUserId || !message.message) return
    const msgBits = parseInt(message.bits, 10)
    if (isNaN(msgBits)) return

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const cheerEmotesMap: Map<string, CheerEmote> = new Map()

    // Extract cheer emote names from message
    for (const [, emote, name, amount] of message.message.matchAll(
      /(?:^|\s)(([^\W\d]+)(\d+))(?:\s|$)/g
    )) {
      if (!emote || !name || !amount) continue
      const bits = parseInt(amount, 10)
      if (isNaN(bits)) continue // Skip if bits is not a number
      if (bits > msgBits) continue // Skip if bits is greater than message bits

      const info = await TwitchCheerEmoteService.getCheerEmoteInfo(
        name,
        bits,
        channelUserId?.toString()
      )
      if (info) cheerEmotesMap.set(emote, info)
    }

    cheerEmotes = cheerEmotesMap
  }

  onMount(loadServices)

  const [systemText, systemMsg] = $derived(
    message.type === 'system' ? message?.getSystemTextAndMessage() || [] : []
  )

  let emotes: Collection<string, Emote | CheerEmote> | null = $state(null)

  async function loadEmotes(): Promise<void> {
    // Get base emotes
    const tempEmotes = await TwitchEmoteService.getEmotes(channelUserId ?? undefined)
    if (tempEmotes && cheerEmotes) {
      const allEmotes = new Collection(tempEmotes) as Collection<string, Emote | CheerEmote>
      for (const [name, emote] of cheerEmotes.entries()) {
        allEmotes.set(name, emote)
      }
      emotes = allEmotes
    } else {
      emotes = tempEmotes
    }
  }

  // Highlight search terms in the message and parse emotes and parse emotes
  const { escapedUsername, parsedMessageSegments } = $derived.by(() => {
    if (!message || (message.type === 'system' && !systemMsg))
      return { escapedUsername: '', parsedMessageSegments: undefined }

    return parseFullMessage(message, {
      twitchEmotes: emotes ?? undefined,
      enableEmotes,
      showName: settings.interface.showName,
      searchQuery,
      requireHttpInUrl
    })
  })

  function isSeenUrl(url: string): boolean {
    if (urlTracker.isSeenUrl(url)) return true
    window.api.isUrlSeen(url).then((isSeen) => {
      if (isSeen) urlTracker.markSeenUrl(url)
    })
    return urlTracker.isSeenUrl(url)
  }
  function isVisitedUrl(url: string): boolean {
    if (urlTracker.isVisitedUrl(url)) return true
    window.api.isUrlClicked(url).then((isVisited) => {
      if (isVisited) urlTracker.markVisitedUrl(url)
    })
    return urlTracker.isVisitedUrl(url)
  }

  function mouseUpdateEmote(segment: Segment & { type: 'emote' | 'cheer' }): void {
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

<div
  class="chat-message"
  class:first-message={message.type === 'chat' && message.firstMsg === '1'}
  data-timestamp={message.timestamp}
>
  {#if settings.interface.showTimestamps}
    <span class="chat-time color-muted mr-0.5">
      {formatTime(message.timestamp, {
        startTime: videoStartTime,
        endTime: videoEndTime,
        elapsedTime
      })}
    </span>
  {/if}
  {#if message.type === 'chat'}
    {#if enableBadges && badges.length > 0}
      <span class="chat-badges inline-flex items-center justify-center gap-0.5 align-middle">
        {#each badges as [badgeId, badge] (badgeId)}
          <img
            class="chat-badge h-5.8 object-contain inline-flex items-center align-text-bottom"
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
    <span
      class="chat-username ml-0.5 font-bold"
      role="link"
      tabindex="-1"
      style="color: {message.color}"
      onclick={() => onUsernameClick?.(message)}
      onkeydown={(e) => e.key === 'Enter' && onUsernameClick?.(message)}
      style:cursor={onUsernameClick ? 'pointer' : 'inherit'}
    >
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html escapedUsername + ': '}
    </span>
  {:else if message.type === 'system'}
    <span class="chat-system whitespace-pre-wrap text-system"
      >{#if parsedMessageSegments}
        {systemText + ': '}
      {:else}
        {systemText}
      {/if}</span
    >
  {/if}
  {#if parsedMessageSegments}
    <span
      class="chat-text whitespace-pre-wrap"
      style={message.type === 'chat' && isActionMessage(message.message)
        ? `color: ${message.color}`
        : ''}
    >
      {#each parsedMessageSegments.entries() || [] as [index, segment] ((message.getId(), index))}
        {#if (segment.type === 'emote' || segment.type === 'cheer') && !urlTracker.isFailedUrl(segment.url)}
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
            {:else if segment.type === 'cheer'}
              <span class="bits">
                {segment.bits}
              </span>
            {/if}
          </span>
        {:else if segment.type === 'url'}
          <button
            class="chat-url"
            class:visited={isVisitedUrl(segment.url)}
            class:seen={isSeenUrl(segment.url)}
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
            role="link"
            tabindex="-1"
            class="chat-username"
            style="color: {usernameColorMap?.get(segment.username)?.color || '#ffffff'}"
            onclick={() => onUsernameClick?.(segment)}
            onkeydown={(e) => e.key === 'Enter' && onUsernameClick?.(segment)}
            style:cursor={onUsernameClick ? 'pointer' : 'inherit'}
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
    word-break: break-word;
    user-select: text;
    cursor: default;
  }

  .chat-message.first-message {
    background-color: var(--color-success-alpha);
  }

  .chat-username {
    margin-left: 0.1rem;
    font-weight: bold;
  }
  .chat-text {
    white-space: pre-wrap;
  }
  .chat-system {
    color: var(--color-text-system);
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

  .chat-url {
    width: fit-content;
    height: fit-content;
    text-align: left;
    justify-content: flex-start;
    display: inline;
    font: inherit;
    color: var(--color-accent);
    text-decoration: underline;
    cursor: pointer;
    transition: color 0.2s ease;
    background: none;
    border: none;
    outline: none;
    padding: 0;
    margin: 0;
  }
  .chat-url.seen {
    color: var(--color-accent-light);
  }
  .chat-url:hover {
    color: var(--color-accent-hover);
    text-decoration: none;
  }
  .chat-url.visited,
  .chat-url:focus-visible {
    color: var(--color-accent-purple);
  }

  :global(mark) {
    background: var(--color-accent);
    color: var(--color-white);
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
