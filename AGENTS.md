# Repository instructions

- Fix spelling errors.
- Install required dependencies when they are missing.
- Before committing, run `pnpm run typecheck` and ensure it passes.
- After implementation, validation, and review are complete, prepare a Windows installer with `./build-and-install.ps1 -SkipInstall` (or `pnpm run build:win` if the local helper is unavailable). Report the installer path so installation does not require another build.
