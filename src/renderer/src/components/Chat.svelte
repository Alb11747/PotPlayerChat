<script lang="ts">
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import type { PotPlayerInstance } from '@/core/os/potplayer'
  import type { SearchInfo } from '@/types/preload'
  import { isEqual } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import { onMount, untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { VList } from 'virtua/svelte'
  import LinkPreview from '../components/LinkPreview.svelte'
  import Settings from '../components/Settings.svelte'
  import { getPotplayerExtraInfo } from '../state/potplayer'
  import { settings } from '../state/settings.svelte'
  import { UrlTracker } from '../state/url-tracker'
  import ChatMessage from './ChatMessage.svelte'
  import {
    calculateTargetElement,
    scrollToTarget as scrollToTargetBase
  } from '@/renderer/src/utils/vlist'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker(settings.chat)

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let selectedPotplayerInfo: PotPlayerInfo = $state({})
  let showSettings = $state(false)
  let changingPotPlayerPromise: Promise<PotPlayerInfo | null> | null = $state(null)

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)

  let vlistRef: VList<TwitchMessage> | null = $state(null)
  let targetElement: TwitchMessage = $state(null)
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

  window.api.onPotPlayerInstancesChanged(async (_: Event, instances) => {
    let newSelectedPotplayerInstanceInfo: PotPlayerInfo | null = null
    if (changingPotPlayerPromise) newSelectedPotplayerInstanceInfo = await changingPotPlayerPromise
    potplayerInstances = instances

    if (!newSelectedPotplayerInstanceInfo) {
      const selectedPotplayerInstance = instances.find((i) => i.selected)
      if (!selectedPotplayerInstance?.hwnd) return
      newSelectedPotplayerInstanceInfo = await getPotplayerExtraInfo(selectedPotplayerInstance)
    }

    selectedPotplayerInfo = newSelectedPotplayerInstanceInfo || {}
    await chatService.updateVideoInfo(selectedPotplayerInfo)
  })

  window.api.onSetOffset(async (_, { targetTimestamp }: { targetTimestamp: number }) => {
    if (!selectedPotplayerInfo) return
    const startTime = selectedPotplayerInfo.startTime
    const currentVideoTime = await window.api.getCurrentVideoTime(selectedPotplayerInfo.hwnd)

    settings.chat._sessionTimestampOffset = targetTimestamp - (startTime + currentVideoTime)

    updateChatMessages()
    scrollToBottom = true
    scrollToTarget()
  })

  let chatIntervalId: ReturnType<typeof setTimeout> | null = null
  async function updateChatMessages(potplayerInfo?: PotPlayerInfo): Promise<void> {
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
      selectedPotplayerInfo = potplayerInfo
      messages = newMessages
      scrollToBottom = true
      clearTargetElement()
      scrollToTarget()
    } else if (!isEqual(messages, newMessages)) {
      if (!settings.interface.keepScrollPosition) clearTargetElement()
      else {
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

  function setPotPlayerInstance(instance: PotPlayerInstance | null): void {
    async function resetVideoTimeHistory(): Promise<void> {
      videoTimeHistory.clear()
      videoTimeHistory.addSample(await window.api.getCurrentVideoTime(instance.hwnd))
    }

    changingPotPlayerPromise = (async (): Promise<PotPlayerInfo | null> => {
      showSettings = false
      scrollToBottom = true
      if (!instance?.hwnd) {
        autoSelectPotPlayer = true
        window.api.setSelectedPotPlayerHWND(null)
        return null
      }
      autoSelectPotPlayer = false
      selectedPotplayerInfo.hwnd = instance.hwnd
      window.api.setSelectedPotPlayerHWND(instance.hwnd).then(resetVideoTimeHistory)

      const currentSelectedPotPlayerInfo = await getPotplayerExtraInfo(instance)

      await resetVideoTimeHistory()
      await chatService.updateVideoInfo(currentSelectedPotPlayerInfo)
      await updateChatMessages(currentSelectedPotPlayerInfo)

      await resetVideoTimeHistory()
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
    return {
      potplayerInfo: $state.snapshot(selectedPotplayerInfo),
      messages: messages.length > 0 ? messages.slice(0, 200) : undefined,
      searchRange: settings.search.showAllMessages
        ? {
            startTime: selectedPotplayerInfo.startTime - searchRangeBuffer,
            endTime: selectedPotplayerInfo.endTime + searchRangeBuffer
          }
        : undefined
    }
  }

  function handleUsernameClick(info: { username: string }): void {
    window.api.openSearchWindow({
      ...getSearchInfo(),
      initialSearch: `${info.username}: `
    })
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      window.api.openSearchWindow(getSearchInfo())
    }
  }

  // Set up keyboard listener
  $effect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  })
</script>

<LinkPreview />

<div class="header" role="presentation" onkeydown={handleKeydown}>
  <div class="header-button">
    <button
      class:main={autoSelectPotPlayer}
      onclick={() => setPotPlayerInstance(null)}
      aria-pressed={autoSelectPotPlayer}
    >
      Main
    </button>

    {#each potplayerInstances as inst (inst.hwnd)}
      <button
        class:main={inst.hwnd === selectedPotplayerInfo.hwnd}
        onclick={() => setPotPlayerInstance(inst)}
        aria-pressed={inst.hwnd === selectedPotplayerInfo.hwnd}
      >
        {inst.title}
      </button>
    {/each}
    <button
      class="settings-button"
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
{/if}

<div class="chat-container">
  {#if messages && messages.length > 0}
    <VList
      bind:this={vlistRef}
      data={messages}
      getKey={(_, i) => messages[i].getId()}
      initialTopMostItemIndex={messages.length - 1}
      onscroll={handleScroll}
      ssrCount={20}
    >
      {#snippet children(msg)}
        <ChatMessage
          message={msg}
          videoStartTime={selectedPotplayerInfo.startTime}
          videoEndTime={selectedPotplayerInfo.endTime}
          elapsedTime={selectedPotplayerInfo.startTime
            ? Math.floor(
                msg.timestamp -
                  selectedPotplayerInfo.startTime -
                  settings.chat.timestampOffset -
                  settings.chat._sessionTimestampOffset
              )
            : undefined}
          {urlTracker}
          usernameColorMap={chatService.usernameColorCache}
          onUrlClick={handleUrlClick}
          onUsernameClick={handleUsernameClick}
          onEmoteLoad={scrollToTarget}
        />
      {/snippet}
    </VList>
  {:else if loadingState?.state === 'loading'}
    <div class="chat-message system center">Loading chat...</div>
  {:else if loadingState?.state === 'error'}
    <div class="chat-message error center">{loadingState.errorMessage}</div>
  {:else if loadingState?.state === 'channel-not-found'}
    <div class="chat-message system center">Channel not found.</div>
  {:else if !selectedPotplayerInfo.hwnd}
    <div class="chat-message system center">No PotPlayer instance selected.</div>
  {:else if !selectedPotplayerInfo.startTime}
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
  .header-button button.main {
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
