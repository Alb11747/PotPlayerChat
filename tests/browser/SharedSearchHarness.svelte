<script lang="ts">
  import { onMount } from 'svelte'
  import Search from '@/renderer/src/components/Search.svelte'
  import { ChatService } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { openSearchPopup, takeSearchContext } from '@/renderer/src/core/search-window'
  import type { SearchContext } from '@/renderer/src/core/search-window'
  import type { HWND } from '@/types/globals'
  import { SharedSearchDataCache } from '@/renderer/src/core/search-data'
  import { selectSearchPreview } from '@/renderer/src/core/search-preview'
  import {
    MessagePresentationStore,
    presentationOptions
  } from '@/renderer/src/core/message-presentation'

  const isPopup = location.pathname.endsWith('/search.html')
  const count = Number(new URLSearchParams(location.search).get('count') ?? 10000)
  const start = 1700000000000
  const focusedIndex = Math.floor(count * 0.6)
  let showSearch = $state(false)
  const context: SearchContext | null = isPopup ? takeSearchContext() : null

  if (isPopup) {
    if (!context) throw new Error('The source renderer did not provide a Search context')
    window.fixtureSearchContext = context
    const history = new Promise<void>((resolve) => {
      window.resolveFixtureHistory = resolve
    })
    ChatService.prototype.updateVideoInfo = async function (info) {
      this.currentPotPlayerInfo = info
      return true
    }
    const options = (window.opener as Window).fixtureSharedOptions!
    window.fixtureRangeCalls = []
    window.fixtureFullHistoryCalls = 0
    const rangeReady = options.delayRange
      ? new Promise<void>((resolve) => {
          window.fixtureReleaseRange = resolve
        })
      : Promise.resolve()
    let rangeFailed = false
    ChatService.prototype.getMessagesInRange = async (start, end, signal) => {
      window.fixtureRangeCalls!.push({ start, end })
      await rangeReady
      signal?.throwIfAborted()
      if (options.failRange && !rangeFailed) {
        rangeFailed = true
        throw new Error('Fixture range request failed')
      }
      return (window.opener as Window).fixtureSharedMessages!.filter(
        (message) => message.timestamp >= start && message.timestamp <= end
      )
    }
    ChatService.prototype.getMessagesBetweenTimes = async () => {
      window.fixtureFullHistoryCalls!++
      await history
      return context!.loadedMessages
    }
  } else {
    // Source-owned class instances exercise the same-realm sharing contract.
    // Generating them here is deliberately outside the measured Search work.
    const messages = Array.from(
      { length: count },
      (_, i) =>
        new TwitchChatMessage(
          '',
          i === focusedIndex ? { color: '#7fdcb8', badges: 'moderator/1' } : {},
          `shared-${i}`,
          start + i * 1000,
          'fixture',
          'viewer',
          `Message ${i} ${i % 2 ? 'odd' : 'even'} ${'ordinary text '.repeat(i % 5)} ${i % 7 === 0 || i === focusedIndex ? 'FixtureBase' : ''}${i === focusedIndex ? ' @viewer' : ''}`
        )
    )
    const initialMessages = messages.slice(focusedIndex - 100, focusedIndex + 100)
    let recording = {
      hwnd: 1 as HWND,
      pid: 1,
      title: 'Source recording',
      channel: 'fixture',
      startTime: start
    }
    window.fixtureSharedMessages = messages
    window.fixtureSharedInitialMessages = initialMessages
    window.fixtureSharedSearchWindows = []
    const sharedData = new SharedSearchDataCache()
    const prepare = sharedData.prepare.bind(sharedData)
    sharedData.prepare = async (...args) => {
      window.fixturePreparationCalls!++
      return prepare(...args)
    }
    window.fixtureOpenSharedSearch = async (options = {}) => {
      window.fixtureSharedOptions = options
      const capturedRecording = recording
      const previewMessages = selectSearchPreview(initialMessages, messages, messages[focusedIndex])
      let preview: SearchContext['preview']
      if (options.warmAssets) {
        window.resolveFixtureMedia!()
        const store = new MessagePresentationStore()
        const presentation = presentationOptions()
        await Promise.all(previewMessages.map((message) => store.load(message, presentation)))
        for (const message of previewMessages) store.get(message, presentation)
        preview = {
          messages: previewMessages,
          presentation: store.capture(previewMessages, { get: () => '#7fdcb8' })
        }
        window.fixtureSharedPreview = preview
      }
      let release: (() => void) | undefined
      const gate = options.delayPreparation
        ? new Promise<void>((resolve) => {
            release = resolve
          })
        : Promise.resolve()
      window.fixtureReleasePreparation = () => release?.()
      let failed = false
      window.fixturePreparationCalls = 0
      window.fixtureSharedOpenedAt = performance.timeOrigin + performance.now()
      const popup = openSearchPopup({
        timestampOffset: 0,
        potplayerInfo: capturedRecording,
        focusedMessage: messages[focusedIndex],
        initialMessages,
        loadedMessages: options.previewOnly ? initialMessages : messages,
        initialSearch: options.initialSearch,
        preview,
        sharedData:
          options.delayPreparation || options.failPreparation
            ? {
                textCache: sharedData.textCache,
                prepare: async (initial, loaded, signal) => {
                  window.fixturePreparationCalls!++
                  await gate
                  signal?.throwIfAborted()
                  if (options.failPreparation && !failed) {
                    failed = true
                    throw new Error('Fixture preparation failed')
                  }
                  return prepare(initial, loaded, signal)
                }
              }
            : sharedData,
        searchRange: { startTime: start, endTime: start + (count - 1) * 1000 },
        focusMessage: (message) => {
          window.fixtureSharedCallback = {
            id: message.getId(),
            original: messages[Number(message.getId().slice('shared-'.length))] === message,
            recording: capturedRecording.title
          }
        },
        onUsernameClick: (info) => {
          window.fixtureUsername = info.username
        }
      })
      if (popup) window.fixtureSharedSearchWindows!.push(popup)
    }
    window.fixtureSwitchRecording = () => {
      recording = { ...recording, title: 'Replacement recording', channel: 'replacement' }
    }
  }

  onMount(() => {
    window.fixtureShowSearch = () => {
      if (showSearch) return
      const timing = {
        openedAt: (window.opener as Window).fixtureSharedOpenedAt!,
        mountedAt: performance.timeOrigin + performance.now(),
        firstChatAt: undefined as number | undefined
      }
      window.fixtureSearchTiming = timing
      showSearch = true
      const observeFirstChat = (): void => {
        const viewport = document.querySelector('.virtual-transcript')?.getBoundingClientRect()
        const visible =
          viewport &&
          [...document.querySelectorAll('.chat-text')].some((row) => {
            const bounds = row.getBoundingClientRect()
            return bounds.bottom > viewport.top && bounds.top < viewport.bottom
          })
        if (visible) timing.firstChatAt = performance.timeOrigin + performance.now()
        else requestAnimationFrame(observeFirstChat)
      }
      requestAnimationFrame(observeFirstChat)
    }
    window.fixtureReady = true
    if (isPopup && (window.opener as Window).fixtureSharedOptions?.autoMount)
      window.fixtureShowSearch()
  })
</script>

{#if isPopup && context}
  <div style="height:800px;width:600px;margin:auto">
    {#if showSearch}<Search {context} />{/if}
  </div>
{:else}
  <p>Source renderer owns {count} chat messages.</p>
{/if}
