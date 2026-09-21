<script lang="ts">
  import { isActionMessage, type Segment } from '@/renderer/src/core/chat-dom'
  import { MessagePresentationStore, presentationOptions } from '../core/message-presentation'
  import type { TwitchMessage } from '@core/chat/twitch-msg'

  import type { TimelineMap } from '@/utils/datastructs'
  import { onMount, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { UrlTracker, type LinkPreview } from '../core/url-tracker'
  import type { UsernameClickInfo } from '../core/username-click'
  import {
    clearPreview,
    focusPreviewElement,
    currentPreviewType,
    onMouseLeavePreviewElement,
    previewState
  } from '../state/preview.svelte'
  import { settings } from '../state/settings.svelte'
  import { usernameColor } from '../state/username-contrast.svelte'
  import {
    openPreviewPopup,
    restorePreviewTrigger,
    shouldOpenExpandedPreview
  } from '../core/preview-window'
  import EmoteComponent from './Emote.svelte'

  interface Props {
    message: TwitchMessage
    presentationStore?: MessagePresentationStore
    videoStartTime?: number
    videoEndTime?: number
    elapsedTime?: number
    urlTracker: UrlTracker
    usernameColorTimelineMap?: Pick<TimelineMap<string, string>, 'get'>
    searchQuery?: string | RegExp
    onUrlClick?: (url: string) => void
    onUsernameClick?: (info: UsernameClickInfo) => void
    enableLinkPreviews?: boolean
    enableEmotePreviews?: boolean
    enableEmotes?: boolean
    enableBadges?: boolean
    requireHttpInUrl?: boolean
    reloadServicesFunction?: () => void
  }

  let {
    message,
    presentationStore = new MessagePresentationStore(),
    videoStartTime,
    videoEndTime,
    elapsedTime,
    urlTracker,
    usernameColorTimelineMap,
    searchQuery,
    onUrlClick,
    onUsernameClick,
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

  const badgeInfo = $derived(message.type === 'chat' ? message.badgeInfo : undefined)
  const subscriberMonths = $derived(badgeInfo?.get('subscriber'))
  const options = $derived(
    presentationOptions({
      videoStartTime,
      videoEndTime,
      elapsedTime,
      searchQuery,
      enableEmotes,
      enableBadges,
      requireHttpInUrl
    })
  )
  const presentation = $derived(presentationStore.get(message, options))
  const escapedMessagePrefix = $derived(presentation.prefix)
  const parsedMessageSegments = $derived(presentation.segments)
  const badges = $derived(presentation.badges)

  async function loadServices(): Promise<void> {
    try {
      await presentationStore.load(message, options)
    } catch (error) {
      console.error('Failed to load message assets:', error)
    }
  }
  $effect(() => {
    // Only mounted rows fetch services. The transcript retains resolved parsing on recycle.
    void message
    void enableBadges
    void enableEmotes
    untrack(() => void loadServices())
  })
  onMount(() => {
    reloadServicesFunction = loadServices
    return () => {
      if (reloadServicesFunction === loadServices) reloadServicesFunction = undefined
    }
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

  $effect(() => {
    const element = chatMessageElement
    void urlTracker.cacheVersion
    if (
      !element ||
      orderedUrlSegments.length === 0 ||
      !settings.interface.enableInlineImagePreviews
    )
      return

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

  const inlineUrlSegments = $derived(
    orderedUrlSegments.filter((segment) => getInlineImagePreview(segment.url) !== null)
  )

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
  {#if presentation.timestamp}
    <span class="chat-time color-muted mr-0.5" data-message-part="time"
      >{presentation.timestamp}</span
    >
  {/if}
  {#if message.type === 'chat'}
    {#if enableBadges && badges.length > 0}
      <span class="chat-badges">
        {#each badges as [badgeId, badge] (badgeId)}
          {#if badge}
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
          {:else}
            <span class="chat-badge badge-placeholder" aria-hidden="true"></span>
          {/if}
        {/each}
      </span>
    {/if}
    <span
      class="chat-username ml-0.5 font-bold"
      data-message-part="prefix"
      role="link"
      tabindex={onUsernameClick ? 0 : -1}
      style:color={usernameColor(message.color, settings.interface.improveUsernameContrast)}
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
    <span data-message-part="prefix" class="chat-system whitespace-pre-wrap text-system"
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
        ? `color: ${usernameColor(message.color, settings.interface.improveUsernameContrast)}`
        : ''}
    >
      {#each parsedMessageSegments || [] as segment (`${message.getId()}-${segment.index}`)}
        <span data-message-part={`segment-${segment.index}`}>
          {#if (segment.type === 'emote' || segment.type === 'cheer') && Object.values(segment.urls).some((url) => !urlTracker.isFailedUrl(url))}
            <EmoteComponent {message} {segment} {urlTracker} {enableEmotePreviews} />
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
              style:color={usernameColor(
                usernameColorTimelineMap?.get(segment.username.toLowerCase(), message.timestamp),
                settings.interface.improveUsernameContrast,
                '#ffffff'
              )}
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
        </span>
      {/each}
    </span>
  {/if}
  {#if settings.interface.enableInlineImagePreviews && inlineUrlSegments.length > 0}
    <div class="inline-image-previews">
      {#each inlineUrlSegments as segment (`${message.getId()}-inline-${segment.index}`)}
        {@const preview = getInlineImagePreview(segment.url)}
        {#if preview?.thumbnail}
          <a
            href={segment.url}
            class="inline-image-preview-link"
            data-message-part={`preview-${segment.index}`}
            style:cursor={settings.interface.openInlineImagePreviewsOnClick ? 'pointer' : 'default'}
            onclick={(event) => onInlineImageClick(event, segment.url)}
          >
            <img
              src={preview.thumbnail}
              alt="Preview"
              class="inline-image-preview"
              class:loading={!urlTracker.getImageDimensions(preview.thumbnail)}
              loading="lazy"
              decoding="async"
              onload={async (event) => {
                const image = event.currentTarget
                if (!(image instanceof HTMLImageElement)) return
                try {
                  await image.decode()
                } catch {
                  if (image.isConnected) urlTracker.markFailedUrl(segment.url)
                  return
                }
                if (!image.isConnected) return
                urlTracker.recordImageDimensions(preview.thumbnail!, image)
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
    font-size: var(--deck-message-size, 1.09375rem);
    box-sizing: border-box;
    word-break: break-word;
    user-select: text;
    cursor: default;
  }

  .chat-time {
    font-size: var(--deck-timestamp-size, 0.90625rem);
    font-variant-numeric: tabular-nums;
    color: var(--deck-muted);
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
    color: var(--chat-link-color);
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
    color: var(--chat-link-seen-color);
  }
  .chat-url:hover {
    color: var(--chat-link-hover-color);
    text-decoration: none;
  }
  .chat-url.visited {
    color: var(--chat-link-visited-color);
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
    gap: 0.125rem;
    vertical-align: middle;
  }

  .chat-badge {
    width: var(--deck-badge-size, 1.5rem);
    height: var(--deck-badge-size, 1.5rem);
    object-fit: contain;
  }

  .inline-image-previews {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-block: 0.45rem;
    max-width: 100%;
  }

  .inline-image-preview-link {
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    cursor: pointer;
  }

  .inline-image-preview.loading {
    height: 1em;
  }

  .inline-image-preview {
    display: block;
    margin-inline: auto;
    max-width: min(30rem, 100%);
    max-height: 20rem;
    border-radius: 0.35rem;
    object-fit: contain;
    border: 1px solid var(--color-gray-5);
    background: var(--color-black-deep);
  }
</style>
