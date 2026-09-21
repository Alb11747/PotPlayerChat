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
  const count = Number(new URLSearchParams(location.search).get('count') ?? 1000)
  const focusedIndex = Math.floor(count * 0.6)
  const idScenario = new URLSearchParams(location.search).get('userId')
  const contrast = new URLSearchParams(location.search).has('contrast')
  let showSearch = $state(count <= 1000)
  const messages = Array.from(
    { length: count },
    (_, i) =>
      new TwitchChatMessage(
        '',
        contrast ? { color: '#000080', ...(i === focusedIndex ? { 'first-msg': '1' } : {}) } : {},
        `popup-${i}`,
        start + i * 1000,
        'fixture',
        'viewer',
        contrast
          ? `\u0001ACTION Message ${i} waves @viewer\u0001`
          : `Message ${i} ${i % 2 ? 'odd' : 'even'} ${'ordinary text '.repeat(i % 5)} ${i % 7 === 0 ? 'FixtureBase' : ''}`
      )
  )
  if (idScenario && idScenario !== 'missing') {
    messages[idScenario === 'late' ? 0 : focusedIndex - 1]!.tags['user-id'] = '123456'
  }
  const history = new Promise<void>((resolve) => {
    window.resolveFixtureHistory = resolve
  })
  ChatService.prototype.updateVideoInfo = async function (info) {
    this.currentPotPlayerInfo = info
    return true
  }
  ChatService.prototype.getMessagesBetweenTimes = async () => {
    await history
    return messages
  }
  const context: SearchContext & UserWindowContext = {
    username: 'viewer',
    clickedMessage: idScenario
      ? new TwitchChatMessage(
          '',
          { 'user-id': '999999' },
          'mention',
          start,
          'fixture',
          'other',
          '@viewer'
        )
      : messages[focusedIndex]!,
    focusedMessage: messages[focusedIndex]!,
    potplayerInfo: {
      hwnd: {} as HWND,
      pid: 1,
      title: 'Fixture recording',
      channel: 'fixture',
      startTime: start
    },
    initialMessages: idScenario
      ? [messages[focusedIndex - 1]!]
      : messages.slice(focusedIndex - 100, focusedIndex + 100),
    loadedMessages: count > 1000 ? messages : [],
    searchRange: { startTime: start, endTime: start + (count - 1) * 1000 },
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
    window.fixtureShowSearch = () => {
      showSearch = true
    }
    window.fixtureReady = true
  })
</script>

<div style="height:800px;width:600px;margin:auto">
  {#if new URLSearchParams(location.search).get('popup') === 'search'}
    {#if showSearch}<Search {context} />{/if}
  {:else}
    <UserWindow {context} />
  {/if}
</div>
