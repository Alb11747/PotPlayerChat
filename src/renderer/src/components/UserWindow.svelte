<script lang="ts">
  import { setConfig, TwitchUserService, type TwitchUserProfile } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { isRangeInMessages } from '@/utils/chat'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import MessageTranscript from './MessageTranscript.svelte'
  import type { TranscriptHandle } from '../core/transcript-handle'
  import { clearRendererCache, clearRendererSavedUrls } from '../core/maintenance'
  import {
    getMessagesFromUser,
    isMessageFromUser,
    type UserWindowContext
  } from '../core/user-window'
  import { UrlTracker } from '../core/url-tracker'
  import conf from '../state/config'
  import { settings } from '../state/settings.svelte'
  import ChatMessage from './ChatMessage.svelte'
  import LinkPreview from './LinkPreview.svelte'
  import Icon from './Icon.svelte'
  import { formatChatName } from '../core/chat-name'

  let { context }: { context: UserWindowContext } = $props()

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const urlTracker = new UrlTracker(settings.chat)
  const seenMessages = new SvelteSet<string>()

  let profile: TwitchUserProfile | null = $state(null)
  let profileLoaded = $state(false)
  let profileError = $state('')
  let historyError = $state('')
  let copyError = $state('')
  let avatarFailed = $state(false)
  let historyLoaded = $state(false)
  let messages: TwitchChatMessage[] = $state.raw([])
  let copiedField: 'username' | 'id' | null = $state(null)
  let copyResetTimeout: ReturnType<typeof setTimeout> | null = null
  let vlistRef: TranscriptHandle | null = $state(null)
  let historyNavigationGeneration = 0
  let readerInteracted = false
  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})

  const clickedSenderMessage = $derived(
    isMessageFromUser(context.clickedMessage, context.username) ? context.clickedMessage : null
  )
  const mostRecentMessage = $derived(messages.at(-1) ?? clickedSenderMessage)
  const displayName = $derived.by(
    () => profile?.displayName || clickedSenderMessage?.displayName || context.username
  )
  const login = $derived.by(() => profile?.login || context.username)
  const headerName = $derived(formatChatName(login, displayName, settings.interface.showName))
  const userId = $derived.by(() => profile?.id || clickedSenderMessage?.userId || null)
  const usernameColor = $derived(mostRecentMessage?.color || '#efeff1')

  onMount(() => {
    setConfig(conf)
    document.title = `${context.username} - PotPlayer Chat`
    window.api.onAppCacheCleared(handleAppCacheCleared)
    window.api.onSavedUrlsCleared(handleSavedUrlsCleared)
    void loadProfile()
    void loadHistory()

    return () => {
      window.api.offAppCacheCleared(handleAppCacheCleared)
      window.api.offSavedUrlsCleared(handleSavedUrlsCleared)
      if (copyResetTimeout) clearTimeout(copyResetTimeout)
    }
  })

  async function loadProfile(): Promise<void> {
    profileLoaded = false
    avatarFailed = false
    profileError = ''
    try {
      profile = await TwitchUserService.getUserProfileByName(context.username)
      if (profile) document.title = `${profile.displayName} - PotPlayer Chat`
      else profileError = 'Profile details are unavailable.'
    } catch (error) {
      profileError = 'Unable to load profile details.'
      console.warn(profileError, error)
    } finally {
      profileLoaded = true
    }
  }

  function loadMessages(newMessages: TwitchChatMessage[]): void {
    const additions = newMessages.filter((message) => {
      if (seenMessages.has(message.getId())) return false
      seenMessages.add(message.getId())
      return true
    })
    if (additions.length === 0) return

    messages = [...messages, ...additions].sort((a, b) => a.timestamp - b.timestamp)
    chatService.updateMessageData(messages)
  }

  async function loadHistory(): Promise<void> {
    historyLoaded = false
    historyError = ''
    try {
      const potplayerInfo = context.potplayerInfo
      await chatService.updateVideoInfo(potplayerInfo, -1)
      loadMessages(getMessagesFromUser(context.initialMessages, context.username))
      loadMessages(getMessagesFromUser(context.loadedMessages, context.username))
      scrollToRelevantMessage()

      try {
        const currentTime = await window.api.getCurrentVideoTime(potplayerInfo.hwnd)
        const defaultStartTime = potplayerInfo.startTime + currentTime - 60 * 60 * 1000
        const defaultEndTime = potplayerInfo.startTime + currentTime
        const { startTime = defaultStartTime, endTime = defaultEndTime } = context.searchRange || {}

        if (!isRangeInMessages(context.initialMessages, startTime, endTime)) {
          await chatService.updateVideoInfo(potplayerInfo, 0)
          const loadedMessages = await chatService.getMessagesBetweenTimes(startTime, endTime)
          loadMessages(getMessagesFromUser(loadedMessages, context.username))
        }
      } catch (error) {
        historyError = 'Additional message history is unavailable.'
        console.warn('Failed to load additional user history:', error)
      }
    } catch (error) {
      historyError = 'Unable to load message history.'
      console.warn(historyError, error)
    } finally {
      historyLoaded = true
      scrollToRelevantMessage()
    }
  }

  function scrollToRelevantMessage(): void {
    const generation = historyNavigationGeneration
    setTimeout(() => {
      if (readerInteracted || generation !== historyNavigationGeneration) return
      if (!vlistRef || messages.length === 0) return
      const clickedIndex = messages.findIndex(
        (message) => message.getId() === context.clickedMessage.getId()
      )
      vlistRef.scrollToIndex(clickedIndex >= 0 ? clickedIndex : messages.length - 1, {
        align: clickedIndex >= 0 ? 'center' : 'end'
      })
    }, 0)
  }

  async function copyText(value: string, field: 'username' | 'id'): Promise<void> {
    copyError = ''
    try {
      await navigator.clipboard.writeText(value)
      copiedField = field
      if (copyResetTimeout) clearTimeout(copyResetTimeout)
      copyResetTimeout = setTimeout(() => {
        copiedField = null
      }, 1500)
    } catch (error) {
      copyError = `Unable to copy ${field}.`
      console.warn(`Failed to copy ${field}:`, error)
    }
  }

  function openUsercard(): void {
    window.api.openUrl(`https://www.twitch.tv/${encodeURIComponent(login)}`)
  }

  function activateMessage(event: MouseEvent, message: TwitchChatMessage): void {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, [role="button"]')
    )
      return
    if (window.getSelection()?.toString()) return
    context.focusMessage(message)
  }

  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }

  function handleAppCacheCleared(): void {
    vlistRef?.clearCache?.()
    clearRendererCache(chatService, urlTracker)
    for (const reloadServicesFunction of Object.values(reloadServicesFunctionMap))
      reloadServicesFunction?.()
    void loadProfile()
  }

  function handleSavedUrlsCleared(): void {
    clearRendererSavedUrls(urlTracker)
  }

  function formatCreatedAt(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toISOString().slice(0, 10)
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && window.close()} />
<LinkPreview />

<div class="user-window">
  <section class="profile-header" aria-label="User profile">
    <div class="avatar-frame">
      {#if profile?.profilePictureUrl && !avatarFailed}
        <img
          src={profile.profilePictureUrl}
          alt={`${displayName}'s avatar`}
          onerror={() => (avatarFailed = true)}
        />
      {:else}
        <div class="avatar-fallback" aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
      {/if}
    </div>
    <div class="profile-details">
      <div class="profile-heading">
        <div class="profile-row primary-row">
          <span class="display-name" title={headerName} style:color={usernameColor}
            >{headerName}</span
          >
          <button
            type="button"
            class="copy-button"
            class:copied={copiedField === 'username'}
            title={copiedField === 'username' ? 'Copied username' : 'Copy username'}
            aria-label="Copy username"
            onclick={() => copyText(login, 'username')}
            ><Icon name={copiedField === 'username' ? 'check' : 'copy'} /></button
          >
        </div>
        <div class="profile-row metadata-row">
          <span class="label">ID</span><span class="profile-value" title={userId ?? 'Unavailable'}
            >{userId ?? 'Unavailable'}</span
          >
          {#if userId}<button
              type="button"
              class="copy-button"
              class:copied={copiedField === 'id'}
              title={copiedField === 'id' ? 'Copied ID' : 'Copy ID'}
              aria-label="Copy Twitch user ID"
              onclick={() => copyText(userId, 'id')}
              ><Icon name={copiedField === 'id' ? 'check' : 'copy'} /></button
            >{/if}
        </div>
      </div>
      <div class="profile-row created-row">
        <span class="label">Created</span><span
          >{profile
            ? formatCreatedAt(profile.createdAt)
            : profileLoaded
              ? 'Unavailable'
              : 'Loading…'}</span
        >
      </div>
    </div>
    <div class="history-header">
      <div class="history-summary">
        <span class="history-label" title={`Messages from ${login}`}>Messages</span><span
          class="history-count">{messages.length}</span
        >
      </div>
      <button type="button" onclick={openUsercard}>Usercard</button>
      <button
        class="search-user"
        type="button"
        title="Search username"
        aria-label="Search username"
        onclick={() => context.searchUsername(context.username)}
        ><svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="m12 12 5 5" /></svg
        ></button
      >
    </div>
  </section>
  {#if profileError || copyError}
    <div class="profile-notice" role="status">
      <span>{copyError || profileError}</span>{#if profileError}<button
          type="button"
          onclick={() => loadProfile()}>Retry profile</button
        >{/if}
    </div>
  {/if}
  <span class="sr-only" role="status">{copiedField ? `Copied ${copiedField}.` : ''}</span>
  <section class="history-section" aria-label="Message history">
    {#if historyError || loadingState.state === 'error'}
      <div class="profile-notice" role="alert">
        <span>{historyError || loadingState.errorMessage}</span><button
          type="button"
          disabled={!historyLoaded}
          onclick={() => loadHistory()}>Retry history</button
        >
      </div>
    {/if}
    <div class="history-list" aria-busy={!historyLoaded}>
      {#if messages.length > 0}
        <MessageTranscript
          bind:this={vlistRef}
          data={messages}
          {urlTracker}
          videoStartTime={chatService.currentPotPlayerInfo?.startTime}
          videoEndTime={chatService.currentPotPlayerInfo?.endTime}
          gutter
          onuserinteraction={() => {
            readerInteracted = true
            historyNavigationGeneration++
          }}
        >
          {#snippet children(message, index, presentationStore)}
            {#if message}
              <div
                class="history-item"
                role="group"
                aria-label="History message"
                onpointerup={(event) => {
                  if (event.button === 0) activateMessage(event, message)
                }}
              >
                <button
                  class="return-message"
                  type="button"
                  aria-label="Return to this message in chat"
                  title="Return to message in chat"
                  onclick={() => context.focusMessage(message)}>↩</button
                >
                <ChatMessage
                  {presentationStore}
                  {message}
                  videoStartTime={chatService.currentPotPlayerInfo?.startTime}
                  videoEndTime={chatService.currentPotPlayerInfo?.endTime}
                  {urlTracker}
                  usernameColorTimelineMap={chatService.usernameColorTimelineMap}
                  onUsernameClick={context.onUsernameClick}
                  onUrlClick={handleUrlClick}
                  bind:reloadServicesFunction={reloadServicesFunctionMap[index]}
                />
              </div>
            {/if}
          {/snippet}
        </MessageTranscript>
      {:else if !historyLoaded}
        <div class="history-state" role="status">Loading message history…</div>
      {:else if historyError}
        <div class="history-state">Message history is unavailable.</div>
      {:else}
        <div class="history-state">No messages from {login} in this range.</div>
      {/if}
    </div>
  </section>
</div>

<style>
  .user-window {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--deck-text);
    background: var(--deck-bg);
    user-select: text;
  }
  .profile-header {
    flex: none;
    display: grid;
    grid-template-columns: 144px minmax(0, 1fr);
    grid-template-rows: 1fr auto;
    gap: 12px;
    padding: 16px;
    align-items: start;
    background: var(--deck-surface);
    border-bottom: 1px solid var(--deck-line);
  }
  .avatar-frame {
    grid-row: 1 / 3;
    width: 144px;
    height: 144px;
    overflow: hidden;
    background: var(--deck-bg);
  }
  .avatar-frame img,
  .avatar-fallback {
    width: 100%;
    height: 100%;
  }
  .avatar-frame img {
    display: block;
    object-fit: cover;
  }
  .avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--deck-muted);
    font-size: 48px;
    font-weight: 600;
  }
  .profile-details {
    min-width: 0;
  }
  .profile-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .profile-row {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 23px;
    gap: 6px;
    font-size: 12px;
    line-height: 1.4;
  }
  .primary-row {
    flex: 1;
    min-width: 100px;
    font-size: 24px;
    font-weight: 650;
  }
  .display-name,
  .profile-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    color: var(--deck-muted);
  }
  .metadata-row {
    flex: none;
    font-size: 18px;
  }
  .created-row {
    margin-top: 7px;
    font-size: 16px;
  }
  .label {
    flex: none;
  }
  button {
    flex: none;
    min-height: 30px;
    padding: 4px 9px;
    border: 1px solid var(--deck-line);
    border-radius: 4px;
    color: var(--deck-text);
    background: var(--deck-surface);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  button:hover {
    background: var(--deck-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
  }
  .copy-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    min-height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--deck-muted);
    line-height: 1;
  }
  .copy-button:hover,
  .copy-button.copied {
    color: var(--deck-accent);
    background: var(--deck-hover);
  }
  .copy-button:focus-visible {
    outline-offset: 0;
  }
  .profile-notice {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11px;
    color: var(--deck-muted);
    border-bottom: 1px solid var(--deck-line);
  }
  .profile-notice span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .history-section {
    min-height: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
  }
  .history-header {
    grid-column: 2;
    align-self: end;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .history-header button {
    height: 38px;
    min-height: 38px;
    padding: 7px 12px;
    font-size: 16px;
    line-height: 20px;
  }
  .history-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-right: auto;
    color: var(--deck-muted);
    font-size: 14px;
  }
  .history-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .search-user {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
  }
  .history-header .search-user {
    padding: 8px;
  }
  @media (max-width: 480px) {
    .profile-header {
      grid-template-columns: 112px minmax(0, 1fr);
      grid-template-rows: auto auto;
    }
    .avatar-frame {
      grid-row: 1;
      width: 112px;
      height: 112px;
    }
    .avatar-fallback {
      font-size: 40px;
    }
    .primary-row {
      flex-basis: 100%;
      min-width: 0;
      font-size: 22px;
    }
    .metadata-row {
      font-size: 16px;
    }
    .created-row {
      margin-top: 3px;
      font-size: 15px;
    }
    .history-header {
      grid-column: 1 / -1;
    }
  }
  .history-list {
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
  .history-item {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    padding: var(--deck-message-gap, 5px) 30px var(--deck-message-gap, 5px) 12px;
    cursor: pointer;
    overflow-wrap: anywhere;
    font-size: var(--deck-message-size, 13px);
    line-height: var(--deck-message-line-height, 1.45);
  }
  .history-item:hover,
  .history-item:focus-within {
    background: var(--deck-hover);
  }
  .return-message {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    min-height: 24px;
    padding: 0;
    border-color: transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--deck-muted);
    opacity: 0;
  }
  .history-item:hover .return-message,
  .history-item:focus-within .return-message {
    opacity: 1;
  }
  .return-message:hover {
    background: var(--deck-selection);
    color: var(--deck-text);
  }
  .history-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--deck-muted);
    text-align: center;
    font-size: 13px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
