<script lang="ts">
  import conf from '../state/config'
  import {
    defaultSettings,
    normalizeSettings,
    settings,
    settingsConfigKey
  } from '../state/settings.svelte'

  $effect(() => {
    normalizeSettings()
    conf.set(settingsConfigKey, $state.snapshot(settings))
  })

  $effect(() => {
    window.api.setPollingIntervals($state.snapshot(settings.intervals))
  })

  $effect(() => {
    conf.set('prerelease', $state.snapshot(settings.general.prerelease))
  })

  async function resetAllSettings(): Promise<void> {
    Object.assign(settings, defaultSettings)
    conf.set(settingsConfigKey, $state.snapshot(settings))
  }
</script>

<div class="settings-panel">
  <div class="header-section">
    <h2 class="title">Settings</h2>
    <button class="reset-button" onclick={resetAllSettings}> Reset All Settings </button>
  </div>

  <fieldset>
    <legend>Chat Settings</legend>
    <label>
      <span class="label-text">Chat Message Limit:</span>
      <input type="number" bind:value={settings.chat.chatMessageLimit} min="1" />
    </label>
    <label>
      <span class="label-text">Timestamp Offset:</span>
      <input type="number" bind:value={settings.chat.timestampOffset} />
    </label>
    <label>
      <span class="label-text">Session Timestamp Offset (Not Saved):</span>
      <input type="number" bind:value={settings.chat._sessionTimestampOffset} />
    </label>
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
    <legend>Interface Settings</legend>
    <label>
      <input type="checkbox" bind:checked={settings.interface.enableEmotes} />
      Enable Emotes
    </label>
    <label>
      <input type="checkbox" bind:checked={settings.interface.enableLinkPreviews} />
      Enable Link Previews
    </label>
    <label>
      <input type="checkbox" bind:checked={settings.interface.enableEmotePreviews} />
      Enable Emote Previews
    </label>
    <label>
      <span class="label-text">Default Preview Position:</span>
      <select bind:value={settings.interface.defaultPreviewPosition}>
        <option value="top">Top</option>
        <option value="bottom">Bottom</option>
      </select>
    </label>
    <label>
      <input type="checkbox" bind:checked={settings.interface.stickyPreviews} />
      Sticky Previews
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
    <label>
      <input type="checkbox" bind:checked={settings.interface.requireHttpInUrl} />
      Require HTTP in URL
    </label>
  </fieldset>

  <fieldset>
    <legend>Search Settings</legend>
    <label>
      <span class="label-text">Show All Messages:</span>
      <input type="checkbox" bind:checked={settings.search.showAllMessages} />
    </label>
  </fieldset>

  <fieldset>
    <legend>Interval Settings</legend>
    <label>
      <span class="label-text">Video Time:</span>
      <input type="number" bind:value={settings.intervals.videoTime} min="500" />
    </label>
    <label>
      <span class="label-text">Active Window:</span>
      <input type="number" bind:value={settings.intervals.activeWindow} min="100" />
    </label>
    <label>
      <span class="label-text">PotPlayer Instances:</span>
      <input type="number" bind:value={settings.intervals.potplayerInstances} min="500" />
    </label>
  </fieldset>

  <fieldset>
    <legend>Update Settings</legend>
    <label>
      <input type="checkbox" bind:checked={settings.general.prerelease} />
      Enable Prerelease Updates (Applies on next restart)
    </label>
  </fieldset>
</div>

<style>
  .settings-panel {
    flex: 0 1 calc(clientHeight);
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    padding: 1rem;
    background-color: var(--color-black-soft);
    color: var(--color-text-light);
    overflow-y: auto;
    user-select: text;
    cursor: default;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .title {
    color: var(--color-white);
    font-size: 1.8rem;
    margin: 0;
    margin-left: 1rem;
  }
  .reset-button {
    background-color: var(--color-black-deep);
    color: var(--color-white);
    border: 1px solid var(--color-gray-4);
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }
  .reset-button:hover {
    background-color: var(--color-accent, #e74c3c);
  }
  .reset-button:active {
    transform: translateY(1px);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-gray-4);
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    background-color: var(--color-black-deep);
  }

  legend {
    font-weight: bold;
    color: var(--color-accent);
    padding: 0 0.5rem;
    font-size: 1.1rem;
  }

  label {
    display: flex;
    max-height: 3rem;
    align-items: center;
    margin-bottom: 0.8rem;
    color: var(--color-text-light);
    font-size: auto;
  }

  .label-text {
    width: fit-content;
    white-space: nowrap;
    margin-right: 0.4rem;
  }

  input[type='checkbox'] {
    margin-right: 0.8rem;
    width: 18px;
    height: 18px;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  input[type='text'],
  input[type='number'] {
    width: 100%;
    min-width: 3.5rem;
    padding: 0.5rem;
    border: 1px solid var(--color-gray-5);
    border-radius: 4px;
    background-color: var(--color-bg-gray);
    color: var(--color-text-light);
    box-sizing: border-box;
    margin-left: 0;
  }

  input[type='text'],
  input[type='number'] {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--color-gray-5);
    border-radius: 4px;
    background-color: var(--color-bg-gray);
    color: var(--color-text-light);
    box-sizing: border-box;
  }
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    color: var(--color-text-light);
  }

  input[type='text']:focus,
  input[type='number']:focus,
  select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--color-focus-shadow);
  }

  select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--color-gray-5);
    border-radius: 4px;
    background-color: var(--color-bg-gray);
    color: var(--color-text-light);
    box-sizing: border-box;
  }
  option {
    background-color: var(--color-bg-gray);
    color: var(--color-text-light);
  }

  @media (max-width: 768px) {
    .settings-panel {
      padding: 0.8rem;
    }

    h2 {
      font-size: 1.6rem;
      margin-bottom: 1rem;
    }

    fieldset {
      padding: 0.8rem;
      margin-bottom: 1rem;
    }

    legend {
      font-size: 1rem;
    }

    label {
      font-size: 0.95rem;
      margin-bottom: 0.6rem;
    }
  }
</style>
