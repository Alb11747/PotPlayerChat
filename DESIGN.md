# Chat Deck interface

PotPlayerChat is a Windows companion for reading recorded Twitch chat beside PotPlayer. The transcript is the primary surface; playback synchronization, instance recovery, and virtualized message rendering remain independent of the appearance layer.

## Approved appearance

Streamlined combines instance tabs and actions in one toolbar, with a compact status strip below the toolbar only while reading earlier messages. The strip shows Return to playback and the current playback time; clicking the time exposes offset adjustment. The recording title appears only in its tab. Recording tabs share its remaining width; Main and actions keep their compact size. Comfort separates the controls and adds spacing between messages. Both layouts use 17.5px chat text, 14.5px timestamps, 24px badges, and 40px emotes at the default 16px root, expressed in rem to scale together. Badges and cheers use centered inline alignment, with cheer amounts centered beside their icons; regular emote bottoms align with the normal text baseline. Both keep 2px gaps, and these proportions also apply to Search and profile transcripts. Both layouts hide the status strip while following playback. Inline preview images are centered within the message width. Graphite, Blue, and Lavender are independent palette choices. The default is Streamlined with Blue. Use Segoe UI, restrained separators, compact controls with four-pixel corners, and visible keyboard focus. Native windows retain their normal frames.

Shared CSS tokens live in the renderer's base stylesheet. Layout and palette are applied to the document root; message components use density tokens rather than fixed dimensions. All screens must remain usable at 360, 420, and 600 pixels wide. Settings, Search, and profile headers stay compact while their contents scroll. The profile message count sits immediately beside its history label.

## Settings and cross-window behavior

The existing configuration store persists `interface.layout`, `interface.palette`, and `interface.previewMode`. Existing unrelated preferences and per-video offsets survive migration. Defaults are cloned before hydration and reset. Saving is disabled until hydration completes; appearance notifications update open renderers without writing the notification back to storage.

Settings categories are Appearance, Chat, Previews, Search, Advanced, and Maintenance. They preserve the existing fields and units. Changes save immediately; app-cache clearing and seen/clicked-URL clearing remain separate operations.

Improve username contrast is enabled by default under Appearance and updates all open windows. Sender names, mentions, action text, and profile names retain their source hue while dark colors are brightened to reach 4.5:1 across the active palette's normal, hovered, and first-message backgrounds. Readable colors stay unchanged. The renderer caches corrections without changing stored Twitch colors; disabling the preference restores the source colors.

## Navigation and previews

Normal username activation opens the profile; Alt activation searches the bare username. Search and profile windows carry their source recording and message context. Returning to a historical message does not seek PotPlayer: chat displays that history until Return to playback is activated.

Original hover is the default preview mode. It follows the pointer, honors placement and sticky preferences, and contains no action or close buttons. Larger on click opens independent, non-modal native preview windows; Control activation opens them in either mode when previews are enabled. Inline-image click preferences remain separate.

Preview windows use the same one-time popup context registry as Search and profiles. Only exact packaged or development renderer routes are allowed; lifetime belongs to the source window. Closing a preview restores its trigger focus when the trigger still exists.

Expanded links provide Open link, Copy link, and SauceNAO. Copy retains the original URL. SauceNAO encodes the HTTP(S) thumbnail URL and is disabled without one. Retry refreshes only that URL's metadata/cache entry. Tooltip markup continues through the existing sanitizer.

## Transcript layout and scrolling

Main chat, Search, and profile history share a virtual transcript. Pretext prepares text once and estimates mixed text/media row heights; native DOM measurements remain authoritative for wrapping, selection, and interactions. Rows are keyed by message identity, with one viewport of overscan on each side. Prepared text and decoded media dimensions survive row recycling.

Unknown rows initially reserve 48px. Pretext refinement prioritizes the viewport and navigation target, then works through history in batches of at most 64 messages or 4ms, yielding after paint between batches. Published batches update only their changed rows. Asset notifications invalidate dependent messages or channels; data and layout changes cancel obsolete work. Estimates must not synchronously parse the full history or displace a valid DOM measurement.

Initial mounting renders the viewport before adding overscan after a paint. Large dataset replacement prepares dependency indexes, estimator state, and geometry cooperatively; rows and their presentation context publish together. Height updates copy only affected paths in an immutable sum tree with compact blocks of heights. Saved anchors retain their original geometry. Navigation queues by message identity while replacement is pending, and user input cancels it.

Search receives original message references through the opener context. Source-owned weak caches share ordered snapshots and lazy searchable text across popups; result arrays refer to those same objects. Merging, filtering, and complete color-timeline reconstruction yield in four-millisecond batches. The previous results keep their matching highlight pattern and colors until replacement rows are ready. Each popup retains its captured recording and its own loading and UI state; history requests are still local to that popup.

Search first renders a bounded neighborhood of up to 200 messages around its opening target. Ready badges, emotes, and captured mention colors accompany those original message references; missing assets never delay readable chat. Full-history preparation begins after the preview has a paint opportunity and expands the same transcript without resetting the reading anchor. Result counts remain secondary and appear when complete filtered rows are ready.

Inline previews appear once thumbnail metadata is available and use a text-sized image while decoding, then their natural bounded size. Unresolved emotes use the larger of the default 2.5rem square and their temporary text size; badge IDs reserve their boxes before metadata arrives. Loaded media compacts to its actual bounded size. Cheers scale to the full emote height even when their decoded asset is smaller, preserving aspect ratio and the 9rem width cap. A single scroll owner preserves the first visible message and, when available, its visible text fragment during reflow. Following playback pins the bottom; user navigation cancels outstanding positioning. Media callbacks must update asset state without issuing scroll commands.

## Verification and delivery

Keep regression coverage focused on settings migration/reset, cross-window notifications, popup ownership, activation modifiers, URL actions, and targeted retry. Inspect real components across the supported palette/layout/width combinations, including empty/error states and focus. Verify the actual unpacked executable with isolated test settings and distinguish fixture-backed UI checks from live PotPlayer/service integration.

Standalone mock galleries remain outside this repository. Their sample messages, simulated controls, and comparison navigation are not application features. Development evidence also stays outside the repository. Build with `pnpm run build:unpack`; installation and publication are separate actions.
