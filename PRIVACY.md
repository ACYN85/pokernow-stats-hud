# Privacy and local data — public 1.5.0

This note describes the accepted 83-file release, not PokerNow's own privacy policy or the behavior of other extensions.

## What is observed

On the two manifest-matched HTTPS PokerNow game-page origins, the MAIN-world hook wraps PokerNow's existing WebSocket traffic and relays bounded observations to the isolated extension runtime. Observations can include game/hand IDs, stable player IDs/names, seats, stacks, actions, board/shown-card evidence, settlement and lifecycle/control state. DOM inspection supplies player-panel/layout and display/diagnostic context; Full Log is not an authoritative history importer.

Opt-in pause/deep diagnostics can additionally observe page fetch/XHR/sendBeacon/postMessage/custom-event details. These wrappers delegate the page's original request, rather than create an extension upload. Diagnostic code attempts secret-field redaction, but exports should still be reviewed for sensitive player/game or payload information.

## What persists

- Session: finalized event history, identity mappings, deduplication data and bounded active-hand/lifecycle checkpoints in per-game `chrome.storage.local` namespaces.
- Career: immutable contributions and metadata in extension-origin IndexedDB, plus rebuildable caches and local pending-write/migration state.
- Preferences: source/display choices, sizes, drag positions and related settings in local extension storage.
- Notes: separate stable-player-ID local storage; excluded from Career exports, imports and restores.
- Profiles: derived Session classification/presentation state is runtime/shadow state, not a separate cloud profile database.

Reloading a page does not necessarily erase Session history. Career persists across sessions until replaced, explicitly removed, or extension data is removed. Browser profile removal, uninstall, changing extension identity or clearing local data can lose access to data. Export Career Data before destructive changes; that backup does not protect notes or Session state.

## Transmission and exports

**No extension-controlled external server** receives data in the audited code. The manifest has no external backend host permissions, externally-connectable API or web-accessible resources, and the production audit found no analytics/upload endpoint. The extension does not provide cloud sync.

This does **not** mean the PokerNow page is offline or that all observed traffic originates from the extension: PokerNow's ordinary requests continue to its own services. MAIN/isolated bridging uses page messages, and bounded diagnostic bridges expose selected information in page DevTools; local page-world scripts may observe such messages. There is no claim of secrecy from the host page.

Career Backup v1/v2 gzip exports, downloads, clipboard copies and diagnostics are user-initiated local exports, not encrypted vaults. Import (Merge) and Restore (Replace) read a user-selected local file; neither uploads it to an extension server. Once you share an export, its destination is outside this extension's control. Review content before sharing and avoid attaching raw browser HAR captures unnecessarily.

## Permission audit

`storage` supports settings and Session persistence; `unlimitedStorage` supports durable local Career storage; `activeTab` is retained for the popup's active-table messaging/reset workflow. `alarms` schedules bounded local derived-state maintenance across worker wakes. Injection remains limited to `https://pokernow.com/games/*` and `https://www.pokernow.com/games/*`.

Evidence: `manifest.json`, `websocketHook.js`, `content.js`, `careerServiceWorker.js`, `careerIndexedStore.js`, `careerBackup.js`, `playerNotesStore.js` and the diagnostic bridge/capture modules. This is a code audit, not a network penetration test.

## Public fixture sanitation

The first V1.5 final-release attempt stopped after a complete-tree scan found a captured-production room identifier in three existing tests. The current release replaces those fixture locations with the deterministic synthetic room `synthetic-room-fixture`, preserving URL, manifest-order, and initialization-guard coverage. The shipped runtime and accepted RC2 archive are unchanged.

Historical exposure is classified **ALREADY-IN-PUBLIC-HISTORY**: the earliest affected commit is `18e13f1d015c8fb0693ba1596c24aee51a9e2176`, and the V1.3/V1.4 tags contain the old test fixture. This is forward sanitation, not historical removal. Existing public history and release tags remain intact under the project's immutable-release convention. Current-tree privacy checks do not certify historical trees as free of that identifier.
