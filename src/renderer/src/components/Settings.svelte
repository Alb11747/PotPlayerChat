<script lang="ts">
  import conf from '../state/config'
  import { settings, settingsConfigKey } from '../state/settings.svelte'

  $effect(() => {
    conf.set(settingsConfigKey, $state.snapshot(settings))
  })

  $effect(() => {
    window.api.setPollingIntervals($state.snapshot(settings.intervals))
  })
</script>

<div class="settings-panel">
  <h2 class="title">Settings</h2>

  <fieldset>
    <legend>Chat Settings</legend>
    <label>
      <span class="label-text">Chat Message Limit:</span>
      <input type="number" bind:value={settings.chat.chatMessageLimit} min="1" />
    </label>
    <label>
      <span class="label-text">JustLog URL:</span>
      <input type="text" bind:value={settings.chat.justlogUrl} />
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
      <input type="checkbox" bind:checked={settings.interface.showTimestamps} />
      Show Timestamps
    </label>
    <label>
      <input type="checkbox" bind:checked={settings.interface.showBadges} />
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
      <input type="checkbox" bind:checked={settings.interface.stickyPreviews} />
      Sticky Previews
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
</div>

<style>
  .settings-panel {
    flex: 0 1 calc(clientHeight);
    display: flex;
    width: 100%;
    flex-direction: column;
    padding: 1rem;
    background-color: #23232b;
    color: #efeff1;
    overflow-y: auto;
    user-select: text;
    cursor: default;
  }

  .title {
    color: #fff;
    font-size: 1.8rem;
    text-align: center;
    margin-bottom: 0.5rem;
  }

  fieldset {
    display: flex;
    flex-direction: column;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    background-color: #1e1e26;
  }

  legend {
    font-weight: bold;
    color: #4e8cff;
    padding: 0 0.5rem;
    font-size: 1.1rem;
  }

  label {
    display: flex;
    max-height: 3rem;
    align-items: center;
    margin-bottom: 0.8rem;
    color: #efeff1;
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
    accent-color: #4e8cff;
    cursor: pointer;
  }

  input[type='text'],
  input[type='number'] {
    width: 100%;
    min-width: 3.5rem;
    padding: 0.5rem;
    border: 1px solid #444;
    border-radius: 4px;
    background-color: #2a2a33;
    color: #efeff1;
    box-sizing: border-box;
    margin-left: 0;
  }

  input[type='text'],
  input[type='number'] {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #444;
    border-radius: 4px;
    background-color: #2a2a33;
    color: #efeff1;
    box-sizing: border-box;
  }
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    color: #efeff1;
  }

  input[type='text']:focus,
  input[type='number']:focus,
  select:focus {
    outline: none;
    border-color: #4e8cff;
    box-shadow: 0 0 0 2px rgba(78, 140, 255, 0.5);
  }

  select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #444;
    border-radius: 4px;
    background-color: #2a2a33;
    color: #efeff1;
    box-sizing: border-box;
  }
  option {
    background-color: #2a2a33;
    color: #efeff1;
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
