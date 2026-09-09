# Chat Deck interface

PotPlayerChat is a Windows companion for reading recorded Twitch chat beside PotPlayer. The transcript is the primary surface; playback synchronization, instance recovery, and virtualized message rendering remain independent of the appearance layer.

## Approved appearance

Streamlined combines instance tabs and actions in one toolbar, with recording information, playback time, status, and offset controls directly below the toolbar. Recording tabs share its remaining width; Main and actions keep their compact size. Comfort separates the controls and gives messages larger text and additional spacing. Both layouts keep playback context above the transcript. Inline preview images are centered within the message width. Graphite, Blue, and Lavender are independent palette choices. The default is Streamlined with Blue. Use Segoe UI, restrained separators, compact controls with four-pixel corners, and visible keyboard focus. Native windows retain their normal frames.

Shared CSS tokens live in the renderer's base stylesheet. Layout and palette are applied to the document root; message components use density tokens rather than fixed dimensions. All screens must remain usable at 360, 420, and 600 pixels wide. Settings, Search, and profile headers stay compact while their contents scroll. The profile message count sits immediately beside its history label.

## Settings and cross-window behavior

The existing configuration store persists `interface.layout`, `interface.palette`, and `interface.previewMode`. Existing unrelated preferences and per-video offsets survive migration. Defaults are cloned before hydration and reset. Saving is disabled until hydration completes; appearance notifications update open renderers without writing the notification back to storage.

Settings categories are Appearance, Chat, Previews, Search, Advanced, and Maintenance. They preserve the existing fields and units. Changes save immediately; app-cache clearing and seen/clicked-URL clearing remain separate operations.

## Navigation and previews

Normal username activation opens the profile; Alt activation searches the bare username. Search and profile windows carry their source recording and message context. Returning to a historical message does not seek PotPlayer: chat displays that history until Return to playback is activated.

Original hover is the default preview mode. It follows the pointer, honors placement and sticky preferences, and contains no action or close buttons. Larger on click opens independent, non-modal native preview windows; Control activation opens them in either mode when previews are enabled. Inline-image click preferences remain separate.

Preview windows use the same one-time popup context registry as Search and profiles. Only exact packaged or development renderer routes are allowed; lifetime belongs to the source window. Closing a preview restores its trigger focus when the trigger still exists.

Expanded links provide Open link, Copy link, and SauceNAO. Copy retains the original URL. SauceNAO encodes the HTTP(S) thumbnail URL and is disabled without one. Retry refreshes only that URL's metadata/cache entry. Tooltip markup continues through the existing sanitizer.

## Verification and delivery

Keep regression coverage focused on settings migration/reset, cross-window notifications, popup ownership, activation modifiers, URL actions, and targeted retry. Inspect real components across the supported palette/layout/width combinations, including empty/error states and focus. Verify the actual unpacked executable with isolated test settings and distinguish fixture-backed UI checks from live PotPlayer/service integration.

Standalone mock galleries remain outside this repository. Their sample messages, simulated controls, and comparison navigation are not application features. Development evidence also stays outside the repository. Build with `pnpm run build:unpack`; installation and publication are separate actions.
