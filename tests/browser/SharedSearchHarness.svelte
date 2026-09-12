<script lang="ts">
  import { onMount } from 'svelte'
  import Search from '@/renderer/src/components/Search.svelte'
  import { ChatService } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { openSearchPopup, takeSearchContext } from '@/renderer/src/core/search-window'
  import type { SearchContext } from '@/renderer/src/core/search-window'
  import type { HWND } from '@/types/globals'

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
    ChatService.prototype.getMessagesBetweenTimes = async () => {
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
          {},
          `shared-${i}`,
          start + i * 1000,
          'fixture',
          'viewer',
          `Message ${i} ${i % 2 ? 'odd' : 'even'} ${'ordinary text '.repeat(i % 5)} ${i % 7 === 0 ? 'FixtureBase' : ''}`
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
    window.fixtureOpenSharedSearch = () => {
      const capturedRecording = recording
      const popup = openSearchPopup({
        potplayerInfo: capturedRecording,
        focusedMessage: messages[focusedIndex],
        initialMessages,
        loadedMessages: messages,
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
      showSearch = true
    }
    window.fixtureReady = true
  })
</script>

{#if isPopup && context}
  <div style="height:800px;width:600px;margin:auto">
    {#if showSearch}<Search {context} />{/if}
  </div>
{:else}
  <p>Source renderer owns {count} chat messages.</p>
{/if}
