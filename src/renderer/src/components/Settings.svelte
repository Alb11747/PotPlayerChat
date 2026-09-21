<script lang="ts">
  import conf from '../state/config'
  import {
    resetSettings,
    normalizeSettings,
    settingsStatus,
    applyAppearance,
    saveSettings,
    settings
  } from '../state/settings.svelte'

  let { onSessionOffsetChange }: { onSessionOffsetChange?: (offset: number) => void } = $props()

  let maintenanceStatus = $state<string | null>(null)
  let clearingCache = $state(false)
  let clearingSavedUrls = $state(false)
  const maintenanceBusy = $derived(clearingCache || clearingSavedUrls)

  const categories = [
    'Appearance',
    'Chat',
    'Previews',
    'Search',
    'Advanced',
    'Maintenance'
  ] as const
  let category = $state<(typeof categories)[number]>('Appearance')

  function changed(event?: Event): void {
    if (!settingsStatus.ready) return
    const target = event?.target
    const isIncompleteNumber =
      target instanceof HTMLInputElement &&
      target.type === 'number' &&
      !Number.isFinite(target.valueAsNumber)
    const commitsOnChange =
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && target.type === 'checkbox')
    // Select and checkbox bindings commit on change; input would save their previous value.
    // Numbers can stay temporarily empty while typing, then normalize on commit.
    if (event?.type === 'input' && (commitsOnChange || isIncompleteNumber)) return
    if (event?.type === 'change' && !commitsOnChange && !isIncompleteNumber) return
    if (target instanceof HTMLElement && target.dataset['setting'] === 'session-offset') {
      if (isIncompleteNumber) normalizeSettings()
      onSessionOffsetChange?.(settings.chat._sessionTimestampOffset)
    }
    applyAppearance()
    saveSettings()
    if (!event || (target instanceof HTMLElement && target.dataset['setting'] === 'interval'))
      void window.api
        .setPollingIntervals($state.snapshot(settings.intervals))
        .catch((error: unknown) => {
          settingsStatus.error = 'Could not apply polling intervals. Try changing the value again.'
          console.error('Failed to apply polling intervals:', error)
        })
    if (!event || (target instanceof HTMLElement && target.dataset['setting'] === 'prerelease'))
      void conf.set('prerelease', settings.general.prerelease).catch((error: unknown) => {
        settingsStatus.error = 'Could not save the update preference. Try changing it again.'
        console.error('Failed to save the update preference:', error)
      })
  }

  function resetAllSettings(): void {
    resetSettings()
    void window.api.setPollingIntervals($state.snapshot(settings.intervals))
    void conf.set('prerelease', settings.general.prerelease)
  }

  async function clearCache(): Promise<void> {
    maintenanceStatus = null
    clearingCache = true
    try {
      await window.api.clearAppCache()
      maintenanceStatus = 'Cache cleared.'
    } catch (error) {
      console.error('Failed to clear cache:', error)
      maintenanceStatus = 'Failed to clear cache. Check logs and try again.'
    } finally {
      clearingCache = false
    }
  }

  async function clearSavedUrls(): Promise<void> {
    maintenanceStatus = null
    clearingSavedUrls = true
    try {
      await window.api.clearSavedUrls()
      maintenanceStatus = 'Saved URLs cleared.'
    } catch (error) {
      console.error('Failed to clear saved URLs:', error)
      maintenanceStatus = 'Failed to clear saved URLs. Check logs and try again.'
    } finally {
      clearingSavedUrls = false
    }
  }
</script>

<div class="settings-panel">
  <div class="header-section">
    <h2 class="title">Settings</h2>
    <button class="reset-button" onclick={resetAllSettings} disabled={!settingsStatus.ready}>
      Reset all settings
    </button>
  </div>

  <nav class="category-nav" aria-label="Settings categories">
    {#each categories as item (item)}
      <button
        aria-current={category === item ? 'page' : undefined}
        onclick={() => (category = item)}>{item}</button
      >
    {/each}
  </nav>
  {#if settingsStatus.error}<p class="settings-error" role="alert">{settingsStatus.error}</p>{/if}
  <div class="settings-content" oninput={changed} onchange={changed}>
    <fieldset class="settings-fields" disabled={!settingsStatus.ready}>
      {#if category === 'Appearance'}
        <fieldset>
          <legend>Appearance</legend>
          <p class="section-note">
            Choose layout and color independently. Changes apply to all open windows.
          </p>
          <label
            ><span class="label-text">Layout</span>
            <select bind:value={settings.interface.layout}>
              <option value="streamlined">Streamlined</option><option value="comfort"
                >Comfort</option
              >
            </select>
          </label>
          <p class="section-note">
            Streamlined maximizes chat space. Comfort adds more spacing between messages.
          </p>
          <label
            ><span class="label-text">Color</span>
            <select bind:value={settings.interface.palette}>
              <option value="graphite">Graphite</option><option value="blue">Blue</option><option
                value="lavender">Lavender</option
              >
            </select>
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.improveUsernameContrast} />
            Improve username contrast
          </label>
          <p class="section-note">Adjust hard-to-read username colors, mentions, and /me text.</p>
          <div class="appearance-sample" aria-label="Message appearance preview">
            <span class="sample-name">Chat Deck</span> Messages use your selected color and spacing.
            <p>Longer messages wrap naturally, keeping the conversation easy to read.</p>
          </div>
        </fieldset>
      {/if}
      {#if category === 'Chat'}
        <fieldset>
          <legend>Chat Settings</legend>
          <label>
            <span class="label-text">Chat Message Limit:</span>
            <input type="number" bind:value={settings.chat.chatMessageLimit} min="1" />
          </label>
          <label>
            <span class="label-text">Timestamp offset (ms):</span>
            <input type="number" bind:value={settings.chat.timestampOffset} />
          </label>
          <label>
            <span class="label-text">Session offset (ms, saved per video):</span>
            <input
              type="number"
              data-setting="session-offset"
              bind:value={settings.chat._sessionTimestampOffset}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Interface Settings</legend>
          <label>
            <input type="checkbox" bind:checked={settings.interface.enableEmotes} />
            Enable Emotes
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.keepScrollPosition} />
            Keep Scroll Position
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.showTimestamps} />
            Show Timestamps
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.absoluteTimestamps} />
            Use Absolute Timestamps
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.enableBadges} />
            Show Badges
          </label>
          <label>
            <span class="label-text">Show Name:</span>
            <select bind:value={settings.interface.showName}>
              <option value="username">Username</option>
              <option value="displayName">Display Name</option>
              <option value="usernameFirst">Username (Display Name)</option>
              <option value="displayFirst">Display Name (Username)</option>
            </select>
          </label>
        </fieldset>
      {/if}
      {#if category === 'Previews'}
        <fieldset>
          <legend>Previews</legend>
          <label
            ><span class="label-text">Preview mode</span><select
              bind:value={settings.interface.previewMode}
              ><option value="hover">Original hover</option><option value="expanded"
                >Larger on click</option
              ></select
            ></label
          >
          <p class="section-note">Ctrl-click opens the larger preview in either mode.</p>
          <label>
            <input type="checkbox" bind:checked={settings.interface.enableLinkPreviews} />
            Enable Link Previews
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.enableInlineImagePreviews} />
            Show Inline Image Previews
          </label>
          <label>
            <input
              type="checkbox"
              bind:checked={settings.interface.openInlineImagePreviewsOnClick}
              disabled={!settings.interface.enableInlineImagePreviews}
            />
            Open Inline Image on Click
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.enableEmotePreviews} />
            Enable Emote Previews
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.stickyPreviews} />
            Sticky Previews
          </label>
          <label>
            <span class="label-text">Default Preview Position:</span>
            <select bind:value={settings.interface.defaultPreviewPosition}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          <label>
            <input type="checkbox" bind:checked={settings.interface.requireHttpInUrl} />
            Require HTTP in URL
          </label>
        </fieldset>
      {/if}
      {#if category === 'Search'}
        <fieldset>
          <legend>Search</legend>
          <label>
            <span class="label-text">Show All Messages:</span>
            <input type="checkbox" bind:checked={settings.search.showAllMessages} />
          </label>
        </fieldset>
      {/if}
      {#if category === 'Advanced'}
        <fieldset>
          <legend>Services</legend>
          <label>
            <span class="label-text">JustLog URL:</span>
            <input type="text" bind:value={settings.chat.justlogUrl} />
          </label>
          <label>
            <span class="label-text">Chatterino Base URL:</span>
            <input type="text" bind:value={settings.chat.chatterinoBaseUrl} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Polling intervals (milliseconds)</legend>
          <label>
            <span class="label-text">Video Time:</span>
            <input
              type="number"
              data-setting="interval"
              bind:value={settings.intervals.videoTime}
              min="500"
            />
          </label>
          <label>
            <span class="label-text">Active Window:</span>
            <input
              type="number"
              data-setting="interval"
              bind:value={settings.intervals.activeWindow}
              min="100"
            />
          </label>
          <label>
            <span class="label-text">PotPlayer Instances:</span>
            <input
              type="number"
              data-setting="interval"
              bind:value={settings.intervals.potplayerInstances}
              min="500"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Update Settings</legend>
          <label>
            <input
              type="checkbox"
              data-setting="prerelease"
              bind:checked={settings.general.prerelease}
            />
            Enable Prerelease Updates (Applies on next restart)
          </label>
        </fieldset>
      {/if}
      {#if category === 'Maintenance'}
        <fieldset>
          <legend>Maintenance</legend>
          <div class="maintenance-actions">
            <button class="reset-button" onclick={clearCache} disabled={maintenanceBusy}>
              {clearingCache ? 'Clearing Cache...' : 'Clear Cache'}
            </button>
            <button class="reset-button" onclick={clearSavedUrls} disabled={maintenanceBusy}>
              {clearingSavedUrls ? 'Clearing Saved URLs...' : 'Clear Saved URLs'}
            </button>
          </div>
          <p class="maintenance-note">Clears both seen and clicked URL history.</p>
          {#if maintenanceStatus}
            <p class="clear-status" role="status" aria-live="polite">{maintenanceStatus}</p>
          {/if}
        </fieldset>
      {/if}
    </fieldset>
  </div>
  <p class="save-note">
    {settingsStatus.ready ? 'Changes save automatically' : 'Loading settings�'}
  </p>
</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    color: var(--deck-text);
    background: var(--deck-bg);
    font-size: 12px;
    user-select: text;
    cursor: default;
  }
  .header-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px var(--deck-spacing);
    flex: none;
  }
  .title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }
  .category-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 var(--deck-spacing) 10px;
    border-bottom: 1px solid var(--deck-line);
    flex: none;
  }
  button,
  input,
  select {
    font: inherit;
    color: var(--deck-text);
    background: var(--deck-surface);
    border: 1px solid var(--deck-line);
    border-radius: 4px;
    min-height: 30px;
    padding: 5px 8px;
  }
  button {
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--deck-hover);
  }
  button:disabled {
    cursor: default;
    color: var(--deck-muted);
  }
  .category-nav button {
    border-color: transparent;
    background: none;
    padding: 5px 8px;
  }
  .category-nav button[aria-current='page'] {
    background: var(--deck-selection);
    color: var(--deck-accent);
  }
  .settings-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--deck-spacing);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 22px;
    min-width: 0;
  }
  fieldset.settings-fields {
    margin: 0;
  }
  legend {
    font-size: 14px;
    font-weight: 600;
    color: var(--deck-text);
    padding: 0 0 12px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 9px 0;
    border-bottom: 1px solid var(--deck-line);
  }
  label:has(input[type='text']) {
    flex-wrap: wrap;
  }
  .label-text {
    flex: 1;
    min-width: 0;
  }
  input[type='number'] {
    width: 96px;
    flex: none;
  }
  input[type='text'] {
    width: 100%;
    min-width: 0;
  }
  select {
    max-width: 60%;
    min-width: 0;
  }
  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    min-height: 16px;
    flex: none;
    margin: 0;
    accent-color: var(--deck-accent);
  }
  input:disabled,
  select:disabled {
    color: var(--deck-muted);
  }
  .section-note,
  .maintenance-note,
  .save-note {
    color: var(--deck-muted);
    font-size: 11px;
    line-height: 1.5;
  }
  .section-note {
    margin: 0 0 8px;
  }
  .appearance-sample {
    margin-top: 18px;
    padding: 12px;
    background: var(--deck-surface);
    border-radius: 4px;
    font-size: var(--deck-message-size);
    line-height: var(--deck-message-line-height);
  }
  .appearance-sample p {
    margin-top: var(--deck-message-gap);
  }
  .sample-name {
    color: var(--deck-accent);
    font-weight: 600;
  }
  .maintenance-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .clear-status {
    color: var(--deck-muted);
    margin-top: 12px;
  }
  .settings-error {
    color: var(--color-error);
    padding: 8px var(--deck-spacing);
  }
  .save-note {
    padding: 8px var(--deck-spacing);
    border-top: 1px solid var(--deck-line);
    flex: none;
  }
</style>
