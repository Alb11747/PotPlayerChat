<script lang="ts">
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import type { PotPlayerInstance } from '@/main/potplayer'
  import { isEqual } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'
  import type { TwitchMessage } from '@core/chat/twitch-msg'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { VList } from 'virtua/svelte'
  import LinkPreview from '../components/LinkPreview.svelte'
  import Settings from '../components/Settings.svelte'
  import { getPotplayerExtraInfo } from '../state/potplayer'
  import { settings } from '../state/settings.svelte'
  import { UrlTracker } from '../state/url-tracker'
  import ChatMessage from './ChatMessage.svelte'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings.chat)
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker()

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let selectedPotplayerInfo: PotPlayerInfo = $state({})

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)
  let scrollToBottom = $state(true)

  let showSettings = $state(false)

  let changingPotPlayerPromise: Promise<PotPlayerInfo | null> | null = $state(null)

  let vlistRef: VList<unknown> | null = $state(null)

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

  function scrollToBottomIfNeeded(): void {
    if (vlistRef && scrollToBottom)
      vlistRef.scrollToIndex(messages.length - 1, { smooth: false, align: 'end' })
  }

  let chatIntervalId: ReturnType<typeof setTimeout> | null = null
  async function updateChatMessages(potplayerInfo?: PotPlayerInfo): Promise<void> {
    if (chatIntervalId) clearTimeout(chatIntervalId)
    chatIntervalId = null

    if (!potplayerInfo && changingPotPlayerPromise) potplayerInfo = await changingPotPlayerPromise
    if (!potplayerInfo) potplayerInfo = selectedPotplayerInfo

    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const newMessages = await chatService.getMessagesForTime(predictedTime, true)
    if (!newMessages || newMessages.length === 0) return
    const lastMessage = messages[messages.length - 1] || null
    const nextMessage =
      lastMessage && lastMessage.timestamp > predictedTime ? newMessages.pop() : null

    if (!isEqual(messages, newMessages) || !isEqual(selectedPotplayerInfo, potplayerInfo)) {
      messages = newMessages
      selectedPotplayerInfo = potplayerInfo
      scrollToBottomIfNeeded()
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

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'f') {
      event.preventDefault()
      window.api.openSearchWindow({
        potplayerInfo: $state.snapshot(selectedPotplayerInfo),
        messages: messages.length > 0 ? messages : undefined
      })
    }
  }

  // Set up keyboard listener
  $effect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  })
</script>

<LinkPreview />

<div class="header" role="presentation" onkeydown={handleKeydown}>
  <div class="instances">
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
    <button class="settings-button" onclick={() => (showSettings = !showSettings)}>⚙️</button>
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
          {urlTracker}
          usernameColorMap={chatService.usernameColorCache}
          onUrlClick={handleUrlClick}
          onEmoteLoad={scrollToBottomIfNeeded}
          enableLinkPreviews={settings.interface.enableLinkPreviews}
          enableEmotePreviews={settings.interface.enableEmotePreviews}
          enableEmotes={settings.interface.enableEmotes}
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

<style>
  .header {
    flex: 0 1 auto;
    width: 100%;
    contain: content;
    align-items: center;
    background: #23232b;
    color: #fff;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid #333;
    font-size: 1rem;
  }

  .instances {
    display: flex;
    gap: 1rem;
    max-height: 4.5rem;
    scrollbar-width: thin;
    user-select: text;
    cursor: default;
  }
  .instances button {
    padding: 0 0.5rem;
    border: 1px solid #444;
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
    scrollbar-color: #333 #23232b;
    scrollbar-width: thin;
  }
  .instances button:hover {
    background: none;
    border-color: #2b4675;
  }
  .instances button.main {
    color: #4e8cff;
    font-weight: bold;
    background: none;
    border-color: #4e8cff;
  }

  .chat-container {
    flex: 1 1 auto;
    width: 100%;
    height: fit-content;
    background-color: #18181b;
    color: #efeff1;
    padding-bottom: 0.5rem;
    overflow: auto;
  }

  .system {
    color: #a9a9a9;
    font-style: italic;
    padding: 0.25rem 0.5rem;
    line-height: 1.7;
    font-size: 108%;
    box-sizing: border-box;
    user-select: text;
  }

  .error {
    color: #ff4d4d;
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
</style>
