<script lang="ts">
  import { onMount } from 'svelte'
  import { originalLinkActions, type PreviewWindowContext } from '../core/preview-window'
  import { UrlTracker, type LinkPreview } from '../core/url-tracker'
  import { settingsReady } from '../state/settings.svelte'

  const { context }: { context: PreviewWindowContext } = $props()
  let preview = $state<LinkPreview | null>(null)
  let loading = $state(true)
  let imageFailed = $state(false)
  let notice = $state('')
  let attempt = $state(0)
  const emoteImage = $derived(
    context.kind === 'emote'
      ? Object.entries(context.segment.urls).sort(([a], [b]) => Number(b) - Number(a))[0]?.[1]
      : undefined
  )
  const imageUrl = $derived(context.kind === 'link' ? preview?.thumbnail : emoteImage)
  const actions = $derived(
    originalLinkActions(context.kind === 'link' ? context.url : (emoteImage ?? ''), imageUrl)
  )
  const description = $derived(
    preview?.tooltip ? UrlTracker.parseTooltipToText(preview.tooltip) : ''
  )

  async function load(refresh = false): Promise<void> {
    loading = true
    imageFailed = false
    notice = ''
    await settingsReady
    if (context.kind === 'link') preview = await context.tracker.getPreview(context.url, refresh)
    attempt += 1
    loading = false
  }
  async function open(url: string): Promise<void> {
    try {
      await window.api.openUrl(url)
      if (context.kind === 'link' && url === context.url) await context.tracker.markVisitedUrl(url)
    } catch {
      notice = 'Unable to open this link. Try again.'
    }
  }
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(actions.copy)
      notice = 'Link copied.'
    } catch {
      notice = 'Unable to copy the link. Select the URL to copy it manually.'
    }
  }
  onMount(() => {
    void load()
  })
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') window.close()
  }}
/>
<section
  class="preview-window"
  aria-label={context.kind === 'link' ? 'Link preview' : 'Emote preview'}
>
  <header>
    <strong>{context.kind === 'link' ? 'Link preview' : context.segment.name}</strong><span
      >{context.kind === 'link' ? 'Image & details' : 'Emote preview'}</span
    >
  </header>
  <div class="preview-body" aria-busy={loading}>
    <div class="media">
      {#if loading}
        <p role="status">Loading preview…</p>
      {:else if imageUrl && !imageFailed}
        {#key attempt}
          <img
            src={imageUrl}
            alt={context.kind === 'emote' ? context.segment.name : 'Link preview image'}
            onerror={() => {
              imageFailed = true
            }}
          />
        {/key}
      {:else}
        <p>
          {imageFailed
            ? 'Image failed to load'
            : context.kind === 'link' && (!preview || preview.status < 200 || preview.status >= 300)
              ? 'Preview unavailable'
              : 'No preview image'}
        </p>
      {/if}
    </div>
    {#if description}<p class="description">{description}</p>{/if}
    {#if context.kind === 'emote' && 'source' in context.segment}<p class="muted">
        Source: {context.segment.source}
      </p>{/if}
    {#if context.kind === 'emote' && 'ownerName' in context.segment.emote && context.segment.emote.ownerName}<p
        class="muted"
      >
        Author: {context.segment.emote.ownerName}
      </p>{/if}
    <p class="original-url">{actions.copy}</p>
    <div class="preview-actions">
      <button type="button" disabled={!actions.open} onclick={() => open(actions.open)}
        >{context.kind === 'link' ? 'Open link' : 'Open emote'}</button
      >
      {#if context.kind === 'link'}
        <button type="button" onclick={copy}>Copy link</button>
        <button
          type="button"
          disabled={!actions.sauceNAO}
          title={actions.sauceNAO
            ? 'Search this image on SauceNAO'
            : 'No usable image URL available'}
          onclick={() => actions.sauceNAO && open(actions.sauceNAO)}>SauceNAO</button
        >
      {/if}
    </div>
    {#if !loading && (!imageUrl || imageFailed || (context.kind === 'link' && (!preview || preview.status < 200 || preview.status >= 300)))}
      <div class="recovery">
        <button type="button" onclick={() => load(true)}>Retry preview</button><span
          >Reload this preview.</span
        >
      </div>
    {/if}
    <p class="notice" role="status">{notice}</p>
  </div>
</section>

<style>
  .preview-window {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--deck-bg);
    color: var(--deck-text);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid var(--deck-line);
  }
  header strong {
    overflow-wrap: anywhere;
  }
  header span,
  .muted,
  .recovery span {
    color: var(--deck-muted);
    font-size: 12px;
  }
  .preview-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--deck-spacing, 12px);
  }
  .media {
    min-height: 180px;
    display: grid;
    place-items: center;
    background: var(--deck-surface);
    border: 1px solid var(--deck-line);
    border-radius: 5px;
    padding: 12px;
  }
  .media img {
    max-width: 100%;
    max-height: 340px;
    object-fit: contain;
  }
  .media p {
    color: var(--deck-muted);
  }
  .description {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--deck-message-size);
    line-height: var(--deck-message-line-height);
    margin: 12px 0;
  }
  .original-url {
    user-select: text;
    overflow-wrap: anywhere;
    color: var(--deck-muted);
    font-size: 12px;
    margin: 12px 0;
  }
  .preview-actions {
    display: flex;
    gap: 6px;
  }
  button {
    border: 1px solid var(--deck-line);
    background: var(--deck-surface);
    color: var(--deck-text);
    padding: 6px 10px;
    min-height: var(--deck-control-height, 30px);
    border-radius: 4px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--deck-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--deck-accent);
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .recovery {
    display: flex;
    gap: 8px;
    align-items: center;
    border-top: 1px solid var(--deck-line);
    margin-top: 16px;
    padding-top: 12px;
  }
  .notice {
    font-size: 12px;
    min-height: 1.5em;
    margin-top: 12px;
  }
</style>
