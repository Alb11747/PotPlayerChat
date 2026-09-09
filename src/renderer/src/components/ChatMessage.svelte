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

  import type { TimelineMap } from '@/utils/datastructs'
  import type { HelixChatBadgeVersion } from '@twurple/api'
  import { onMount, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { UrlTracker, type LinkPreview } from '../core/url-tracker'
  import type { UsernameClickInfo } from '../core/username-click'
  import conf from '../state/config'
  import {
    clearPreview,
    focusPreviewElement,
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '../state/preview.svelte'
  import { settings } from '../state/settings.svelte'
  import {
    openPreviewPopup,
    restorePreviewTrigger,
    shouldOpenExpandedPreview
  } from '../core/preview-window'
  import EmoteComponent from './Emote.svelte'

  interface Props {
    message: TwitchMessage
    videoStartTime?: number
    videoEndTime?: number
    elapsedTime?: number
    urlTracker: UrlTracker
    usernameColorTimelineMap?: TimelineMap<string, string>
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    onUsernameClick?: (info: UsernameClickInfo) => void
    onEmoteLoad?: (data: {
      emote: CheerEmote | TwitchEmote | NativeTwitchEmote
      hash: string
    }) => void
    onImageLoad?: () => void
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
    usernameColorTimelineMap,
    searchQuery,
    onUrlClick,
    onUsernameClick,
    onEmoteLoad,
    onImageLoad,
    enableLinkPreviews: enableLinkPreviewsOverride,
    enableEmotePreviews: enableEmotePreviewsOverride,
    enableEmotes: enableEmotesOverride,
    enableBadges: enableBadgesOverride,
    requireHttpInUrl: requireHttpInUrlOverride,
    reloadServicesFunction = $bindable()
  }: Props = $props()

  const enableLinkPreviews = $derived(
    enableLinkPreviewsOverride ?? settings.interface.enableLinkPreviews
  )
  const enableEmotePreviews = $derived(
    enableEmotePreviewsOverride ?? settings.interface.enableEmotePreviews
  )
  const enableEmotes = $derived(enableEmotesOverride ?? settings.interface.enableEmotes)
  const enableBadges = $derived(enableBadgesOverride ?? settings.interface.enableBadges)
  const requireHttpInUrl = $derived(requireHttpInUrlOverride ?? settings.interface.requireHttpInUrl)

  let chatMessageElement: HTMLDivElement | null = $state(null)

  function handleUrlClick(url: string, event: MouseEvent | KeyboardEvent): void {
    if (
      shouldOpenExpandedPreview(enableLinkPreviews, settings.interface.previewMode, event.ctrlKey)
    ) {
      const trigger = event.currentTarget as HTMLElement
      clearPreview()
      openPreviewPopup({
        kind: 'link',
        url,
        tracker: urlTracker,
        restoreFocus: () => restorePreviewTrigger(trigger)
      })
      return
    }
    urlTracker.markVisitedUrl(url)
    if (onUrlClick) {
      onUrlClick(url)
    } else {
      window.api.openUrl(url)
    }
  }

  let channelUserId: number | null = $state(null)
  let badges: [string, HelixChatBadgeVersion][] = $state([])
  const badgeInfo: Map<string, string> | undefined = $derived(
    message.type === 'chat' ? message.badgeInfo : undefined
  )
  const subscriberMonths: string | undefined = $derived(badgeInfo?.get('subscriber'))
  let cheerEmotes: Map<string, CheerEmote> | null = $state.raw(null)

  async function loadServices(
    requested = { badges: enableBadges, emotes: enableEmotes }
  ): Promise<void> {
    setConfig(conf)

    if (!message || !message.channel) return
    const id = await TwitchUserService.getUserIdByName(message.channel)
    if (id) channelUserId = parseInt(id, 10)

    if (requested.badges) await loadBadges()

    if (requested.emotes) {
      // Load emote service
      await loadCheerEmotes()
      await loadEmotes()
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
    const loadedBadges: [string, HelixChatBadgeVersion][] = []
    for (const [badgeId, version] of badgeList) {
      const badgeData = await TwitchBadgeService.getBadgeInfo(
        badgeId,
        version,
        channelUserId.toString()
      )
      if (badgeData) loadedBadges.push([badgeId, badgeData])
    }
    badges = loadedBadges
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

  let previousServiceFlags = { badges: false, emotes: false }
  $effect(() => {
    const enabled = { badges: enableBadges, emotes: enableEmotes }
    const requested = {
      badges: enabled.badges && !previousServiceFlags.badges,
      emotes: enabled.emotes && !previousServiceFlags.emotes
    }
    previousServiceFlags = enabled
    // Mounted rows survive Settings. Fetch only newly enabled assets; appearance
    // changes and disabling a feature must not refetch either service.
    if (requested.badges || requested.emotes) untrack(() => void loadServices(requested))
  })

  const [systemText, systemMsg]: [string | undefined, string | undefined] = $derived(
    (message.type === 'system' ? message?.getSystemTextAndMessage() : undefined) ?? [
      undefined,
      undefined
    ]
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

  // Highlight search terms in the message and parse emotes
  const [escapedMessagePrefix, parsedMessageSegments]: [string, Segment[] | undefined] =
    $derived.by(() => {
      if (!message) return ['', undefined]
      return parseFullMessage(message, {
        messagePrefix: systemText,
        messageStr: message.type === 'system' ? (systemMsg ?? null) : undefined,
        twitchEmotes: emotes ?? undefined,
        enableEmotes,
        showName: settings.interface.showName,
        searchQuery,
        requireHttpInUrl
      })
    })

  const primedUrlStatus = new SvelteSet<string>()

  async function ensureUrlStatus(url: string): Promise<void> {
    if (primedUrlStatus.has(url)) return
    primedUrlStatus.add(url)
    const [seenResult, visitedResult] = await Promise.allSettled([
      window.api.isUrlSeen(url),
      window.api.isUrlClicked(url)
    ])
    if (seenResult.status === 'fulfilled' && seenResult.value) urlTracker.markSeenUrl(url)
    if (visitedResult.status === 'fulfilled' && visitedResult.value) urlTracker.markVisitedUrl(url)
  }

  $effect(() => {
    for (const segment of parsedMessageSegments ?? []) {
      if (segment.type !== 'url') continue
      void ensureUrlStatus(segment.url)
    }
  })

  function isSeenUrl(url: string): boolean {
    return urlTracker.isSeenUrl(url)
  }
  function isVisitedUrl(url: string): boolean {
    return urlTracker.isVisitedUrl(url)
  }

  function mouseUpdateUrl(segment: Segment & { type: 'url' }): void {
    if (enableLinkPreviews && settings.interface.previewMode === 'hover' && !currentPreviewType()) {
      previewState.url = segment.url
      previewState.urlTrackerInstance = urlTracker
    }
    if (previewState.url === segment.url) previewState.lastUpdateTime = performance.now()
  }

  const orderedUrlSegments: Array<Segment & { type: 'url' }> = $derived.by(() =>
    (parsedMessageSegments ?? []).filter(
      (segment): segment is Segment & { type: 'url' } => segment.type === 'url'
    )
  )

  function fetchInlineImagePreviews(): void {
    for (const segment of orderedUrlSegments) {
      if (urlTracker.hasPreview(segment.url) || urlTracker.isFailedUrl(segment.url)) continue
      void urlTracker.getPreview(segment.url)
    }
  }

  onMount(() => {
    const element = chatMessageElement
    if (!element || orderedUrlSegments.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!settings.interface.enableInlineImagePreviews) return
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          fetchInlineImagePreviews()
        }
      },
      {
        root: null,
        threshold: 0
      }
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  })

  function getInlineImagePreview(url: string): LinkPreview | null {
    const preview = urlTracker.getCachedPreview(url)
    if (!preview) return null
    if (!preview.thumbnail || preview.status < 200 || preview.status >= 300) return null
    if (urlTracker.isFailedUrl(url)) return null
    return preview
  }

  function onInlineImageClick(event: MouseEvent, url: string): void {
    event.preventDefault()
    event.stopPropagation()

    if (!settings.interface.openInlineImagePreviewsOnClick) return

    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }
</script>

<div
  bind:this={chatMessageElement}
  class="chat-message"
  class:first-message={message.type === 'chat' && message.firstMsg === '1'}
  data-timestamp={message.timestamp}
>
  {#if settings.interface.showTimestamps}
    <span class="chat-time color-muted mr-0.5">
      {#if settings.interface.absoluteTimestamps}
        {formatTime(message.timestamp)}
      {:else}
        {formatTime(message.timestamp, {
          offset: settings.chat.timestampOffset + settings.chat._sessionTimestampOffset,
          startTime: videoStartTime,
          endTime: videoEndTime,
          elapsedTime
        })}
      {/if}
    </span>
  {/if}
  {#if message.type === 'chat'}
    {#if enableBadges && badges.length > 0}
      <span class="chat-badges inline-flex items-center justify-center align-middle">
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
      tabindex={onUsernameClick ? 0 : -1}
      style="color: {message.color}"
      onclick={(e) => {
        if (onUsernameClick) {
          onUsernameClick({ username: message.username, message, altKey: e.altKey })
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onkeydown={(e) =>
        e.key === 'Enter' &&
        onUsernameClick?.({ username: message.username, message, altKey: e.altKey })}
      style:cursor={onUsernameClick ? 'pointer' : 'inherit'}
    >
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html escapedMessagePrefix + ': '}
    </span>
  {:else if message.type === 'system'}
    <span class="chat-system whitespace-pre-wrap text-system"
      >{#if parsedMessageSegments}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html escapedMessagePrefix + ': '}
      {:else}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html escapedMessagePrefix}
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
      {#each parsedMessageSegments || [] as segment (`${message.getId()}-${segment.index}`)}
        {#if (segment.type === 'emote' || segment.type === 'cheer') && Object.values(segment.urls).some((url) => !urlTracker.isFailedUrl(url))}
          <EmoteComponent {message} {segment} {urlTracker} {onEmoteLoad} {enableEmotePreviews} />
        {:else if segment.type === 'url'}
          <a
            href={segment.url}
            class="chat-url"
            aria-describedby={previewState.url === segment.url
              ? 'potplayerchat-hover-preview'
              : undefined}
            class:visited={isVisitedUrl(segment.url)}
            class:seen={isSeenUrl(segment.url)}
            onclick={(e) => {
              handleUrlClick(segment.url, e)
              e.preventDefault()
              e.stopPropagation()
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault()
                e.stopPropagation()
                handleUrlClick(segment.url, e)
              }
              if (e.key === 'Escape') clearPreview()
            }}
            onfocus={(e) => {
              focusPreviewElement(e.currentTarget)
              mouseUpdateUrl(segment)
            }}
            onblur={clearPreview}
            onmouseenter={() => mouseUpdateUrl(segment)}
            onmousemove={() => mouseUpdateUrl(segment)}
            onmouseleave={() => {
              if (enableLinkPreviews) onMouseLeavePreviewElement()
            }}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html segment.escaped}
          </a>
        {:else if segment.type === 'mention'}
          <span
            role="link"
            tabindex={onUsernameClick ? 0 : -1}
            class="chat-username"
            style="color: {usernameColorTimelineMap?.get(
              segment.username.toLowerCase(),
              message.timestamp
            ) || '#ffffff'}"
            onclick={(e) => {
              if (onUsernameClick) {
                onUsernameClick({ username: segment.username, message, altKey: e.altKey })
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onkeydown={(e) =>
              e.key === 'Enter' &&
              onUsernameClick?.({ username: segment.username, message, altKey: e.altKey })}
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
  {#if settings.interface.enableInlineImagePreviews && orderedUrlSegments.length > 0}
    <div class="inline-image-previews">
      {#each orderedUrlSegments as segment (`${message.getId()}-inline-${segment.index}`)}
        {@const preview = getInlineImagePreview(segment.url)}
        {#if preview?.thumbnail}
          <a
            href={segment.url}
            class="inline-image-preview-link"
            style:cursor={settings.interface.openInlineImagePreviewsOnClick ? 'pointer' : 'default'}
            onclick={(event) => onInlineImageClick(event, segment.url)}
          >
            <img
              src={preview.thumbnail}
              alt="Preview"
              class="inline-image-preview"
              loading="lazy"
              decoding="async"
              onload={() => {
                if (onImageLoad) onImageLoad()
              }}
              onerror={() => {
                urlTracker.markFailedUrl(segment.url)
              }}
            />
          </a>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .chat-message {
    width: 100%;
    padding: var(--deck-message-gap, 2px) 0.6rem;
    line-height: var(--deck-message-line-height, 1.5);
    font-size: var(--deck-message-size, 13px);
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
    outline-offset: 2px;
    padding: 0;
    margin: 0;
  }
  .chat-url:focus-visible,
  .chat-username:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
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
    margin: 0.05rem 0;
    gap: 0.2rem;
    vertical-align: middle;
  }

  .chat-badge {
    height: 1.45rem;
    object-fit: contain;
    vertical-align: text-bottom;
  }

  .inline-image-previews {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.45rem;
    max-width: 100%;
  }

  .inline-image-preview-link {
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    cursor: pointer;
  }

  .inline-image-preview {
    display: block;
    max-width: min(30rem, 100%);
    max-height: 20rem;
    border-radius: 0.35rem;
    object-fit: contain;
    border: 1px solid var(--color-gray-5);
    background: var(--color-black-deep);
  }
</style>
