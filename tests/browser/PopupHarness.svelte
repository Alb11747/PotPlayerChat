<script lang="ts">
  import Search from '@/renderer/src/components/Search.svelte'
  import UserWindow from '@/renderer/src/components/UserWindow.svelte'
  import { ChatService } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import type { SearchContext } from '@/renderer/src/core/search-window'
  import type { UserWindowContext } from '@/renderer/src/core/user-window'
  import type { HWND } from '@/types/globals'
  import { onMount } from 'svelte'

  const start = 1700000000000
  const messages = Array.from(
    { length: 1000 },
    (_, i) =>
      new TwitchChatMessage(
        '',
        {},
        `popup-${i}`,
        start + i * 1000,
        'fixture',
        'viewer',
        `Message ${i} ${i % 2 ? 'odd' : 'even'} ${'ordinary text '.repeat(i % 5)}`
      )
  )
  const history = new Promise<void>((resolve) => {
    window.resolveFixtureHistory = resolve
  })
  ChatService.prototype.updateVideoInfo = async () => true
  ChatService.prototype.getMessagesBetweenTimes = async () => {
    await history
    return messages
  }
  const context: SearchContext & UserWindowContext = {
    username: 'viewer',
    clickedMessage: messages[600]!,
    focusedMessage: messages[600]!,
    potplayerInfo: {
      hwnd: {} as HWND,
      pid: 1,
      title: 'Fixture recording',
      channel: 'fixture',
      startTime: start
    },
    initialMessages: messages.slice(500, 700),
    loadedMessages: [],
    searchRange: { startTime: start, endTime: start + 999000 },
    focusMessage: (message) => {
      window.fixtureUrl = message.getId()
    },
    onUsernameClick: (info) => {
      window.fixtureUsername = info.username
    },
    searchUsername: (username) => {
      window.fixtureUsername = username
    }
  }
  onMount(() => {
    window.fixtureReady = true
  })
</script>

<div style="height:800px;width:600px;margin:auto">
  {#if new URLSearchParams(location.search).get('popup') === 'search'}
    <Search {context} />
  {:else}
    <UserWindow {context} />
  {/if}
</div>
