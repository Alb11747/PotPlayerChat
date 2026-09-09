<script lang="ts">
  import Chat from '@/renderer/src/components/Chat.svelte'
  import { ChatService } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { settings, settingsReady } from '@/renderer/src/state/settings.svelte'
  import { onMount } from 'svelte'

  const messages = Array.from(
    { length: 200 },
    (_, i) =>
      new TwitchChatMessage(
        '',
        {},
        `main-${i}`,
        1700000000000 + i * 1000,
        'fixture',
        'viewer',
        `Message ${i} ${i % 7 === 0 ? `https://fixture.test/${i}` : 'ordinary text '.repeat(i % 5)}`
      )
  )
  ChatService.prototype.updateVideoInfo = async () => true
  ChatService.prototype.getMessagesForTime = async () => [...messages]
  onMount(() => {
    void settingsReady.then(() => {
      settings.interface.enableInlineImagePreviews = true
      window.fixtureReady = true
    })
  })
</script>

<div style="height:800px;width:600px;margin:auto"><Chat /></div>
