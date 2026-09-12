# Transcript browser regressions

Run `pnpm run test:browser`. The suite uses installed Chrome; set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another Chromium executable.

The Vite fixture builds and serves production versions of the real chat, search, profile, message, and virtual
transcript components. PotPlayer IPC, Twitch services, preview metadata, and
image responses are deterministic fixtures. Tests never launch the installed
app or access its settings. Fixture builds, Vite cache, and failure artifacts go to the system
temporary directory.

Geometry cases exercise row recycling, replaced message windows, removed
anchors, native scrolling, and DOM-only media resizing. Media cases sample
reading anchors and bottom following between frames while assets resolve,
then check whitespace, selection, badges, cheers, overlays, cache clearing,
viewport width, density, and timestamps. Popup cases resolve older history
after the reader moves; the main chat case checks settings restoration and
Return to playback.

The large Search case mounts 10,000 preloaded messages in a same-origin popup
and measures its opener's heartbeat during mounting, filtering, and delayed
emote resolution. Fixture data creation and browser navigation finish before
timing starts, so the 100ms budget covers application work. Per-phase timings
are attached to the test result. Native Electron window startup is verified
separately with an unpacked build and isolated settings.
