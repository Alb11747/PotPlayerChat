<script lang="ts">
  import { convertTwitchMessagesToRawIrcMessages, type TwitchMessage } from '@core/chat/twitch-msg'
  import { VList } from 'virtua/svelte'

  import { onMount, untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  import { TwitchUserService, clearAll } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import type { PotPlayerInstance } from '@/types/potplayer'
  import {
    calculateTargetElement,
    scrollToTarget as scrollToTargetBase
  } from '@/renderer/src/utils/vlist'
  import type { SearchInfo } from '@/types/preload'
  import { deleteNullishKeysInPlace, isEqual } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'

  import type { HWND } from '@/types/globals'
  import LinkPreview from '../components/LinkPreview.svelte'
  import Settings from '../components/Settings.svelte'
  import { settings } from '../state/settings.svelte'
  import { UrlTracker } from '../state/url-tracker'
  import ChatMessage from './ChatMessage.svelte'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker(settings.chat)

  type SelectedPotplayerInfo = PotPlayerInfo | (PotPlayerInstance & Partial<PotPlayerInfo>)
  let selectedPotplayerInfo: SelectedPotplayerInfo | null = $state(null)

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let showSettings = $state(false)
  let changingPotPlayerPromise: Promise<SelectedPotplayerInfo | null> | null = $state(null)

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)

  let vlistRef: VList<TwitchMessage> | null = $state(null)
  let targetElement: TwitchMessage | null = $state(null)
  let targetViewportOffset: number = $state(0)
  let scrollToBottom = $state(true)

  function clearTargetElement(): void {
    targetElement = null
    targetViewportOffset = 0
  }

  function scrollToTarget(): void {
    const _vlistRef = untrack(() => vlistRef)
    const _messages = untrack(() => messages)
    const _targetElement = untrack(() => targetElement)
    const _targetViewportOffset = untrack(() => targetViewportOffset)
    const _scrollToBottom = untrack(() => scrollToBottom)
    scrollToTargetBase(_vlistRef, _messages, {
      targetElement: _targetElement,
      targetViewportOffset: _targetViewportOffset,
      scrollToBottom: _scrollToBottom
    })
  }

  $effect(() => {
    if (!vlistRef) return
    document.addEventListener('scroll', clearTargetElement, { capture: true })
    return () => document.removeEventListener('scroll', clearTargetElement)
  })

  if (!chatService.usernameColorCache)
    chatService.usernameColorCache = new SvelteMap<string, { color: string; timestamp: number }>()

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

    selectedPotplayerInfo = newSelectedPotplayerInstanceInfo
    if (selectedPotplayerInfo && selectedPotplayerInfo.channel && selectedPotplayerInfo.startTime) {
      await chatService.updateVideoInfo({
        ...selectedPotplayerInfo,
        channel: selectedPotplayerInfo.channel,
        startTime: selectedPotplayerInfo.startTime
      })
    } else {
      await chatService.updateVideoInfo(null)
    }
  }

  window.api.onPotPlayerInstancesChanged(async (_: Event, instances) =>
    onPotPlayerInstancesChanged(instances)
  )

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

  window.api.onSetOffset(async (_, { targetTimestamp }: { targetTimestamp: number }) => {
    if (!selectedPotplayerInfo) return
    const { hwnd, startTime } = selectedPotplayerInfo
    if (!startTime) return

    const currentVideoTime = await window.api.getCurrentVideoTime(hwnd)
    const currentOffset = settings.chat.timestampOffset
    settings.chat._sessionTimestampOffset =
      targetTimestamp - (startTime + currentVideoTime) - currentOffset

    updateChatMessages()
    scrollToBottom = true
    scrollToTarget()
  })

  function isEqualSimple(a: TwitchMessage[], b: TwitchMessage[]): boolean {
    if (a.length !== b.length) return false
    // Assume the messages are consecutive in time
    if (a[0]?.getId() !== b[0]?.getId()) return false
    if (a[a.length - 1]?.getId() !== b[b.length - 1]?.getId()) return false
    return true
  }

  let chatIntervalId: ReturnType<typeof setTimeout> | null = null
  async function updateChatMessages(potplayerInfo?: SelectedPotplayerInfo | null): Promise<void> {
    if (chatIntervalId) clearTimeout(chatIntervalId)
    chatIntervalId = null

    if (!potplayerInfo && changingPotPlayerPromise) potplayerInfo = await changingPotPlayerPromise
    if (!potplayerInfo) potplayerInfo = selectedPotplayerInfo

    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const effectiveTime =
      predictedTime + settings.chat.timestampOffset + settings.chat._sessionTimestampOffset
    const newMessages = await chatService.getMessagesForTime(effectiveTime, true)
    if (!newMessages || newMessages.length === 0) return
    const lastMessage = messages[messages.length - 1] || null
    const nextMessage =
      lastMessage && lastMessage.timestamp > predictedTime ? newMessages.pop() : null

    if (!isEqual(selectedPotplayerInfo, potplayerInfo)) {
      selectedPotplayerInfo = potplayerInfo ?? null
      messages = newMessages
      scrollToBottom = true
      clearTargetElement()
      scrollToTarget()
    } else if (!isEqualSimple(messages, newMessages)) {
      if (!settings.interface.keepScrollPosition) clearTargetElement()
      else if (vlistRef) {
        ;({ targetElement, targetViewportOffset } = calculateTargetElement(vlistRef, messages))
      }
      messages = newMessages
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
    if (loadingState.state) updateChatMessages()
  })

  function onCurrentTime(_: Event, time: number): void {
    videoTimeHistory.addSample(time)
    updateChatMessages()
  }

  onMount(() => {
    updateChatMessages()
    window.api.onSetCurrentTime(onCurrentTime)

    return () => {
      if (chatIntervalId) clearTimeout(chatIntervalId)
      window.api.offSetCurrentTime(onCurrentTime)
    }
  })

  // Handle user scroll detection
  function handleScroll(currentScrollOffset: number): void {
    if (!vlistRef) return

    // Check if user is at the bottom
    const isAtBottom =
      currentScrollOffset + vlistRef.getViewportSize() >= vlistRef.getScrollSize() - 1

    if (isAtBottom) {
      if (!scrollToBottom) {
        // console.debug('User scrolled to bottom, enabling auto-scroll')
        scrollToBottom = true
      }
    } else {
      if (scrollToBottom) {
        // console.debug('User scrolled away from bottom, disabling auto-scroll')
        scrollToBottom = false
      }
    }
  }

  async function resetVideoTimeHistory(hwnd: HWND): Promise<void> {
    videoTimeHistory.clear()
    videoTimeHistory.addSample(await window.api.getCurrentVideoTime(hwnd))
  }

  function setPotPlayerInstance(instanceProxy: PotPlayerInstance | PotPlayerInfo | null): void {
    changingPotPlayerPromise = (async (): Promise<PotPlayerInfo | null> => {
      const instance = $state.snapshot(instanceProxy)
      const hwnd = instance?.hwnd

      showSettings = false
      scrollToBottom = true
      if (!hwnd) {
        autoSelectPotPlayer = true
        window.api.setSelectedPotPlayerHWND(null)
        return null
      }
      autoSelectPotPlayer = false
      if (!selectedPotplayerInfo) selectedPotplayerInfo = instanceProxy
      else selectedPotplayerInfo.hwnd = hwnd
      window.api.setSelectedPotPlayerHWND(hwnd).then(() => resetVideoTimeHistory(hwnd))

      let currentSelectedPotPlayerInfo: PotPlayerInfo | null = null

      if (!('channel' in instance) || !('startTime' in instance)) {
        currentSelectedPotPlayerInfo = await window.api.getPotplayerExtraInfo(instance)
        if (!currentSelectedPotPlayerInfo) return null
      } else {
        window.api.getPotplayerExtraInfo(instance).then((info) => {
          if (info) instanceProxy = info
        })
        currentSelectedPotPlayerInfo = instance
      }

      await resetVideoTimeHistory(hwnd)
      await chatService.updateVideoInfo(currentSelectedPotPlayerInfo)
      await updateChatMessages(currentSelectedPotPlayerInfo)

      await resetVideoTimeHistory(hwnd)
      return currentSelectedPotPlayerInfo
    })()

    changingPotPlayerPromise.then(async () => {
      changingPotPlayerPromise = null
      potplayerInstances = await window.api.getPotPlayers()
    })
  }

  // Handle URL click
  function handleUrlClick(url: string): void {
    urlTracker.markVisitedUrl(url)
    window.api.openUrl(url)
  }

  function getSearchInfo(): SearchInfo {
    const searchRangeBuffer = 60 * 60 * 1000
    if (!selectedPotplayerInfo) throw new Error('No selected PotPlayer info')
    if (!selectedPotplayerInfo.startTime || !selectedPotplayerInfo.endTime)
      throw new Error('No start or end time set for the selected PotPlayer instance')
    return {
      potplayerInfo: $state.snapshot(selectedPotplayerInfo) as PotPlayerInfo,
      messagesRaw: convertTwitchMessagesToRawIrcMessages(chatService.currentChatData),
      initialMessagesRaw: convertTwitchMessagesToRawIrcMessages(messages),
      searchRange: settings.search.showAllMessages
        ? {
            startTime: selectedPotplayerInfo.startTime - searchRangeBuffer,
            endTime: selectedPotplayerInfo.endTime + searchRangeBuffer
          }
        : undefined
    }
  }

  function handleUsernameClick(info: { username: string }): void {
    if (
      !selectedPotplayerInfo ||
      !selectedPotplayerInfo.startTime ||
      !selectedPotplayerInfo.endTime
    )
      return
    window.api.openSearchWindow({
      ...getSearchInfo(),
      initialSearch: `${info.username}: `
    })
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (!selectedPotplayerInfo) return
    if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      window.api.openSearchWindow(getSearchInfo())
    } else if ((event.ctrlKey && event.key === 'r') || (event.altKey && event.key === 'r')) {
      if (!selectedPotplayerInfo.channel) return
      TwitchUserService.getUserIdByName(selectedPotplayerInfo.channel).then((userId) => {
        clearAll(userId ?? undefined)
        reloadChatMessageServices()
      })
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
</script>

<LinkPreview />

<div class="header" role="presentation" onkeydown={handleKeydown}>
  <div class="header-button">
    <button
      class:selected={autoSelectPotPlayer}
      onclick={() => setPotPlayerInstance(null)}
      aria-pressed={autoSelectPotPlayer}
    >
      Main
    </button>

    {#each potplayerInstances as inst (inst.hwnd)}
      <button
        class:selected={inst.hwnd === selectedPotplayerInfo?.hwnd}
        onclick={() => setPotPlayerInstance(inst)}
        aria-pressed={inst.hwnd === selectedPotplayerInfo?.hwnd}
      >
        {inst.title}
      </button>
    {/each}
    <button
      class:selected={showSettings}
      aria-pressed={showSettings}
      onclick={() => {
        showSettings = !showSettings

        const currentScrollToBottom = scrollToBottom
        scrollToTarget()
        setTimeout(() => {
          scrollToBottom = currentScrollToBottom
          scrollToTarget()
        }, 0)
      }}>⚙️</button
    >
  </div>
</div>

{#if showSettings}
  <Settings />
{:else}
  <div class="chat-container">
    {#if messages && messages.length > 0}
      <VList
        bind:this={vlistRef}
        data={messages}
        getKey={(_, i) => messages[i]?.getId() ?? i}
        onscroll={handleScroll}
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
            usernameColorMap={chatService.usernameColorCache ?? undefined}
            onUrlClick={handleUrlClick}
            onUsernameClick={handleUsernameClick}
            onEmoteLoad={scrollToTarget}
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
        <span>Loading state: {JSON.stringify(loadingState)}</span><br />
        <span>Selected PotPlayer Info: {JSON.stringify(selectedPotplayerInfo)}</span>
      </div>
    {/if}
  </div>

  {#if !scrollToBottom}
    <button
      class="scroll-to-bottom"
      onclick={() => {
        scrollToBottom = true
        scrollToTarget()
      }}
    >
      Scroll to bottom
    </button>
  {/if}
{/if}

<style>
  .header {
    flex: 0 1 auto;
    width: 100%;
    contain: content;
    align-items: center;
    background: var(--color-black-soft);
    color: var(--color-white);
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--color-gray-4);
    font-size: 1rem;
  }

  .header-button {
    display: flex;
    gap: 1rem;
    max-height: 4.5rem;
    scrollbar-width: thin;
    user-select: text;
    cursor: default;
  }
  .header-button button {
    flex: 1 1 max-content;
    padding: 0 0.5rem;
    border: 1px solid var(--color-gray-5);
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: none;
    outline: none;
    min-width: 4.5rem;
    max-height: 4rem;
    overflow: auto;
    scrollbar-color: var(--color-gray-4) var(--color-black-soft);
    scrollbar-width: thin;
  }
  .header-button button:hover {
    background: none;
    border-color: var(--color-accent-hover);
  }
  .header-button button.selected {
    color: var(--color-accent);
    font-weight: bold;
    background: none;
    border-color: var(--color-accent);
  }

  .chat-container {
    flex: 1 1 auto;
    width: 100%;
    height: fit-content;
    background-color: var(--color-black-dark);
    color: var(--color-text-light);
    padding-bottom: 0.5rem;
    overflow: auto;
  }

  .system {
    color: var(--color-text-muted);
    font-style: italic;
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }

  .error {
    color: var(--color-error);
    font-weight: bold;
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }

  .center {
    display: flex;
    text-align: center;
    justify-content: center;
    align-items: center;
  }

  .scroll-to-bottom {
    position: fixed;
    width: calc(100% - 6px);
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-bg-main-alpha-97);
    border: 1px solid var(--color-accent-faded);
    border-radius: 4px;
    color: var(--color-accent);
    font: inherit;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .scroll-to-bottom:hover {
    background: var(--color-bg-main-alpha-90);
    border-color: var(--color-accent);
  }
</style>
