# PotPlayerChat

PotPlayerChat is an Electron desktop app that syncs Twitch chat with local PotPlayer playback.
It is built with Electron, Svelte 5, and TypeScript.

## Features

- Detects running PotPlayer instances and tracks active playback.
- Resolves stream metadata (channel and start time) from playlist/history.
- Loads historical chat from JustLog and aligns it with video time.
- Supports searchable chat in a dedicated search window.
- Renders Twitch emotes, badges, cheers, and sanitized link previews.
- Persists app settings and cached metadata across sessions.

## Tech Stack

- Electron + electron-vite
- Svelte 5 + TypeScript
- pnpm
- Twurple (Twitch API/auth/chat helpers)
- `@mkody/twitch-emoticons`
- `@isaacs/ttlcache`, `async-lock`, `bloom-filters`
- `koffi`, `regedit`, `tasklist` (Windows integration)

## Requirements

- Node.js 24 (as in CI)
- pnpm 10.29.3 (see `packageManager`)
- PotPlayer installed (Windows-focused integration)

## Quick Start

```bash
pnpm install
pnpm run dev
```

## Scripts

- `pnpm run dev` - start app in development mode.
- `pnpm run start` - preview built app via electron-vite.
- `pnpm run build` - typecheck and build all app bundles.
- `pnpm run build:unpack` - build unpacked distributable.
- `pnpm run build:win` - create Windows installer/package.
- `pnpm run lint` - run ESLint with autofix.
- `pnpm run format` - run Prettier.
- `pnpm run typecheck` - run TypeScript + Svelte checks.
- `pnpm test` - run Vitest unit tests.
- `pnpm run test:browser` - run Playwright regressions (see `tests/browser/README.md`).

## Project Layout

```text
src/
  main/         Electron main process (windows, IPC, native integration)
  preload/      secure bridge API exposed to renderer
  renderer/     Svelte UI (main chat window + search window)
  core/         shared domain logic (chat providers, PotPlayer adapters)
  utils/        reusable helpers and data structures
  types/        shared TypeScript type definitions
```

## Runtime Overview

1. Main process starts and creates the primary BrowserWindow.
2. Preload exposes `window.api` IPC methods to renderer.
3. Main process polls PotPlayer windows and current playback time.
4. Renderer requests video metadata and chat ranges from `ChatService`.
5. Chat data is fetched from JustLog, cached, then rendered in Svelte.
6. Search window receives serialized message data and supports fast filtering.

See `ARCHITECTURE.md` for a full breakdown.

## Configuration and Secrets

Twitch keys are loaded in this order:

1. Environment variables:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET` (optional)
2. Local file at `resources/twitch-keys.json`:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret"
}
```

When no key is supplied, the app falls back to a built-in public client id.

## Development Notes

- Run lint and format explicitly with `pnpm run lint` and `pnpm run format`; Git hooks are not installed.
- Before committing, run `pnpm run typecheck` and ensure it passes.
- Some dependencies are patched via `pnpm.patchedDependencies`.
- Agent and contributor workflow, including worktree setup, is in `AGENTS.md`.

## Releases and Updates

Every push to `main` builds the Windows installer in GitHub Actions and publishes it as a release.
Versions are `1.0.<commit count>`, so every later commit has a higher version and a local build matches
the CI release of the same commit.

Installed copies check for a new release 15 seconds after launch and every 4 minutes. An **Update** button
then appears in the toolbar: click it to download, then **Restart** to install and relaunch. Settings >
Advanced shows the current version and lets you check now. Development and unpacked builds do not update.

## Troubleshooting

- No PotPlayer detected:
  - Verify PotPlayer is running and not blocked by permissions.
  - Confirm you are on Windows with a supported PotPlayer installation.
- Chat not loading:
  - Check network access to your configured JustLog endpoint.
  - Confirm detected channel/start time are correct for the current video.
- Emotes/badges missing:
  - Ensure Twitch API keys are configured and valid.

## License

See `LICENSE.md`.
