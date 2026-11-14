# Repository instructions

PotPlayerChat is a Windows Electron app (Svelte 5, TypeScript, pnpm) that shows recorded Twitch chat in sync
with PotPlayer playback. Read `ARCHITECTURE.md` for process boundaries and data flow, and `DESIGN.md` before
changing the interface; it records the approved appearance and behavior.

- Fix spelling errors.
- Install required dependencies when they are missing (`pnpm install --frozen-lockfile`).
- Before committing, run `pnpm run typecheck` and ensure it passes.
- After implementation, validation, and review are complete, prepare a Windows installer with `./build-and-install.ps1 -SkipInstall` (or `pnpm run build:win` if the local helper is unavailable). Report the installer path so installation does not require another build.

## Setup and validation

A fresh checkout or git worktree needs only `pnpm install --frozen-lockfile` (Node 24, pnpm from
`packageManager`). Run these from the checkout you changed:

| Command                               | Checks                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run typecheck`                  | TypeScript (main and renderer) and `svelte-check`, warnings fail                                                                     |
| `pnpm exec eslint --max-warnings=0 .` | Lint without rewriting files (`pnpm run lint` also applies fixes)                                                                    |
| `pnpm test`                           | Vitest unit tests (`src/**/*.test.ts`)                                                                                               |
| `pnpm run test:browser`               | Playwright fixture regressions in installed Chrome (`tests/browser/README.md`); run for transcript, search, popup and layout changes |
| `pnpm run format`                     | Prettier, including Svelte files                                                                                                     |

CI (`.github/workflows/build.yml`) runs lint, typecheck, the Windows build and the unit tests on every pull
request and push to `main`.

`build-and-install.ps1` is a local-only helper (excluded through `.git/info/exclude`), so worktrees do not
contain it. From a worktree, run the main checkout's copy against it:
`& <main checkout>/build-and-install.ps1 -ProjectDir . -SkipInstall`. Builds are cached per checkout.
`resources/twitch-keys.json` is also local-only; without it the app uses the built-in public Twitch client id,
which is enough for development and tests. Release builds read personal keys from outside the install
(the app data folder, or `Config/PotPlayerChat` in `~/Sync` or OneDrive; see `README.md`).

## Releases and updates

- Every push to `main` publishes a GitHub release that installed copies offer through the toolbar Update
  button. Pushing to `main` is therefore a release to users; only push validated work.
- Versions are `<major>.<minor>.<commit count>` (`scripts/app-version.mts`), applied by
  `electron-builder.ts`. Keep `main`'s history append-only so versions keep increasing; bump the minor
  version in `package.json` only for deliberate milestones. Builds need full history (no shallow clones).
- The updater (`src/main/update.ts`) checks 15 seconds after launch and every 4 minutes, and downloads or
  installs only when the user clicks. `build/installer.nsh` relaunches the app with its previous elevation.
  Development builds (`pnpm run dev`) have no update feed and show updates as unavailable. Packaged builds,
  including `dist/win-unpacked`, check the real feed; don't install an update from a test run.
- Never embed secrets in release builds: everything under `resources/` ships in the public installer.
