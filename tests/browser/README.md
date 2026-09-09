# Transcript browser regressions

Run `pnpm run test:browser`. The suite uses installed Chrome; set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another Chromium executable.

The Vite fixture mounts the real chat, search, profile, message, and virtual
transcript components. PotPlayer IPC, Twitch services, preview metadata, and
image responses are deterministic fixtures. Tests never launch the installed
app or access its settings. Vite cache and failure artifacts go to the system
temporary directory.

Geometry cases exercise row recycling, replaced message windows, removed
anchors, native scrolling, and DOM-only media resizing. Media cases sample
reading anchors and bottom following between frames while assets resolve,
then check whitespace, selection, badges, cheers, overlays, cache clearing,
viewport width, density, and timestamps. Popup cases resolve older history
after the reader moves; the main chat case checks settings restoration and
Return to playback.
