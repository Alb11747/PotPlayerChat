<script lang="ts">
  const {
    name
  }: { name: 'search' | 'clock' | 'settings' | 'minus' | 'plus' | 'back' | 'copy' | 'check' } =
    $props()
</script>

<svg
  width="16"
  height="16"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'search'}
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if name === 'settings'}
    <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="var(--deck-surface)" /><circle
      cx="15"
      cy="17"
      r="2"
      fill="var(--deck-surface)"
    />
  {:else if name === 'copy'}
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  {:else if name === 'check'}
    <path d="m5 12 4 4L19 6" />
  {:else if name === 'back'}
    <path d="m10 5-7 7 7 7M3 12h18" />
  {:else}
    <path d="M5 12h14" />
    {#if name === 'plus'}<path d="M12 5v14" />{/if}
  {/if}
</svg>
