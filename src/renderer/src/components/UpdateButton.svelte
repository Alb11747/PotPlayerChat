<script lang="ts">
  import { getUpdateButton } from '../core/update-display'
  import { runUpdateAction, updates, watchUpdates } from '../state/updates.svelte'

  watchUpdates()
  const button = $derived(getUpdateButton(updates.state))
  let pending = $state(false)

  async function activate(): Promise<void> {
    if (!button || button.action === 'none' || pending) return
    pending = true
    try {
      await runUpdateAction(button.action === 'download' ? 'downloadUpdate' : 'installUpdate')
    } finally {
      pending = false
    }
  }
</script>

{#if button}
  <button
    class="update-button"
    class:ready={button.action === 'install'}
    title={button.title}
    aria-label={button.title}
    disabled={button.action === 'none' || pending}
    style:--progress={updates.state?.status === 'downloading'
      ? `${updates.state.downloadPercent ?? 0}%`
      : undefined}
    onclick={activate}>{button.label}</button
  >
{/if}

<style>
  .update-button {
    flex: none;
    height: var(--deck-control-height, 30px);
    min-width: 30px;
    padding: 0 8px;
    border: 1px solid var(--deck-accent);
    border-radius: 4px;
    color: var(--deck-accent);
    background: var(--deck-surface);
    font: inherit;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }
  .update-button.ready {
    color: var(--deck-bg);
    background: var(--deck-accent);
  }
  .update-button:hover:not(:disabled) {
    color: var(--deck-text);
    background: var(--deck-hover);
  }
  .update-button:disabled {
    cursor: default;
    /* Download progress fills the control from the left. */
    background: linear-gradient(
      to right,
      var(--deck-selection) var(--progress, 0%),
      var(--deck-surface) var(--progress, 0%)
    );
  }
</style>
