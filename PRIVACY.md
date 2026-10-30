# Privacy and local data — V1.6 compatibility

The prepared V1.6 compatibility ZIP contains the reviewed 107-file runtime allowlist, promoted from accepted Candidate 2 with both validated context-persistence and first-hand fixes; only final identity metadata differs from that baseline. No captures, test fixtures, profile backups or user data are packaged. This is not PokerNow's own privacy policy or a claim about other extensions.

## What is observed

On the two manifest-matched HTTPS PokerNow game-page origins, the MAIN-world hook wraps PokerNow's existing WebSocket traffic and relays bounded observations to the isolated extension runtime. Observations can include game/hand IDs, stable player IDs/names, seats, stacks, actions, board/shown-card evidence, settlement and lifecycle/control state. DOM inspection supplies player-panel/layout and display/diagnostic context; Full Log is not an authoritative history importer.

Opt-in pause/deep diagnostics can additionally observe page fetch/XHR/sendBeacon/postMessage/custom-event details. These wrappers delegate the page's original request, rather than create an extension upload. Diagnostic code attempts secret-field redaction, but exports should still be reviewed for sensitive player/game or payload information.

## What persists

- Session: finalized event history, identity mappings, deduplication data and bounded active-hand/lifecycle checkpoints in per-game `chrome.storage.local` namespaces.
- Career: immutable contributions and metadata in extension-origin IndexedDB, plus rebuildable caches and local pending-write/migration state.
- Preferences: source/display choices, sizes, drag positions and related settings in local extension storage.
- Notes: separate stable-player-ID local storage; excluded from Career export, import and restore.
- Profiles: derived Session classification/presentation state is runtime/shadow state, not a separate cloud profile database.

Reloading a page does not necessarily erase Session history. Career persists across sessions until replaced or extension data is removed. Browser profile removal, uninstall, changing extension identity or clearing local data can lose access to data. Export Career Data before destructive changes; that file does not protect notes or Session state. Import merges Career history, while Advanced Recovery restore replaces it.

## Transmission and exports

**No extension-controlled external server** receives data in the audited code. The manifest has no external backend host permissions, externally-connectable API or web-accessible resources, and the production audit found no analytics/upload endpoint. The extension does not provide cloud sync.

This does **not** mean the PokerNow page is offline or that all observed traffic originates from the extension: PokerNow's ordinary requests continue to its own services. MAIN/isolated bridging uses page messages, and bounded diagnostic bridges expose selected information in page DevTools; local page-world scripts may observe such messages. There is no claim of secrecy from the host page.

Career backups, downloads, clipboard copies and diagnostics are user-initiated local exports, not encrypted vaults. Once you share them, their destination is outside this extension's control. Review content before sharing and avoid attaching raw browser HAR captures unnecessarily.

## Permission audit

`storage` supports settings and Session persistence; `unlimitedStorage` supports durable local Career storage; `alarms` supports existing background maintenance/recovery; `activeTab` is retained for the popup's active-table messaging/reset workflow. No permission was added or removed. Injection remains limited to `https://pokernow.com/games/*` and `https://www.pokernow.com/games/*`.

Evidence: `manifest.json`, `websocketHook.js`, `content.js`, `careerServiceWorker.js`, `careerIndexedStore.js`, `careerBackup.js`, `playerNotesStore.js` and the diagnostic bridge/capture modules. This is a code audit, not a network penetration test.

## Account grouping and backup scope

Local Person associations group eligible saved histories at the user's direction; they do not authenticate account ownership or reconstruct lost identity types. Explicit Person + Career exports preserve associations but exclude notes and Settings. Legacy Backup v1/v2 omit memberships. Career exports alone do not protect complete Session, notes or preferences; a verified offline extension-data checkpoint is required for complete upgrade rollback. Keep backups private and outside publishable packages. Genuine native gameplay/account admission remains disabled.
