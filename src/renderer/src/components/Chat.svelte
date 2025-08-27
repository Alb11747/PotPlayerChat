<script lang="ts">
  import {
    convertRawIrcMessageToTwitchMessage,
    convertTwitchMessagesToRawIrcMessages,
    type TwitchMessage
  } from '@core/chat/twitch-msg'
  import { VList } from 'virtua/svelte'

  import { onMount, untrack } from 'svelte'

  import { clearAll, TwitchUserService } from '@/core/chat/twitch-api'
  import { ChatService, type LoadingState, type PotPlayerInfo } from '@/core/chat/twitch-chat'
  import {
    calculateTargetElement,
    scrollToTarget as scrollToTargetBase
  } from '@/renderer/src/utils/vlist'
  import type { PotPlayerInstance } from '@/types/potplayer'
  import type { SearchInfo } from '@/types/preload'
  import { deleteNullishKeysInPlace, isEqual, NumberObject } from '@/utils/objects'
  import { CurrentVideoTimeHistory } from '@/utils/time'

  import type { HWND } from '@/types/globals'
  import { BoundedSet } from '@/utils/datastructs'
  import { debounce } from '@/utils/functions'
  import LinkPreview from '../components/LinkPreview.svelte'
  import Settings from '../components/Settings.svelte'
  import { UrlTracker } from '../core/url-tracker'
  import { settings } from '../state/settings.svelte'
  import ChatMessage from './ChatMessage.svelte'

  const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })
  const chatService = new ChatService(window.api, loadingState, settings)
  const videoTimeHistory = new CurrentVideoTimeHistory()
  const urlTracker = new UrlTracker(settings.chat)
  const loadedEmotes = new BoundedSet<string>(200)

  type SelectedPotplayerInfo = PotPlayerInfo | (PotPlayerInstance & Partial<PotPlayerInfo>)
  let selectedPotplayerInfo: SelectedPotplayerInfo | null = $state(null)

  let potplayerInstances: PotPlayerInstance[] = $state([])
  let showSettings = $state(false)
  let changingPotPlayerPromise: Promise<SelectedPotplayerInfo | null> | null = $state(null)
  let lastPotplayerChangeTime: number = performance.now()

  let messages: TwitchMessage[] = $state.raw([])
  let autoSelectPotPlayer = $state(true)

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

  const scrollToTargetDebounced = debounce(() => scrollToTarget(), 35)

  function scrollToTarget(_scrollToBottom?: boolean): void {
    const _vlistRef = untrack(() => vlistRef)
    const _messages = untrack(() => messages)
    const _targetElement = untrack(() => targetElement)
    _scrollToBottom = _scrollToBottom ?? untrack(() => scrollToBottom)

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

  async function resetVideoTimeHistory(hwnd: HWND | null): Promise<void> {
    videoTimeHistory.clear()
    if (hwnd) videoTimeHistory.addSample(await window.api.getCurrentVideoTime(hwnd))
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

    await resetVideoTimeHistory(selectedPotplayerInfo?.hwnd ?? null)
    lastPotplayerChangeTime = performance.now()
    await updateChatMessages()
  }

  async function onSetOffset({ targetTimestamp }: { targetTimestamp: number }): Promise<void> {
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
  }

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
    if (!newMessages || newMessages.length === 0) {
      messages = []
      return
    }

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
    videoTimeHistory.addSample(time)
    updateChatMessages()
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

  function onFocusMessage(messageRaw: string): void {
    if (!vlistRef) return
    const message = convertRawIrcMessageToTwitchMessage(messageRaw)
    const messageId = message.getId()
    const messageIndex = messages.findIndex((m) => m.getId() === messageId)
    if (messageIndex === -1) return
    targetElement = message
    targetViewportOffset = (vlistRef.getItemSize(messageIndex) - vlistRef.getViewportSize()) / 2
    scrollToBottom = false
    scrollToTarget()
  }

  onMount(() => {
    const onFocusMessageEvent: Parameters<typeof window.api.onFocusMessage>[0] = (_, ...args) =>
      onFocusMessage(...args)
    window.api.onFocusMessage(onFocusMessageEvent)
    return () => window.api.offFocusMessage(onFocusMessageEvent)
  })

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

  function openSearchWindow(
    info?: Partial<SearchInfo>,
    extraData?: { message?: TwitchMessage }
  ): void {
    const searchRangeBuffer = 60 * 60 * 1000
    if (!selectedPotplayerInfo) throw new Error('No selected PotPlayer info')
    if (!selectedPotplayerInfo.startTime || !selectedPotplayerInfo.endTime)
      throw new Error('No start or end time set for the selected PotPlayer instance')

    const enc = new TextEncoder()
    const msgToData: (msg: TwitchMessage[]) => ArrayBufferLike = (msg) =>
      enc.encode(convertTwitchMessagesToRawIrcMessages(msg)).buffer

    window.api.openSearchWindow({
      potplayerInfo: $state.snapshot(selectedPotplayerInfo) as PotPlayerInfo,
      focusedMessageRaw: extraData?.message?.raw,
      initialMessagesRaw: msgToData(messages),
      searchRange: settings.search.showAllMessages
        ? {
            startTime: selectedPotplayerInfo.startTime - searchRangeBuffer,
            endTime: selectedPotplayerInfo.endTime + searchRangeBuffer
          }
        : undefined,
      ...(info ?? {})
    })
    window.api.setMessagesRaw(msgToData(chatService.currentChatData))
  }

  function handleUsernameClick(info: { username: string; message: TwitchMessage }): void {
    if (
      !selectedPotplayerInfo ||
      !selectedPotplayerInfo.startTime ||
      !selectedPotplayerInfo.endTime
    )
      return
    openSearchWindow(
      {
        initialSearch: `${info.username}: `
      },
      { message: info.message }
    )
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent): void {
    if (!selectedPotplayerInfo) return
    if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault()
      openSearchWindow()
    } else if ((event.ctrlKey && event.key === 'r') || (event.altKey && event.key === 'r')) {
      event.preventDefault()
      chatService.clearInvalidCache()
      window.api.clearLinkPreviewCache()
      urlTracker.clearCache()
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

<div class="container" role="region" aria-label="Chat">
  <div class="header" role="presentation" onkeydown={handleKeydown}>
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
      class="settings"
      class:selected={showSettings}
      aria-pressed={showSettings}
      aria-label="Settings"
      title="Settings"
      onclick={() => {
        showSettings = !showSettings

        const currentScrollToBottom = scrollToBottom
        scrollToTarget()
        requestAnimationFrame(() => {
          scrollToBottom = currentScrollToBottom
          scrollToTarget()
        })
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="50%"
        height="50%"
        viewBox="0 0 1024 1024"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M600.704 64a32 32 0 0 1 30.464 22.208l35.2 109.376c14.784 7.232 28.928 15.36 42.432 24.512l112.384-24.192a32 32 0 0 1 34.432 15.36L944.32 364.8a32 32 0 0 1-4.032 37.504l-77.12 85.12a357.12 357.12 0 0 1 0 49.024l77.12 85.248a32 32 0 0 1 4.032 37.504l-88.704 153.6a32 32 0 0 1-34.432 15.296L708.8 803.904c-13.44 9.088-27.648 17.28-42.368 24.512l-35.264 109.376A32 32 0 0 1 600.704 960H423.296a32 32 0 0 1-30.464-22.208L357.696 828.48a351.616 351.616 0 0 1-42.56-24.64l-112.32 24.256a32 32 0 0 1-34.432-15.36L79.68 659.2a32 32 0 0 1 4.032-37.504l77.12-85.248a357.12 357.12 0 0 1 0-48.896l-77.12-85.248A32 32 0 0 1 79.68 364.8l88.704-153.6a32 32 0 0 1 34.432-15.296l112.32 24.256c13.568-9.152 27.776-17.408 42.56-24.64l35.2-109.312A32 32 0 0 1 423.232 64H600.64zm-23.424 64H446.72l-36.352 113.088-24.512 11.968a294.113 294.113 0 0 0-34.816 20.096l-22.656 15.36-116.224-25.088-65.28 113.152 79.68 88.192-1.92 27.136a293.12 293.12 0 0 0 0 40.192l1.92 27.136-79.808 88.192 65.344 113.152 116.224-25.024 22.656 15.296a294.113 294.113 0 0 0 34.816 20.096l24.512 11.968L446.72 896h130.688l36.48-113.152 24.448-11.904a288.282 288.282 0 0 0 34.752-20.096l22.592-15.296 116.288 25.024 65.28-113.152-79.744-88.192 1.92-27.136a293.12 293.12 0 0 0 0-40.256l-1.92-27.136 79.808-88.128-65.344-113.152-116.288 24.96-22.592-15.232a287.616 287.616 0 0 0-34.752-20.096l-24.448-11.904L577.344 128zM512 320a192 192 0 1 1 0 384 192 192 0 0 1 0-384zm0 64a128 128 0 1 0 0 256 128 128 0 0 0 0-256z"
        />
      </svg></button
    >
  </div>

  {#if showSettings}
    <Settings {urlTracker} />
  {:else}
    <div class="chat-container" bind:this={chatContainerRef}>
      {#if messages && messages.length > 0}
        <VList
          bind:this={vlistRef}
          data={messages}
          getKey={(_, i) => messages[i]?.getId() ?? i}
          onscroll={() => {
            if (!nextScrollKeepTarget) {
              targetElement = null
              vlistRef?.scrollBy(0) // Cancel any pending scroll
            } else {
              setNextScrollKeepTargetDebounced(false)
            }

            if (performance.now() - lastPotplayerChangeTime < 3000) return
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
                if (scrollToBottom) scrollToTargetDebounced()
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
          scrollToTarget(true)
        }}
      >
        Scroll to bottom
      </button>
    {/if}
  {/if}
</div>

<style>
  .container {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 100%;
    min-height: 100%;
  }

  .header {
    max-width: 100%;
    display: flex;
    gap: 1rem;
    contain: content;
    align-items: center;
    background: var(--color-black-soft);
    color: var(--color-white);
    padding: 0.5rem;
    border-bottom: 1px solid var(--color-gray-4);
    font-size: 1rem;
    overflow: auto;
    scrollbar-color: var(--color-gray-4) var(--color-black-soft);
    scrollbar-width: thin;
    user-select: text;
    cursor: default;
  }
  .header button {
    height: 100%;
    min-width: 4.5rem;
    max-height: 4rem;
    padding: 0.5rem;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    text-align: center;
    border: 1px solid var(--color-gray-5);
    border-radius: 4px;
    overflow: auto;
    scrollbar-width: inherit;
    cursor: pointer;
  }
  .header button.settings {
    width: 3.7rem;
    height: 3.7rem;
    min-width: 4rem;
    display: flex;
  }
  .header button:hover {
    background: none;
    border-color: var(--color-accent-hover);
  }
  .header button.selected {
    color: var(--color-accent);
    font-weight: bold;
    background: none;
    border-color: var(--color-accent);
  }

  .chat-container {
    flex: 1 1 auto;
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
