<script lang="ts">
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import { VList } from 'virtua/svelte'

  import { onMount, tick, untrack } from 'svelte'

  import { clearAll, TwitchUserService } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import { isEqualMessageBoundary } from '@/renderer/src/core/chat-view'
  import { openSearchPopup, type SearchOptions } from '@/renderer/src/core/search-window'
  import { getUsernameClickAction, type UsernameClickInfo } from '../core/username-click'
  import { openUserPopup } from '../core/user-window'
  import {
    calculateTargetElement,
    scrollToTarget as scrollToTargetBase
  } from '@/renderer/src/utils/vlist'
  import type { PotPlayerInstance } from '@/types/potplayer'
  import { deleteNullishKeysInPlace, isEqual, NumberObject } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'

  import type { HWND } from '@/types/globals'
  import { BoundedSet } from '@/utils/datastructs'
  import { debounce } from '@/utils/functions'
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
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker(settings.chat)
  const loadedEmotes = new BoundedSet<string>(200)

  type SelectedPotplayerInfo = PotPlayerInfo | (PotPlayerInstance & Partial<PotPlayerInfo>)
  let selectedPotplayerInfo: SelectedPotplayerInfo | null = $state(null)

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let showSettings = $state(false)
  let showOffset = $state(false)
  let playbackTime = $state<number | null>(null)
  let settingsButton: HTMLButtonElement | null = $state(null)
  let instanceTabs: HTMLDivElement | null = $state(null)
  const canSearch = $derived(
    Boolean(selectedPotplayerInfo?.startTime && selectedPotplayerInfo?.endTime)
  )
  const statusLabel = $derived(
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
    if (!scrollToBottom && vlistRef) {
      const target = calculateTargetElement(vlistRef, messages)
      targetElement = target.targetElement
      targetViewportOffset = target.targetViewportOffset
    }
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

  let previousLayout: string | undefined
  $effect(() => {
    // Capture the message anchor before the density change is measured by VList.
    const layout = settings.interface.layout
    if (layout === previousLayout) return
    previousLayout = layout
    untrack(() => {
      retainReadingPosition()
      void tick().then(() => scrollToTarget())
    })
  })

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
  let lastPotplayerChangeTime: number = performance.now()

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)
  let viewingHistory = false
  let navigationGeneration = 0

  let chatContainerRef: HTMLDivElement | null = $state(null)
  let vlistRef: VList<TwitchMessage> | null = $state(null)
  let targetElement: TwitchMessage | null = $state(null)
  let targetViewportOffset: NumberObject | number = 0
  let scrollToBottom: boolean = $state(true)
  let nextScrollKeepTarget: boolean = false

  const setNextScrollKeepTargetDebounced = debounce((value: boolean) => {
    nextScrollKeepTarget = value
  }, 5)

  function isAtBottom(): boolean | null {
    if (!vlistRef) return null
    let bottomY = vlistRef.getScrollOffset() + vlistRef.getViewportSize()
    let scrollSize = vlistRef.getScrollSize()
    if (bottomY >= scrollSize - 1) return true
    else if (bottomY >= scrollSize - 500) return null
    else return false
  }

  $effect(() => {
    const containerRef = chatContainerRef
    if (!containerRef) return

    const onUserScroll = (event: WheelEvent): void => {
      if (event.deltaY < 0) scrollToBottom = false

      if (typeof targetViewportOffset === 'object')
        targetViewportOffset.setValue(targetViewportOffset.valueOf() + event.deltaY)
      else targetViewportOffset += event.deltaY
    }

    containerRef.addEventListener('wheel', onUserScroll, { passive: true })
    return () => {
      // @ts-ignore svelte-check ignore
      containerRef.removeEventListener('wheel', onUserScroll, { passive: true })
    }
  })

  function clearTargetElement(): void {
    targetElement = null
    targetViewportOffset = 0
  }

  const scrollToTargetDebounced = debounce(scrollToTarget, 35)
  const doubleSpacebarThresholdMs = 350
  let lastSpacebarPressTime = 0

  function scrollToTarget(_scrollToBottom?: boolean): void {
    const _vlistRef = untrack(() => vlistRef)
    const _messages = untrack(() => messages)
    const _targetElement = untrack(() => targetElement)
    _scrollToBottom = _scrollToBottom ?? untrack(() => scrollToBottom)

    if (!_vlistRef || !_messages) return

    // The function vlist.scrollToIndex internally schedules a scroll until a measurement is done,
    // this is an issue since the target position of a scroll can change before the measurement is complete.
    // To avoid this, we use a modifiable NumberObject to store the targetViewportOffset,
    targetViewportOffset = NumberObject.ensureObject(targetViewportOffset)
    scrollToTargetBase(_vlistRef, _messages, {
      targetElement: _targetElement,
      targetViewportOffset: targetViewportOffset as unknown as number,
      scrollToBottom: _scrollToBottom
    })
  }

  function scrollChatToBottom(): void {
    const generation = ++navigationGeneration
    viewingHistory = false
    scrollToBottom = true
    const resume = (): void => {
      if (generation === navigationGeneration && scrollToBottom && !viewingHistory)
        scrollToTarget(true)
    }
    void updateChatMessages().then(resume)
    resume()
    setTimeout(resume, 100)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return Boolean(
      target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    )
  }

  async function resetVideoTimeHistory(hwnd: HWND | null): Promise<void> {
    videoTimeHistory.clear()
    playbackTime = hwnd ? await window.api.getCurrentVideoTime(hwnd) : null
    if (playbackTime !== null) videoTimeHistory.addSample(playbackTime)
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
      clearTargetElement()
      await chatService.updateVideoInfo(null)
      return
    }

    let newSelectedPotplayerInstanceInfo: SelectedPotplayerInfo | null = null
    if (changingPotPlayerPromise) newSelectedPotplayerInstanceInfo = await changingPotPlayerPromise
    potplayerInstances = instances

    if (!newSelectedPotplayerInstanceInfo) {
      const selectedPotplayerInstance = await getSelectedPotplayerInstance(instances)

      if (
        !selectedPotplayerInstance ||
        (selectedPotplayerInstance.hwnd === selectedPotplayerInfo?.hwnd &&
          selectedPotplayerInstance.title === selectedPotplayerInfo?.title)
      )
        return

      newSelectedPotplayerInstanceInfo = await window.api.getPotplayerExtraInfo(
        $state.snapshot(selectedPotplayerInstance)
      )
    }

    if (
      selectedPotplayerInfo?.hwnd !== newSelectedPotplayerInstanceInfo?.hwnd ||
      selectedPotplayerInfo?.title !== newSelectedPotplayerInstanceInfo?.title
    ) {
      viewingHistory = false
      navigationGeneration++
      potPlayerSelectionNonce++
      scrollToBottom = true
      clearTargetElement()
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

    await resetVideoTimeHistory(selectedPotplayerInfo?.hwnd ?? null)
    lastPotplayerChangeTime = performance.now()
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

    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const effectiveTime =
      predictedTime + settings.chat.timestampOffset + settings.chat._sessionTimestampOffset
    const newMessages = await chatService.getMessagesForTime(effectiveTime, true)
    if (selectionNonce !== potPlayerSelectionNonce || viewingHistory) return
    if (!newMessages || newMessages.length === 0) {
      messages = []
      return
    }

    const lastMessage = messages[messages.length - 1] || null
    const nextMessage =
      lastMessage && lastMessage.timestamp > predictedTime ? newMessages.pop() : null

    if (!isEqual(selectedPotplayerInfo, potplayerInfo)) {
      viewingHistory = false
      selectedPotplayerInfo = potplayerInfo ?? null
      messages = newMessages
      scrollToBottom = true
      clearTargetElement()
      scrollToTarget()
    } else if (!isEqualMessageBoundary(messages, newMessages)) {
      const _vlistRef = untrack(() => vlistRef)
      const _targetElement = untrack(() => targetElement)
      const _scrollToBottom = untrack(() => scrollToBottom)
      if (!settings.interface.keepScrollPosition) clearTargetElement()
      else if (_vlistRef && !_targetElement && !_scrollToBottom) {
        const target = calculateTargetElement(_vlistRef, messages)
        targetElement = target.targetElement
        targetViewportOffset = target.targetViewportOffset
      }

      messages = newMessages

      nextScrollKeepTarget = true
      setNextScrollKeepTargetDebounced(true)
      scrollToTarget()
    }

    if (nextMessage) {
      const waitTime = videoTimeHistory.getPredictedTimeUntil(nextMessage.timestamp)
      // console.debug(`Waiting ${waitTime}ms before fetching next messages`)
      if (waitTime !== null) chatIntervalId = setTimeout(updateChatMessages, waitTime)
    }
  }

  $effect(() => {
    // Trigger reactivity when chat service state changes
    if (loadingState.state) untrack(() => updateChatMessages())
  })

  function onCurrentTime(time: number): void {
    playbackTime = time
    videoTimeHistory.addSample(time)
    if (videoTimeHistory.wasLastSampleDiscontinuous()) {
      scrollToTargetDebounced(scrollToBottom)
      const lastTargetElement = targetElement
      updateChatMessages()
      if (lastTargetElement) targetElement = lastTargetElement
    } else {
      updateChatMessages()
    }
  }

  // Update potplayer instances if data is not available immediately
  onMount(() => {
    let id: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
      id = null
      if (isPotplayerUpdated) return
      potplayerInstances = await window.api.getPotPlayers()
      onPotPlayerInstancesChanged(potplayerInstances)
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
    targetElement = message
    targetViewportOffset = (vlistRef.getItemSize(messageIndex) - vlistRef.getViewportSize()) / 2
    scrollToBottom = false
    scrollToTarget()
    void tick().then(() => scrollToTarget())
  }

  function setPotPlayerInstance(instanceInfo: PotPlayerInstance | PotPlayerInfo | null): void {
    viewingHistory = false
    navigationGeneration++
    const currentSelectionNonce = ++potPlayerSelectionNonce
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
      if (!selectedPotplayerInfo) selectedPotplayerInfo = instanceInfo
      else selectedPotplayerInfo.hwnd = hwnd
      await window.api.setSelectedPotPlayerHWND(hwnd)
      await resetVideoTimeHistory(hwnd)

      // A captured popup source may refer to an older recording in the same HWND.
      const currentSelectedPotPlayerInfo = await window.api.getPotplayerExtraInfo(instance)
      if (!currentSelectedPotPlayerInfo) return null

      if (currentSelectionNonce !== potPlayerSelectionNonce) return null
      selectedPotplayerInfo = currentSelectedPotPlayerInfo
      settings.chat._sessionTimestampOffset = getSessionTimestampOffsetByTitle(
        currentSelectedPotPlayerInfo.title
      )
      clearTargetElement()
      await resetVideoTimeHistory(hwnd)
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
        potplayerInstances = await window.api.getPotPlayers()
      }
    })()
  }

  type PopupSource = {
    potplayerInfo: PotPlayerInfo
    initialMessages: TwitchMessage[]
    loadedMessages: TwitchMessage[]
    searchRange?: { startTime: number; endTime: number }
  }

  function capturePopupSource(): PopupSource | null {
    if (!selectedPotplayerInfo?.startTime || !selectedPotplayerInfo.endTime) return null
    const player = $state.snapshot(selectedPotplayerInfo) as PotPlayerInfo
    return {
      potplayerInfo: player,
      initialMessages: messages,
      loadedMessages: chatService.currentChatData,
      searchRange: settings.search.showAllMessages
        ? { startTime: player.startTime - 3600000, endTime: player.endTime! + 3600000 }
        : undefined
    }
  }

  function openSearchWindow(
    info?: Partial<SearchOptions>,
    extraData?: { message?: TwitchMessage },
    source = capturePopupSource()
  ): void {
    if (!source) return
    openSearchPopup({
      ...source,
      ...info,
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

  function handleUsernameClick(info: UsernameClickInfo, source = capturePopupSource()): void {
    const action = getUsernameClickAction(info.username, info.altKey)
    if (action.kind === 'user') openUserWindow(info, source)
    else
      openSearchWindow({ initialSearch: action.initialSearch }, { message: info.message }, source)
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
      (event.key === ' ' || event.code === 'Space')
    ) {
      const now = performance.now()
      if (now - lastSpacebarPressTime <= doubleSpacebarThresholdMs) {
        event.preventDefault()
        scrollChatToBottom()
        lastSpacebarPressTime = 0
      } else {
        lastSpacebarPressTime = now
      }
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
    clearRendererCache(chatService, urlTracker)
    loadedEmotes.clear()
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

<div class="container" role="region" aria-label="Chat">
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

  {#if !showSettings}
    <section class="playback-context" aria-label="Playback context">
      <div class="recording-row">
        <span title={selectedPotplayerInfo?.title}
          >{selectedPotplayerInfo?.channel
            ? selectedPotplayerInfo.channel + ' · '
            : ''}{selectedPotplayerInfo?.title ?? 'Waiting for a recording'}</span
        ><time>{clockText(playbackTime)}</time>
      </div>
      <div class="status-row">
        <span class="playback-status" title={statusLabel}>{statusLabel}</span>
        {#if !scrollToBottom}<button class="return-button" onclick={scrollChatToBottom}
            >Return to playback</button
          >{/if}
        <button
          class="offset-button"
          title="Adjust session timestamp offset"
          aria-expanded={showOffset}
          disabled={!selectedPotplayerInfo?.title}
          onclick={() => {
            retainReadingPosition()
            showOffset = !showOffset
            void tick().then(() => scrollToTarget())
          }}
          >Offset {settings.chat._sessionTimestampOffset > 0 ? '+' : ''}{settings.chat
            ._sessionTimestampOffset / 1000} s</button
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
  <div
    class="chat-container"
    class:concealed={showSettings}
    bind:this={chatContainerRef}
    onresize={() => {
      const lastScrollToBottom = scrollToBottom
      requestAnimationFrame(() => {
        scrollToBottom = lastScrollToBottom
        scrollToTarget()
      })
    }}
  >
    {#if messages && messages.length > 0}
      <VList
        bind:this={vlistRef}
        data={messages}
        getKey={(msg, i) => msg?.getId() ?? i}
        onscroll={() => {
          if (!nextScrollKeepTarget) {
            targetElement = null
            vlistRef?.scrollBy(0) // Cancel any pending scroll
          } else {
            setNextScrollKeepTargetDebounced(false)
          }

          if (viewingHistory || performance.now() - lastPotplayerChangeTime < 3000) return
          const currentIsAtBottom = isAtBottom()
          if (currentIsAtBottom !== null && currentIsAtBottom !== scrollToBottom) {
            scrollToBottom = currentIsAtBottom
            targetElement = null
          }
        }}
      >
        {#snippet children(msg, i)}
          <ChatMessage
            message={msg}
            videoStartTime={selectedPotplayerInfo?.startTime}
            videoEndTime={selectedPotplayerInfo?.endTime}
            elapsedTime={selectedPotplayerInfo?.startTime
              ? Math.floor(
                  msg.timestamp -
                    selectedPotplayerInfo?.startTime -
                    settings.chat.timestampOffset -
                    settings.chat._sessionTimestampOffset
                )
              : undefined}
            {urlTracker}
            usernameColorTimelineMap={chatService.usernameColorTimelineMap}
            onUsernameClick={handleUsernameClick}
            onEmoteLoad={({ hash }) => {
              if (loadedEmotes.has(hash)) return
              loadedEmotes.add(hash)
              scrollToTargetDebounced(scrollToBottom)
            }}
            onImageLoad={() => {
              scrollToTargetDebounced(scrollToBottom)
            }}
            bind:reloadServicesFunction={reloadServicesFunctionMap[i]}
          />
        {/snippet}
      </VList>
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
</div>

<style>
  .container {
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
  .recording-row {
    display: flex;
    gap: 10px;
    min-width: 0;
    width: 100%;
    color: var(--deck-muted);
    font-size: 11px;
    align-items: center;
  }
  .recording-row > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
    color: var(--deck-text);
  }
  .concealed {
    display: none;
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
  .offset-button,
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
