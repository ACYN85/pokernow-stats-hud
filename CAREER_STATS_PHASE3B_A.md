# Career Statistics Phase 3B-A: Career Data settings and backup UI

> Historical design record. This surface is implemented in public 1.1.0; current user-facing behavior is summarized in [CAREER_DATA.md](CAREER_DATA.md).

Phase 3B-A adds a compact **Settings > Career Data** surface. It is a frontend to the certified Phase 3A service-worker APIs; it is not a career player dashboard and does not connect career totals to player-profile classification.

## Summary and health

The panel reads `careerLedgerInfo()` through the existing MV3 runtime-message proxy. It shows tracking state and local start date, players tracked, physical career hand records, active logical hands, IndexedDB backend, ready state, storage schema v2, backup format v1, latest accepted timestamp, and quarantined-hand count.

Health is **Healthy** only when the backend is ready, the extension-origin IndexedDB backend and storage schema v2 are active, migration is complete, and no logical hands are quarantined. Other states show a concise **Attention needed** message and direct users to existing diagnostics. The UI never opens IndexedDB directly and does not serialize the ledger to estimate size.

## Export and restore

**Export Career Backup** calls the certified `exportCareerBackup()` API and downloads its returned format-v1 object as `pokernow-hud-career-backup-<UTC timestamp>.json`. The UI does not implement a second serializer or add session, HUD, profile, or derived-cache state.

**Restore Career Backup** follows three explicit stages:

1. A JSON file is read and parsed locally, then `prepareCareerRestore()` performs the complete certified validation without mutation.
2. The panel previews format, tracking start, player/physical/active counts, candidate digest, current live-career digest, and the unambiguous replace warning.
3. **Restore Career History** calls `replaceCareerBackup()` with `mode: "replace"`, explicit confirmation, and both exact previewed digests.

Selecting a file cannot replace data. If a new hand changes the current digest after preview, the service worker refuses replacement and the UI asks for a fresh preview. Successful replacement refreshes ledger metadata without reloading the extension. Invalid JSON, unsupported versions, integrity failures, and stale confirmation are shown as concise messages.

## Separation

Replacement remains confined to the career IndexedDB stores. Session Hands and statistics, profile classifier/shadow state, presentation hysteresis, profile labels, HUD visibility, and Settings state are untouched. Mutable restore remains absent from the page debug API. Merge restore, player cards, career leaderboard, session comparison, notes, exploit analysis, and career archetypes remain deferred.

## Validation

Automated coverage includes pure presentation and production wiring tests, canonical-export reuse, non-mutating preview, explicit two-digest confirmation, error mapping, keyboard/focus behavior, single-pane Settings scrolling, Phase 3A corruption/zero-mutation guarantees, session/profile separation, and the complete fast/full suites.

Manual Chrome validation on the preceding certified backend confirmed exact one-hand increments, exact page and extension reload survival, no observed duplicates, and working extension-origin diagnostics. Measured operations were about 37.8 ms for an uncached player, 0.7 ms cached, 27.2 ms initialization, 2.3 ms recent records, and 128.1 ms to enumerate 12 players. A manual two-table trial was impractical; automated concurrency coverage remains the certification source.
