<script lang="ts">
  import { setConfig, TwitchUserService, type TwitchUserProfile } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { isRangeInMessages } from '@/utils/chat'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { VList } from 'virtua/svelte'
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

  let { context }: { context: UserWindowContext } = $props()

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const urlTracker = new UrlTracker(settings.chat)
  const seenMessages = new SvelteSet<string>()

  let profile: TwitchUserProfile | null = $state(null)
  let profileLoaded = $state(false)
  let avatarFailed = $state(false)
  let historyLoaded = $state(false)
  let messages: TwitchChatMessage[] = $state.raw([])
  let copiedField: 'username' | 'id' | null = $state(null)
  let copyResetTimeout: ReturnType<typeof setTimeout> | null = null
  let vlistRef: VList<TwitchChatMessage> | null = $state(null)
  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})

  const clickedSenderMessage = $derived(
    isMessageFromUser(context.clickedMessage, context.username) ? context.clickedMessage : null
  )
  const mostRecentMessage = $derived(messages.at(-1) ?? clickedSenderMessage)
  const displayName = $derived(
    profile?.displayName || clickedSenderMessage?.displayName || context.username
  )
  const login = $derived(profile?.login || context.username)
  const userId = $derived(profile?.id || clickedSenderMessage?.userId || null)
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
    profile = await TwitchUserService.getUserProfileByName(context.username)
    profileLoaded = true
    if (profile) document.title = `${profile.displayName} - PotPlayer Chat`
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
    try {
      const potplayerInfo = context.potplayerInfo
      await chatService.updateVideoInfo(potplayerInfo, -1)
      loadMessages(getMessagesFromUser(context.initialMessages, context.username))
      loadMessages(getMessagesFromUser(context.loadedMessages, context.username))

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
        console.warn('Failed to load additional user history:', error)
      }
    } finally {
      historyLoaded = true
      scrollToRelevantMessage()
    }
  }

  function scrollToRelevantMessage(): void {
    setTimeout(() => {
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
    try {
      await navigator.clipboard.writeText(value)
      copiedField = field
      if (copyResetTimeout) clearTimeout(copyResetTimeout)
      copyResetTimeout = setTimeout(() => {
        copiedField = null
      }, 1500)
    } catch (error) {
      console.warn(`Failed to copy ${field}:`, error)
    }
  }

  function openUsercard(): void {
    window.api.openUrl(`https://www.twitch.tv/${encodeURIComponent(login)}`)
  }

  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }

  function handleAppCacheCleared(): void {
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

<div class="user-window">
  <section class="profile-header">
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
      <div class="profile-row primary-row">
        <span class="display-name" style:color={usernameColor}>{displayName}</span>
        {#if displayName.toLowerCase() !== login.toLowerCase()}
          <span class="login">({login})</span>
        {/if}
        <button
          type="button"
          class="icon-button"
          title={copiedField === 'username' ? 'Copied username' : 'Copy username'}
          aria-label="Copy username"
          onclick={() => copyText(login, 'username')}
        >
          {copiedField === 'username' ? '✓' : '▣'}
        </button>
      </div>

      <div class="profile-row">
        <span class="label">ID:</span>
        <span class="profile-value">{userId ?? 'Unavailable'}</span>
        {#if userId}
          <button
            type="button"
            class="icon-button"
            title={copiedField === 'id' ? 'Copied ID' : 'Copy ID'}
            aria-label="Copy Twitch user ID"
            onclick={() => copyText(userId, 'id')}
          >
            {copiedField === 'id' ? '✓' : '▣'}
          </button>
        {/if}
      </div>

      <div class="profile-row">
        <span class="label">Created:</span>
        <span class="profile-value">
          {profile
            ? formatCreatedAt(profile.createdAt)
            : profileLoaded
              ? 'Unavailable'
              : 'Loading…'}
        </span>
      </div>
    </div>
  </section>

  <nav class="profile-actions" aria-label="User actions">
    <button type="button" onclick={openUsercard}>Usercard</button>
  </nav>

  <section class="history-section">
    <div class="history-header">
      <span>Messages from {displayName}</span>
      <span class="history-count">{messages.length}</span>
    </div>

    <div class="history-list">
      {#if messages.length > 0}
        <VList
          bind:this={vlistRef}
          data={messages}
          getKey={(item, index) => item?.getId() ?? index}
          itemSize={64}
        >
          {#snippet children(message, index)}
            {#if message}
              <button
                type="button"
                class="history-item"
                onclick={() => context.focusMessage(message)}
              >
                <ChatMessage
                  {message}
                  videoStartTime={chatService.currentPotPlayerInfo?.startTime}
                  videoEndTime={chatService.currentPotPlayerInfo?.endTime}
                  {urlTracker}
                  usernameColorTimelineMap={chatService.usernameColorTimelineMap}
                  onUrlClick={handleUrlClick}
                  enableLinkPreviews={false}
                  bind:reloadServicesFunction={reloadServicesFunctionMap[index]}
                />
              </button>
            {/if}
          {/snippet}
        </VList>
      {:else if !historyLoaded}
        <div class="history-state">Loading message history…</div>
      {:else}
        <div class="history-state">No messages from {displayName} in this range.</div>
      {/if}
    </div>
  </section>
</div>

<style>
  .user-window {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--color-text-light);
    background: #0e0e10;
    user-select: text;
  }

  .profile-header {
    display: grid;
    grid-template-columns: 156px minmax(0, 1fr);
    gap: 22px;
    padding: 18px;
    min-height: 192px;
  }

  .avatar-frame {
    width: 156px;
    height: 156px;
    overflow: hidden;
    background: var(--color-black-deep);
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
    color: var(--color-text-muted);
    font-size: 64px;
    font-weight: 600;
  }

  .profile-details {
    min-width: 0;
    padding-top: 2px;
  }

  .profile-row {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 32px;
    gap: 7px;
    font-size: 17px;
    line-height: 1.3;
  }

  .primary-row {
    min-height: 38px;
    font-size: 20px;
  }

  .display-name {
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .login,
  .label {
    color: var(--color-text-muted);
  }

  .login {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-button {
    flex: 0 0 auto;
    padding: 3px 6px;
    border: 0;
    color: var(--color-text-muted);
    background: transparent;
    cursor: pointer;
    font-size: 15px;
  }

  .icon-button:hover,
  .icon-button:focus-visible {
    color: var(--color-white);
  }

  .profile-actions {
    display: flex;
    justify-content: center;
    padding: 12px 16px;
    border-top: 1px solid var(--color-gray-5);
    border-bottom: 1px solid var(--color-gray-5);
  }

  .profile-actions button {
    padding: 4px 20px;
    border: 0;
    color: var(--color-text-light);
    background: transparent;
    cursor: pointer;
    font-size: 17px;
  }

  .profile-actions button:hover,
  .profile-actions button:focus-visible {
    color: var(--color-white);
    text-decoration: underline;
  }

  .history-section {
    min-height: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-gray-4);
    font-size: 13px;
  }

  .history-count {
    min-width: 28px;
    padding: 0 7px;
    border-radius: 10px;
    color: var(--color-text-light);
    background: var(--color-gray-3);
    text-align: center;
  }

  .history-list {
    min-height: 0;
    flex: 1;
  }

  .history-item {
    min-width: 100%;
    width: fit-content;
    padding: 7px 12px;
    border: 0;
    border-bottom: 1px solid #1f1f23;
    color: inherit;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .history-item:hover,
  .history-item:focus-visible {
    background: var(--color-bg-hover);
    outline: none;
  }

  .history-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--color-text-muted);
    text-align: center;
  }

  @media (max-width: 500px) {
    .profile-header {
      grid-template-columns: 112px minmax(0, 1fr);
      gap: 14px;
      min-height: 148px;
    }

    .avatar-frame {
      width: 112px;
      height: 112px;
    }

    .profile-row {
      min-height: 27px;
      font-size: 14px;
    }

    .primary-row {
      font-size: 17px;
    }
  }
</style>
