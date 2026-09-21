<script lang="ts">
  import { onMount, tick } from 'svelte'
  import MessageTranscript from '@/renderer/src/components/MessageTranscript.svelte'
  import ChatMessage from '@/renderer/src/components/ChatMessage.svelte'
  import LinkPreview from '@/renderer/src/components/LinkPreview.svelte'
  import PreviewWindow from '@/renderer/src/components/PreviewWindow.svelte'
  import type { PreviewWindowContext } from '@/renderer/src/core/preview-window'
  import { TwitchChatMessage } from '@/core/chat/twitch-msg'
  import { UrlTracker } from '@/renderer/src/core/url-tracker'
  import type { TranscriptHandle } from '@/renderer/src/core/transcript-handle'
  import { settings, settingsReady, applyAppearance } from '@/renderer/src/state/settings.svelte'
  import { TimelineMap } from '@/utils/datastructs'

  let list: TranscriptHandle
  let messages: TwitchChatMessage[] = $state.raw([])
  let following = $state(false)
  let width = $state(600)
  let interactions = 0
  const reloadServices: Record<number, (() => void) | undefined> = $state({})
  const tracker = new UrlTracker(settings.chat)
  const start = 1700000000000
  const params = new URLSearchParams(location.search)
  const linkStates = params.has('linkStates')
  const contrast = params.has('contrast')
  const mentionColors = new TimelineMap<string, string>()
  mentionColors.set('viewer', '#800000', start)
  mentionColors.set('viewer', '#000080', start + 1000)
  let previewContext = $state.raw<PreviewWindowContext | null>(null)
  const variants = [
    'Hello  world! Repeated spaces  and Unicode 日本語 😀 @viewer',
    'Long line '.repeat(25),
    'Multiple\nlines\nwith  whitespace',
    'Visit https://fixture.test/INDEX and https://fixture.test/100INDEX',
    'Kappa FixtureBase FixtureOverlay Cheer100 a short emote message',
    'Failed https://fixture.test/failed-INDEX and empty https://fixture.test/empty-INDEX'
  ]
  onMount(() => {
    void settingsReady.then(async () => {
      settings.interface.enableInlineImagePreviews = true
      if (contrast) settings.interface.enableInlineImagePreviews = false
      if (linkStates) {
        settings.interface.enableInlineImagePreviews = false
        settings.interface.enableLinkPreviews = true
        settings.interface.previewMode = params.has('expanded') ? 'expanded' : 'hover'
        const palette = params.get('palette')
        if (palette === 'blue' || palette === 'graphite' || palette === 'lavender')
          settings.interface.palette = palette
        // Exercise the real preview action and shared tracker in the fixture document.
        window.open = (url) => {
          window.fixturePopup = String(url)
          const token = new URL(String(url)).hash.slice(1)
          previewContext = window.potPlayerChatPopup?.takeContext(token) as PreviewWindowContext
          return window
        }
      }
      applyAppearance()
      const count = Number(new URLSearchParams(location.search).get('count') ?? 1000)
      messages = Array.from(
        { length: count },
        (_, i) =>
          new TwitchChatMessage(
            '',
            {
              'display-name': `Viewer${i}`,
              color: contrast ? (i === 2 ? '#ffffff' : '#000080') : '#7fdcb8',
              ...(contrast && i === 1 ? { 'first-msg': '1' } : {}),
              ...(i % 6 === 4 ? { emotes: '25:0-4', bits: '100' } : {}),
              ...(i % 9 === 0 ? { badges: 'moderator/1,subscriber/12' } : {})
            },
            `message-${i}`,
            start + i * 1000,
            'fixture',
            `viewer${i}`,
            contrast
              ? `\u0001ACTION waves @viewer https://fixture.test/${i}\u0001`
              : variants[i % variants.length]!.replaceAll('INDEX', String(i))
          )
      )
      await tick()
      window.transcriptTest = {
        list: () => list,
        rows: () => [],
        replace() {
          throw new Error('Use the geometry fixture to replace synthetic rows')
        },
        settleUpdates: tick,
        resize() {
          throw new Error('Use the geometry fixture to resize synthetic rows')
        },
        follow: (value) => {
          following = value
        },
        state: () => ({ following, interactions }),
        width: (value) => {
          width = value
        },
        ready: true
      }
      window.fixtureDisplay = (layout, timestamps) => {
        settings.interface.layout = layout
        settings.interface.showTimestamps = timestamps
        applyAppearance()
      }
      window.fixtureClearCache = () => {
        tracker.clearCache()
        list.clearCache?.()
        for (const reload of Object.values(reloadServices)) reload?.()
      }
      window.fixtureReady = true
      window.fixtureAppendMessages = (count) => {
        messages = Array.from(
          { length: count },
          (_, i) =>
            messages[i] ??
            new TwitchChatMessage(
              '',
              {},
              `message-${i}`,
              start + i * 1000,
              'fixture',
              'viewer',
              `Message ${i}`
            )
        )
      }
    })
  })
</script>

<div id="fixture" style:width={`${width}px`} style="height:600px;margin:40px auto">
  <MessageTranscript
    bind:this={list}
    data={messages}
    urlTracker={tracker}
    videoStartTime={start}
    follow={following}
    getElapsedTime={(message) => message.timestamp - start}
    onfollowchange={(value) => {
      following = value
    }}
    onuserinteraction={() => {
      interactions++
    }}
  >
    {#snippet children(message, index, store)}
      <div data-message-id={message.getId()} data-message-index={index}>
        <ChatMessage
          {message}
          urlTracker={tracker}
          videoStartTime={start}
          elapsedTime={message.timestamp - start}
          presentationStore={store}
          usernameColorTimelineMap={contrast ? mentionColors : undefined}
          bind:reloadServicesFunction={reloadServices[index]}
          onUsernameClick={(info) => {
            window.fixtureUsername = info.username
            window.fixtureUsernameAlt = info.altKey
          }}
          onUrlClick={(url) => {
            window.fixtureUrl = url
          }}
        />
      </div>
    {/snippet}
  </MessageTranscript>
</div>

{#if linkStates}
  <LinkPreview />
  {#if previewContext}
    <PreviewWindow context={previewContext} />
  {/if}
{/if}
