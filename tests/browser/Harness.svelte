<script lang="ts">
  import { onMount, tick } from 'svelte'
  import VirtualTranscript from '@/renderer/src/components/VirtualTranscript.svelte'
  import type { TranscriptHandle } from '@/renderer/src/core/transcript-handle'
  import type { FixtureRow } from './fixture'

  let list: TranscriptHandle
  let rows: FixtureRow[] = $state(
    Array.from({ length: 1000 }, (_, i) => ({
      id: `row-${i}`,
      height: 80,
      text: `Message ${i}: selectable text with repeated  spaces and Unicode 日本語 😀`
    }))
  )
  let following = $state(false)
  let interactions = 0
  let width = $state(600)

  onMount(() => {
    window.transcriptTest = {
      list: () => list,
      rows: () => rows,
      replace: (value) => {
        rows = value
      },
      settleUpdates: tick,
      resize: (id, height) => {
        const row = rows.find((row) => row.id === id)
        if (row) row.height = height
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
    void tick().then(() => {
      window.fixtureReady = true
    })
  })
</script>

<div id="fixture" style:width={`${width}px`} style="height:600px;margin:40px auto">
  <VirtualTranscript
    bind:this={list}
    data={rows}
    getKey={(row) => row.id}
    estimateHeight={() => 80}
    follow={following}
    onfollowchange={(value) => {
      following = value
    }}
    onuserinteraction={() => {
      interactions++
    }}
  >
    {#snippet children(row)}
      <div data-message-id={row.id} style:height={`${row.height}px`}>
        <span data-message-part="text" style="white-space:pre-wrap;user-select:text"
          >{row.text}</span
        >
      </div>
    {/snippet}
  </VirtualTranscript>
</div>
