<script lang="ts">
  import Chat from '@/renderer/src/components/Chat.svelte'
  import { ChatService } from '@/core/chat/twitch-chat'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { settings, settingsReady, applyAppearance } from '@/renderer/src/state/settings.svelte'
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
  let holdNextRead = false
  window.fixtureHoldMessages = () => {
    holdNextRead = true
  }
  ChatService.prototype.getMessagesForTime = async () => {
    if (holdNextRead) {
      holdNextRead = false
      await new Promise<void>((resolve) => {
        window.fixtureReleaseMessages = resolve
      })
      // A source-invalidated service request returns no rows.
      return []
    }
    return [...messages]
  }
  onMount(() => {
    void settingsReady.then(() => {
      settings.interface.enableInlineImagePreviews = true
      window.fixtureDisplay = (layout, timestamps) => {
        settings.interface.layout = layout
        settings.interface.showTimestamps = timestamps
        applyAppearance()
      }
      window.fixtureReady = true
    })
  })
</script>

<Chat />
