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

Input cases check that wheel and keyboard movement survive appends, that an
offset changed with no input event is kept instead of reverted, that continued
native movement stays attributed to the reader, and that a held scrollbar leaves
follow mode. A jump holds its target through layout changes until the next input.

`scroll-stability.spec.ts` samples the painted position of visible rows on every
frame under real wheel and scrollbar input, at 1x, 1.25x and 1.5x display scaling.
Rows differ from their estimates, real messages resolve media and background
estimates mid-scroll, and messages arrive while following. It fails on content
moving against the scroll direction, an unpinned or uncovered frame, movement
after input stops, or any page error (a layout loop surfaces as a Svelte
update-depth error). Synthetic fixed-height rows are held to 0.5px; real rows
have fractional heights and are held to 2px during media resolution.

A large MessageTranscript replacement case requests a distant row while preparation
is pending, then cancels another request with user input during a second replacement.
It checks both target selection and preservation of the reader's pixel offset while
background estimates continue to change.

The large Search case mounts 10,000 preloaded messages in a same-origin popup
and measures its opener's heartbeat during mounting, filtering, and delayed
emote resolution. Fixture data creation and browser navigation finish before
timing starts, so the 100ms budget covers application work. Per-phase timings
are attached to the test result. Native Electron window startup is verified
separately with an unpacked build and isolated settings.

The shared Search cases pass 10,000 and 100,000 source-owned message instances
through the actual `openSearchPopup` / `takeSearchContext` handoff. They assert
array, object, text-cache, and prepared-snapshot identity across three windows,
exercise rapid query replacement and callbacks after the source changes recording,
and verify that closing a sibling leaves Search usable. Attachments distinguish first
visible chat after mounting from complete results, filter and media timings, opener heartbeat gaps, and source V8
isolate heap usage after garbage collection with zero, one, and three windows.
Heap usage is diagnostic evidence, not process RSS or a brittle numeric assertion.
The 10,000-row heartbeat requirement remains below 100 ms; a missed 100,000-row
target is explicitly annotated in the report.

Preview regressions hold full snapshot preparation for more than one second while
checking readable, interactive rows with warm source colors, badges, and emotes.
The source captures assets through the production presentation store and the child
receives them through the real popup context. Separate cold-asset, no-match, retry,
and cache-clear cases ensure missing assets and preparation failures do not prevent
reading or leave misleading final counts. Warm previews also exercise query
replacement and preservation of a user-selected reading position during expansion.
First-chat attachments report opening action and mount latency separately at 10,000
and 100,000 messages; a missed 300 ms target is explicitly annotated. Fixture asset
warming and source-message creation finish before the opening action is timed.
