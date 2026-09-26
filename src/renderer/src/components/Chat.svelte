<script lang="ts">
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import MessageTranscript from './MessageTranscript.svelte'
  import type { TranscriptHandle } from '../core/transcript-handle'

  import { onMount, tick, untrack } from 'svelte'

  import { clearAll, TwitchUserService } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import { isEqualMessageBoundary, playbackMessageWindow } from '@/renderer/src/core/chat-view'
  import { openSearchPopup, type SearchOptions } from '@/renderer/src/core/search-window'
  import { SharedSearchDataCache } from '@/renderer/src/core/search-data'
  import { selectSearchPreview, type SearchPreview } from '../core/search-preview'
  import { getUsernameClickAction, type UsernameClickInfo } from '../core/username-click'
  import { openUserPopup } from '../core/user-window'
  import type { PotPlayerInstance } from '@/types/potplayer'
  import { deleteNullishKeysInPlace, isEqual } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'

  import type { HWND } from '@/types/globals'
  import LinkPreview from '../components/LinkPreview.svelte'
  import Settings from '../components/Settings.svelte'
  import { clearRendererCache, clearRendererSavedUrls } from '../core/maintenance'
  import { UrlTracker } from '../core/url-tracker'
  import {
    getSessionTimestampOffsetByTitle,
    saveSettings,
    setSessionTimestampOffsetByTitle,
    settings
  } from '../state/settings.svelte'
  import ChatMessage from './ChatMessage.svelte'
  import Icon from './Icon.svelte'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const sharedSearchData = new SharedSearchDataCache()
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker(settings.chat)

  type SelectedPotplayerInfo = PotPlayerInfo | (PotPlayerInstance & Partial<PotPlayerInfo>)
  let selectedPotplayerInfo: SelectedPotplayerInfo | null = $state(null)

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let showSettings = $state(false)
  let showOffset = $state(false)
  let playbackTime = $state<number | null>(null)
  let settingsButton: HTMLButtonElement | null = $state(null)
  let instanceTabs: HTMLDivElement | null = $state(null)
  const canSearch = $derived.by(() =>
    Boolean(selectedPotplayerInfo?.startTime && selectedPotplayerInfo?.endTime)
  )
  const statusLabel = $derived.by(() =>
    !selectedPotplayerInfo
      ? 'No player selected'
      : loadingState.state === 'loading'
        ? 'Loading chat'
        : loadingState.state === 'error'
          ? 'Chat unavailable'
          : loadingState.state === 'chat-not-found'
            ? 'Chat not found'
            : loadingState.state === 'no-potplayer-info'
              ? 'Recording unavailable'
              : scrollToBottom
                ? 'Following playback'
                : 'Reading earlier messages'
  )

  function clockText(time: number | null): string {
    if (time === null || !selectedPotplayerInfo) return '--:--:--'
    const seconds = Math.max(0, Math.floor(time / 1000))
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':')
  }

  function retainReadingPosition(): void {
    vlistRef?.preservePosition()
  }

  async function toggleSettings(): Promise<void> {
    if (!showSettings) retainReadingPosition()
    showSettings = !showSettings
    await tick()
    if (!showSettings) {
      scrollToTarget()
      settingsButton?.focus()
    }
  }

  function adjustSessionOffset(delta: number): void {
    if (!selectedPotplayerInfo?.title) return
    settings.chat._sessionTimestampOffset += delta
    setSessionTimestampOffsetByTitle(
      selectedPotplayerInfo.title,
      settings.chat._sessionTimestampOffset
    )
    void updateChatMessages()
  }

  function handleTabKey(event: KeyboardEvent): void {
    const tabs = Array.from(instanceTabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const index = tabs.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  let changingPotPlayerPromise: Promise<SelectedPotplayerInfo | null> | null = $state(null)
  let potPlayerSelectionNonce = 0
  let instanceUpdateNonce = 0

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)
  let viewingHistory = false
  let navigationGeneration = 0

  let vlistRef: TranscriptHandle | null = $state(null)
  let scrollToBottom: boolean = $state(true)

  function scrollToTarget(_scrollToBottom?: boolean): void {
    const _vlistRef = untrack(() => vlistRef)
    const _messages = untrack(() => messages)
    _scrollToBottom = _scrollToBottom ?? untrack(() => scrollToBottom)
    if (_scrollToBottom) _vlistRef?.scrollToIndex(_messages.length - 1, { align: 'end' })
  }

  function messageElapsedTime(message: TwitchMessage): number | undefined {
    return selectedPotplayerInfo?.startTime
      ? Math.floor(
          message.timestamp -
            selectedPotplayerInfo.startTime -
            settings.chat.timestampOffset -
            settings.chat._sessionTimestampOffset
        )
      : undefined
  }

  function scrollChatToBottom(): void {
    const generation = ++navigationGeneration
    viewingHistory = false
    showOffset = false
    scrollToBottom = true
    const resume = (): void => {
      if (generation === navigationGeneration && scrollToBottom && !viewingHistory)
        scrollToTarget(true)
    }
    void updateChatMessages().then(resume)
    void tick().then(resume)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return Boolean(
      target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    )
  }

  async function resetVideoTimeHistory(
    hwnd: HWND | null,
    isCurrent: () => boolean
  ): Promise<boolean> {
    const time = hwnd ? await window.api.getCurrentVideoTime(hwnd) : null
    if (!isCurrent()) return false
    videoTimeHistory.clear()
    playbackTime = time
    if (playbackTime !== null) videoTimeHistory.addSample(playbackTime)
    return true
  }

  async function getSelectedPotplayerInstance(
    instances: (PotPlayerInstance & { selected?: boolean })[]
  ): Promise<PotPlayerInstance | null> {
    if (instances.length === 1) return instances[0]!
    let selectedPotplayerInstance = instances.find((i) => i.selected)
    if (selectedPotplayerInstance?.hwnd) return selectedPotplayerInstance
    const selectedHwnd = await window.api.getSelectedPotPlayerHWND()
    if (!selectedHwnd) return null
    return instances.find((i) => i.hwnd === selectedHwnd) ?? null
  }

  let isPotplayerUpdated: boolean = false
  async function onPotPlayerInstancesChanged(
    instances: (PotPlayerInstance & { selected?: boolean })[]
  ): Promise<void> {
    isPotplayerUpdated = true
    const updateNonce = ++instanceUpdateNonce
    let selectionNonce = potPlayerSelectionNonce
    const isCurrent = (): boolean =>
      updateNonce === instanceUpdateNonce && selectionNonce === potPlayerSelectionNonce
    potplayerInstances = instances
    if (instances.length === 0) {
      potPlayerSelectionNonce++
      navigationGeneration++
      changingPotPlayerPromise = null
      viewingHistory = false
      scrollToBottom = true
      potplayerInstances = []
      selectedPotplayerInfo = null
      messages = []
      playbackTime = null
      videoTimeHistory.clear()
      await chatService.updateVideoInfo(null)
      return
    }

    if (changingPotPlayerPromise) await changingPotPlayerPromise
    if (!isCurrent()) return
    // Reconcile the event after a manual selection: it may describe a newer title.
    const selectedPotplayerInstance = await getSelectedPotplayerInstance(instances)
    if (!isCurrent()) return

    if (
      !selectedPotplayerInstance ||
      (selectedPotplayerInstance.hwnd === selectedPotplayerInfo?.hwnd &&
        selectedPotplayerInstance.title === selectedPotplayerInfo?.title)
    )
      return

    const newSelectedPotplayerInstanceInfo = await window.api.getPotplayerExtraInfo(
      $state.snapshot(selectedPotplayerInstance)
    )
    if (!isCurrent()) return

    if (
      selectedPotplayerInfo?.hwnd !== newSelectedPotplayerInstanceInfo?.hwnd ||
      selectedPotplayerInfo?.title !== newSelectedPotplayerInstanceInfo?.title
    ) {
      viewingHistory = false
      navigationGeneration++
      selectionNonce = ++potPlayerSelectionNonce
      scrollToBottom = true
    }
    selectedPotplayerInfo = newSelectedPotplayerInstanceInfo
    settings.chat._sessionTimestampOffset = getSessionTimestampOffsetByTitle(
      selectedPotplayerInfo?.title
    )
    if (selectedPotplayerInfo && selectedPotplayerInfo.channel && selectedPotplayerInfo.startTime) {
      await chatService.updateVideoInfo({
        ...selectedPotplayerInfo,
        channel: selectedPotplayerInfo.channel,
        startTime: selectedPotplayerInfo.startTime
      })
    } else {
      await chatService.updateVideoInfo(null)
    }

    if (!isCurrent()) return
    if (!(await resetVideoTimeHistory(selectedPotplayerInfo?.hwnd ?? null, isCurrent))) return
    await updateChatMessages()
  }

  async function onSetOffset({ targetTimestamp }: { targetTimestamp: number }): Promise<void> {
    if (!selectedPotplayerInfo) return
    const { hwnd, startTime, title } = selectedPotplayerInfo
    const selectionNonce = potPlayerSelectionNonce
    if (!startTime) return

    const currentVideoTime = await window.api.getCurrentVideoTime(hwnd)
    if (selectionNonce !== potPlayerSelectionNonce) return
    const currentOffset = settings.chat.timestampOffset
    const sessionTimestampOffset = targetTimestamp - (startTime + currentVideoTime) - currentOffset
    setSessionTimestampOffsetByTitle(title, sessionTimestampOffset)

    settings.chat._sessionTimestampOffset = sessionTimestampOffset
    scrollChatToBottom()
  }

  $effect(() => {
    const title = selectedPotplayerInfo?.title
    if (!title) return
    settings.chat._sessionTimestampOffset = getSessionTimestampOffsetByTitle(title)
  })

  let chatIntervalId: ReturnType<typeof setTimeout> | null = null
  async function updateChatMessages(potplayerInfo?: SelectedPotplayerInfo | null): Promise<void> {
    const selectionNonce = potPlayerSelectionNonce
    if (chatIntervalId) clearTimeout(chatIntervalId)
    chatIntervalId = null

    if (!potplayerInfo && changingPotPlayerPromise) potplayerInfo = await changingPotPlayerPromise
    if (!potplayerInfo) potplayerInfo = selectedPotplayerInfo
    if (selectionNonce !== potPlayerSelectionNonce || !potplayerInfo?.startTime) return

    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const timestampOffset = settings.chat.timestampOffset + settings.chat._sessionTimestampOffset
    const effectiveTime = predictedTime + timestampOffset
    const fetchedMessages = await chatService.getMessagesForTime(effectiveTime, true)
    if (selectionNonce !== potPlayerSelectionNonce || viewingHistory) return
    if (!fetchedMessages || fetchedMessages.length === 0) {
      messages = []
      return
    }

    const { messages: newMessages, nextVideoTime } = playbackMessageWindow(
      fetchedMessages,
      potplayerInfo.startTime,
      predictedTime,
      timestampOffset
    )

    if (!isEqual(selectedPotplayerInfo, potplayerInfo)) {
      viewingHistory = false
      selectedPotplayerInfo = potplayerInfo ?? null
      messages = newMessages
      scrollToBottom = true
      scrollToTarget()
    } else if (!isEqualMessageBoundary(messages, newMessages)) {
      messages = newMessages
    }

    if (nextVideoTime !== undefined) {
      const waitTime = videoTimeHistory.getPredictedTimeUntil(nextVideoTime)
      if (waitTime !== null)
        chatIntervalId = setTimeout(
          updateChatMessages,
          Math.min(2_147_483_647, Math.max(1, waitTime))
        )
    }
  }

  $effect(() => {
    // Trigger reactivity when chat service state changes
    if (loadingState.state) untrack(() => updateChatMessages())
  })

  function onCurrentTime(time: number): void {
    playbackTime = time
    videoTimeHistory.addSample(time)
    void updateChatMessages()
  }

  // Update potplayer instances if data is not available immediately
  onMount(() => {
    let id: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
      id = null
      if (isPotplayerUpdated) return
      const instances = await window.api.getPotPlayers()
      if (!isPotplayerUpdated) void onPotPlayerInstancesChanged(instances)
    }, 500)
    return () => id && clearTimeout(id)
  })

  onMount(() => {
    updateChatMessages()

    const onCurrentTimeEvent: Parameters<typeof window.api.onSetCurrentTime>[0] = (_, ...args) =>
      onCurrentTime(...args)
    window.api.onSetCurrentTime(onCurrentTimeEvent)

    const onPotPlayerInstancesChangedEvent: Parameters<
      typeof window.api.onPotPlayerInstancesChanged
    >[0] = (_, ...args) => onPotPlayerInstancesChanged(...args)
    window.api.onPotPlayerInstancesChanged(onPotPlayerInstancesChangedEvent)

    const onSetOffsetEvent: Parameters<typeof window.api.onSetOffset>[0] = (_, ...args) =>
      onSetOffset(...args)
    window.api.onSetOffset(onSetOffsetEvent)

    return () => {
      if (chatIntervalId) clearTimeout(chatIntervalId)
      window.api.offSetCurrentTime(onCurrentTimeEvent)
      window.api.offPotPlayerInstancesChanged(onPotPlayerInstancesChangedEvent)
      window.api.offSetOffset(onSetOffsetEvent)
    }
  })

  function onFocusMessage(message: TwitchMessage): void {
    showSettings = false
    window.focus()
    if (!vlistRef) return
    const messageId = message.getId()
    const messageIndex = messages.findIndex((m) => m.getId() === messageId)
    if (messageIndex === -1) return
    scrollToBottom = false
    vlistRef.scrollToIndex(messageIndex, { align: 'center' })
  }

  function setPotPlayerInstance(instanceInfo: PotPlayerInstance | PotPlayerInfo | null): void {
    viewingHistory = false
    navigationGeneration++
    const currentSelectionNonce = ++potPlayerSelectionNonce
    instanceUpdateNonce++
    const isCurrent = (): boolean => currentSelectionNonce === potPlayerSelectionNonce
    changingPotPlayerPromise = (async (): Promise<PotPlayerInfo | null> => {
      const instance = $state.snapshot(instanceInfo)
      const hwnd = instance?.hwnd

      showSettings = false
      scrollToBottom = true
      if (!hwnd) {
        autoSelectPotPlayer = true
        await window.api.setSelectedPotPlayerHWND(null)
        return null
      }
      autoSelectPotPlayer = false
      await window.api.setSelectedPotPlayerHWND(hwnd)
      if (!isCurrent()) return null

      // A captured popup source may refer to an older recording in the same HWND.
      const currentSelectedPotPlayerInfo = await window.api.getPotplayerExtraInfo(instance)
      if (!currentSelectedPotPlayerInfo) return null

      if (currentSelectionNonce !== potPlayerSelectionNonce) return null
      selectedPotplayerInfo = currentSelectedPotPlayerInfo
      settings.chat._sessionTimestampOffset = getSessionTimestampOffsetByTitle(
        currentSelectedPotPlayerInfo.title
      )
      if (!(await resetVideoTimeHistory(hwnd, isCurrent))) return null
      await chatService.updateVideoInfo(currentSelectedPotPlayerInfo)
      if (currentSelectionNonce !== potPlayerSelectionNonce) return null
      await updateChatMessages(currentSelectedPotPlayerInfo)
      return currentSelectedPotPlayerInfo
    })()

    void (async () => {
      try {
        await changingPotPlayerPromise
      } finally {
        if (currentSelectionNonce === potPlayerSelectionNonce) changingPotPlayerPromise = null
      }
      if (currentSelectionNonce === potPlayerSelectionNonce) {
        const updateNonce = instanceUpdateNonce
        const instances = await window.api.getPotPlayers()
        if (isCurrent() && updateNonce === instanceUpdateNonce) potplayerInstances = instances
      }
    })()
  }

  type PopupSource = {
    potplayerInfo: PotPlayerInfo
    initialMessages: TwitchMessage[]
    loadedMessages: TwitchMessage[]
    searchRange: { startTime: number; endTime: number }
    preview: SearchPreview
  }

  function capturePopupSource(focused?: TwitchMessage): PopupSource | null {
    if (!selectedPotplayerInfo?.startTime || !selectedPotplayerInfo.endTime) return null
    const player = $state.snapshot(selectedPotplayerInfo) as PotPlayerInfo
    const capturedEndTime = player.startTime + (playbackTime ?? 0)
    const previewMessages = selectSearchPreview(messages, chatService.currentChatData, focused)
    return {
      potplayerInfo: player,
      initialMessages: messages,
      loadedMessages: chatService.currentChatData,
      preview: {
        messages: previewMessages,
        presentation: vlistRef?.capturePresentation?.(
          previewMessages,
          chatService.usernameColorTimelineMap
        )
      },
      searchRange: settings.search.showAllMessages
        ? { startTime: player.startTime - 3600000, endTime: player.endTime! + 3600000 }
        : { startTime: capturedEndTime - 3600000, endTime: capturedEndTime }
    }
  }

  function openSearchWindow(
    info?: Partial<SearchOptions>,
    extraData?: { message?: TwitchMessage },
    source = capturePopupSource(extraData?.message)
  ): void {
    if (!source) return
    openSearchPopup({
      ...source,
      ...info,
      sharedData: sharedSearchData,
      focusedMessage: extraData?.message,
      focusMessage: (message) => focusSourceMessage(message, source),
      onUsernameClick: (clicked) => handleUsernameClick(clicked, source)
    })
  }

  function openUserWindow(info: UsernameClickInfo, source = capturePopupSource()): void {
    if (!source) return
    openUserPopup({
      ...source,
      username: info.username,
      clickedMessage: info.message,
      focusMessage: (message) => focusSourceMessage(message, source),
      onUsernameClick: (clicked) => handleUsernameClick(clicked, source),
      searchUsername: (username) =>
        openSearchWindow({ initialSearch: username.trim().replace(/:$/, '') }, undefined, source)
    })
  }

  function handleUsernameClick(info: UsernameClickInfo, source?: PopupSource | null): void {
    const action = getUsernameClickAction(info.username, info.altKey)
    if (action.kind === 'user') openUserWindow(info, source ?? capturePopupSource())
    else
      openSearchWindow(
        { initialSearch: action.initialSearch },
        { message: info.message },
        source ?? capturePopupSource(info.message)
      )
  }

  async function focusSourceMessage(message: TwitchMessage, source: PopupSource): Promise<void> {
    if (
      selectedPotplayerInfo?.hwnd !== source.potplayerInfo.hwnd ||
      selectedPotplayerInfo?.title !== source.potplayerInfo.title
    ) {
      setPotPlayerInstance(source.potplayerInfo)
      const selectionNonce = potPlayerSelectionNonce
      const selected = await changingPotPlayerPromise
      if (
        selectionNonce !== potPlayerSelectionNonce ||
        selected?.hwnd !== source.potplayerInfo.hwnd ||
        selected?.title !== source.potplayerInfo.title
      )
        return
    }
    // Search can expose messages outside the current playback window. Keep this
    // bounded history slice visible until the user explicitly resumes playback.
    if (!messages.some((item) => item.getId() === message.getId())) {
      const history = new Map(
        [...source.loadedMessages, ...source.initialMessages, message].map((item) => [
          item.getId(),
          item
        ])
      )
      const ordered = [...history.values()].sort((a, b) => a.timestamp - b.timestamp)
      const index = ordered.findIndex((item) => item.getId() === message.getId())
      const limit = Math.max(1, settings.chat.chatMessageLimit)
      const start = Math.max(0, index - Math.floor(limit / 2))
      messages = ordered.slice(start, start + limit)
    }
    const generation = ++navigationGeneration
    viewingHistory = true
    showSettings = false
    await tick()
    if (generation === navigationGeneration) onFocusMessage(message)
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && showSettings) {
      event.preventDefault()
      void toggleSettings()
      return
    }
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !isEditableTarget(event.target) &&
      event.key === 'Enter'
    ) {
      event.preventDefault()
      scrollChatToBottom()
      return
    }

    if (!selectedPotplayerInfo) return
    if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      if (canSearch) openSearchWindow()
    } else if ((event.ctrlKey && event.key === 'r') || (event.altKey && event.key === 'r')) {
      event.preventDefault()
      chatService.clearInvalidCache()
      window.api.clearLinkPreviewCache()
      urlTracker.clearCache()
      const channel = selectedPotplayerInfo.channel
      if (!channel) return
      void (async () => {
        const userId = await TwitchUserService.getUserIdByName(channel)
        clearAll(userId ?? undefined)
        reloadChatMessageServices()
      })()
    }
  }

  // Set up keyboard listener
  $effect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  })

  const reloadServicesFunctionMap: Record<number, (() => void) | undefined> = $state({})

  $effect(() => {
    deleteNullishKeysInPlace(reloadServicesFunctionMap)
  })

  function reloadChatMessageServices(): void {
    for (const reloadServicesFunction of Object.values(reloadServicesFunctionMap))
      reloadServicesFunction?.()
  }

  function handleAppCacheCleared(): void {
    vlistRef?.clearCache?.()
    clearRendererCache(chatService, urlTracker)
    reloadChatMessageServices()
  }

  function handleSavedUrlsCleared(): void {
    clearRendererSavedUrls(urlTracker)
  }

  onMount(() => {
    window.api.onAppCacheCleared(handleAppCacheCleared)
    window.api.onSavedUrlsCleared(handleSavedUrlsCleared)
    return () => {
      window.api.offAppCacheCleared(handleAppCacheCleared)
      window.api.offSavedUrlsCleared(handleSavedUrlsCleared)
    }
  })
</script>

<LinkPreview />

<div class="chat-shell" role="region" aria-label="Chat">
  <header class="chat-header" class:comfort={settings.interface.layout === 'comfort'}>
    <div
      class="instance-tabs"
      role="tablist"
      tabindex="-1"
      aria-label="PotPlayer instances"
      bind:this={instanceTabs}
      onkeydown={handleTabKey}
    >
      <button
        role="tab"
        aria-selected={autoSelectPotPlayer}
        tabindex={autoSelectPotPlayer ? 0 : -1}
        title="Automatically select the active PotPlayer"
        onclick={() => setPotPlayerInstance(null)}>Main</button
      >
      {#each potplayerInstances as inst (inst.hwnd)}
        <button
          class="recording-tab"
          role="tab"
          aria-selected={!autoSelectPotPlayer && inst.hwnd === selectedPotplayerInfo?.hwnd}
          tabindex={!autoSelectPotPlayer && inst.hwnd === selectedPotplayerInfo?.hwnd ? 0 : -1}
          title={inst.title}
          onclick={() => setPotPlayerInstance(inst)}>{inst.title}</button
        >
      {/each}
    </div>
    <div class="chat-tools">
      {#if settings.interface.layout === 'comfort'}<span class="channel-name"
          >{selectedPotplayerInfo?.channel ?? 'PotPlayerChat'}</span
        >{/if}
      <button
        class="icon-button"
        aria-label="Show timestamps"
        title="Show timestamps"
        aria-pressed={settings.interface.showTimestamps}
        onclick={() => {
          retainReadingPosition()
          settings.interface.showTimestamps = !settings.interface.showTimestamps
          saveSettings()
          void tick().then(() => scrollToTarget())
        }}><Icon name="clock" /></button
      >
      <button
        class="icon-button"
        aria-label="Search chat"
        title="Search chat (Ctrl+F)"
        disabled={!canSearch}
        onclick={() => openSearchWindow()}><Icon name="search" /></button
      >
      <button
        class="icon-button"
        aria-label={showSettings ? 'Return to chat' : 'Settings'}
        title={showSettings ? 'Return to chat' : 'Settings'}
        aria-expanded={showSettings}
        bind:this={settingsButton}
        onclick={toggleSettings}><Icon name={showSettings ? 'back' : 'settings'} /></button
      >
    </div>
  </header>

  {#if !showSettings && !scrollToBottom}
    <section class="playback-context" aria-label="Playback context">
      <div class="status-row">
        <span class="playback-status" title={statusLabel}>{statusLabel}</span>
        <button class="return-button" onclick={scrollChatToBottom}>Return to playback</button>
        <button
          class="playback-time"
          title="Playback time — click to adjust session offset"
          aria-label={`Playback time ${clockText(playbackTime)}, adjust session offset`}
          aria-expanded={showOffset}
          disabled={!selectedPotplayerInfo?.title}
          onclick={() => {
            retainReadingPosition()
            showOffset = !showOffset
            void tick().then(() => scrollToTarget())
          }}><time>{clockText(playbackTime)}</time></button
        >
      </div>
      {#if showOffset}
        <div class="offset-controls">
          <span>Session offset</span>
          <button
            class="icon-button"
            aria-label="Decrease session offset by 0.5 seconds"
            onclick={() => adjustSessionOffset(-500)}><Icon name="minus" /></button
          >
          <output>{settings.chat._sessionTimestampOffset / 1000} s</output>
          <button
            class="icon-button"
            aria-label="Increase session offset by 0.5 seconds"
            onclick={() => adjustSessionOffset(500)}><Icon name="plus" /></button
          >
        </div>
      {/if}
    </section>
  {/if}

  {#if showSettings}<div class="settings-content">
      <Settings
        onSessionOffsetChange={(offset) => {
          setSessionTimestampOffsetByTitle(selectedPotplayerInfo?.title, offset)
          void updateChatMessages()
        }}
      />
    </div>{/if}
  <div class="chat-container" class:concealed={showSettings}>
    {#if messages && messages.length > 0}
      <MessageTranscript
        bind:this={vlistRef}
        data={messages}
        {urlTracker}
        videoStartTime={selectedPotplayerInfo?.startTime}
        videoEndTime={selectedPotplayerInfo?.endTime}
        getElapsedTime={messageElapsedTime}
        follow={scrollToBottom}
        preserveOnReplace={settings.interface.keepScrollPosition}
        onfollowchange={(following) => {
          scrollToBottom = following && !viewingHistory
        }}
        onuserinteraction={() => {
          navigationGeneration++
        }}
      >
        {#snippet children(msg, i, presentationStore)}
          <ChatMessage
            {presentationStore}
            message={msg}
            videoStartTime={selectedPotplayerInfo?.startTime}
            videoEndTime={selectedPotplayerInfo?.endTime}
            elapsedTime={messageElapsedTime(msg)}
            {urlTracker}
            usernameColorTimelineMap={chatService.usernameColorTimelineMap}
            onUsernameClick={handleUsernameClick}
            bind:reloadServicesFunction={reloadServicesFunctionMap[i]}
          />
        {/snippet}
      </MessageTranscript>
    {:else if loadingState?.state === 'loading'}
      <div class="chat-message system center">Loading chat...</div>
    {:else if loadingState?.state === 'error'}
      <div class="chat-message error center">{loadingState.errorMessage}</div>
    {:else if loadingState?.state === 'no-potplayer-info'}
      <div class="chat-message system center">
        No PotPlayer info available.<br />
        Try to pause and unpause the video or reopen the video.
      </div>
    {:else if loadingState?.state === 'chat-not-found'}
      <div class="chat-message system center">Chat data not found.</div>
    {:else if !selectedPotplayerInfo?.hwnd}
      <div class="chat-message system center">No PotPlayer instance selected.</div>
    {:else if !selectedPotplayerInfo?.startTime}
      <div class="chat-message system center">
        No start time set for the selected PotPlayer instance.
      </div>
    {:else}
      <div class="chat-message system">
        Unknown error occurred.<br />
        {#if (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV}
          <span>Loading state: {JSON.stringify(loadingState)}</span><br />
          <span>Selected PotPlayer Info: {JSON.stringify(selectedPotplayerInfo)}</span>
        {/if}
      </div>
    {/if}
  </div>
  <!-- Anchor the control outside the transcript's bottom spacing. -->
  {#if !showSettings && !scrollToBottom}
    <div class="scroll-to-bottom-overlay">
      <button class="scroll-to-bottom" onclick={scrollChatToBottom}>Scroll to bottom</button>
    </div>
  {/if}
</div>

<style>
  .chat-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--deck-bg);
  }
  .chat-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    flex: none;
    background: var(--deck-bg);
  }
  .instance-tabs {
    display: flex;
    gap: 3px;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .instance-tabs button {
    flex: 0 0 auto;
    min-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid transparent;
    background: transparent;
    color: var(--deck-muted);
    padding: 5px 8px;
    border-radius: 4px;
  }
  .instance-tabs .recording-tab {
    flex: 1 0 80px;
    text-align: left;
  }
  .instance-tabs button[aria-selected='true'] {
    background: var(--deck-selection);
    color: var(--deck-accent);
  }
  .chat-tools {
    display: flex;
    gap: 4px;
    align-items: center;
    flex: none;
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--deck-line);
    border-radius: 4px;
    color: var(--deck-muted);
    background: var(--deck-surface);
  }
  .icon-button[aria-pressed='true'] {
    color: var(--deck-accent);
    background: var(--deck-selection);
  }
  button {
    cursor: pointer;
    font: inherit;
  }
  button:hover:not(:disabled) {
    color: var(--deck-text);
    background: var(--deck-hover);
  }
  button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .comfort {
    flex-wrap: wrap;
    padding: 8px 10px;
    gap: 8px;
    border-bottom: 1px solid var(--deck-line);
  }
  .comfort .instance-tabs,
  .comfort .chat-tools {
    flex: 1 0 100%;
    width: 100%;
  }
  .channel-name {
    min-width: 0;
    flex: 1;
    color: var(--deck-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  time,
  output {
    flex: none;
    font-family: Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .settings-content,
  .chat-container {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .chat-container {
    position: relative;
    margin-bottom: 8px;
    color: var(--deck-text);
  }
  .chat-container :global(.virtual-transcript:focus) {
    /* Keep keyboard scrolling without outlining the entire main chat. */
    outline: none;
  }
  .concealed {
    display: none;
  }
  .scroll-to-bottom-overlay {
    position: absolute;
    inset-inline: 0;
    bottom: 8px;
    padding-inline: 6px;
    z-index: 5;
    /* Match the transcript's native gutter without covering its scrollbar hit target. */
    overflow-y: auto;
    scrollbar-gutter: stable;
    pointer-events: none;
  }
  .scroll-to-bottom {
    display: block;
    width: 100%;
    pointer-events: auto;
    min-height: 32px;
    padding: 6px 12px;
    border: 1px solid color-mix(in srgb, var(--deck-accent) 45%, transparent);
    border-radius: 4px;
    color: var(--deck-accent);
    background: color-mix(in srgb, var(--deck-bg) 85%, transparent);
    font-size: 12px;
    line-height: 18px;
  }
  .scroll-to-bottom:hover:not(:disabled) {
    border-color: var(--deck-accent);
    background: color-mix(in srgb, var(--deck-hover) 90%, transparent);
  }
  .playback-context {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px 9px;
    border-bottom: 1px solid var(--deck-line);
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--deck-muted);
    font-size: 11px;
  }
  .playback-status {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .playback-time,
  .return-button {
    flex: none;
    border: 0;
    border-radius: 3px;
    padding: 3px 5px;
    color: var(--deck-accent);
    background: transparent;
  }
  .return-button {
    background: var(--deck-selection);
  }
  .offset-controls {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--deck-muted);
  }
  .offset-controls > span {
    flex: 1;
  }
  .offset-controls output {
    min-width: 50px;
    text-align: center;
  }
  .system {
    color: var(--deck-muted);
    padding: 24px 18px;
    line-height: 1.6;
    user-select: text;
  }
  .error {
    color: var(--color-error-soft);
  }
  .center {
    text-align: center;
  }
</style>
