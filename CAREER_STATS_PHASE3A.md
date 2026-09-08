# Career Statistics Phase 3A: backup, atomic restore, and live durability

> Historical design and private-development validation record. The public repository does not include the signed-in session evidence described below; current contracts are in [CAREER_DATA.md](CAREER_DATA.md).

Phase 3A formalizes career-history backup and replacement restore. It does not add a career dashboard, career HUD statistics, profile integration, or a merge importer.

## Live Chrome status

Manual Chrome/PokerNow validation completed on the certified backend: counters advanced exactly one hand at a time, hard page reload and extension reload preserved exact totals, no duplicate counting was observed, and extension-origin IndexedDB diagnostics worked. Browser measurements were approximately 37.8 ms for the first uncached player lookup, 0.7 ms cached, 27.2 ms database initialization, 2.3 ms for recent records, and 128.1 ms for 12-player enumeration. A manual two-table concurrency trial was impractical; automated concurrency coverage remains green.

### Short live soak

Load the exact candidate unpacked, open a PokerNow game, select the extension's isolated content-script console, and run:

1. `const before = await PokerNowHUDCareer.careerLedgerInfo()`
2. `const players = await PokerNowHUDCareer.careerPlayers(); const id = players[0]?.playerId`
3. `const playerBefore = id ? await PokerNowHUDCareer.careerStats(id) : null`
4. Observe several finalized hands, then run `await PokerNowHUDCareer.careerStats(id)` and confirm exact expected counter deltas.
5. Reload the PokerNow page and confirm `careerLedgerInfo()` and the player's counters are unchanged.
6. Finalize one more hand and confirm exactly one additional contribution.
7. From `chrome://extensions`, reload the unpacked extension; revisit PokerNow and repeat the two reads.
8. If practical, finalize hands at two tables and confirm distinct hand keys, no lost same-player update, and unrelated stable IDs remain separate.
9. Reset the current session through the existing control and confirm career totals remain unchanged.

For an actual extension-runtime timing snapshot, run `await PokerNowHUDCareer.careerRuntimeTimings(id)`. It reports service initialization, ledger info, first/second one-player reads (including actual cache-hit or player-index-rebuild status), player enumeration, recent-record query, and the most recent incremental append. These are browser measurements only when invoked in Chrome; Node results are not substituted.

## Formal backup format

The canonical JSON-safe format is `pokernow-hud-career-backup`, version 1. It contains:

- career storage, record, aggregate, and backup versions;
- the current and supported semantic-version policy;
- the real career tracking/initialization boundary and first/latest accepted-hand metadata;
- every immutable physical career record, including stable player IDs, display metadata, exact counters, decisions, fingerprints, hand identities, and supersession predecessors;
- SHA-256 over the canonical payload plus independently validated physical, active, and player counts.

Records sort by logical hand key and fingerprint. Object keys use canonical sorted serialization for digesting. No aggregate percentages, disposable caches, session state, profile state, or HUD settings are authoritative backup data. `await PokerNowHUDCareer.exportCareerBackup()` returns the object; `await PokerNowHUDCareer.downloadCareerBackup()` downloads readable JSON with a digest-derived filename. `validateCareerBackup(value)` is read-only.

## Validation policy

The complete backup is parsed and validated before storage mutation. Validation covers exact format fields, format/schema versions, SHA-256, counts, record fingerprints, canonical namespace/hand keys, stable IDs, complete contribution metadata, exact counters/decisions, semantic versions, duplicate physical fingerprints, canonical ordering, and the entire supersession graph.

Unknown backup formats, unknown future record/reducer versions, and malformed historical records are rejected. Version 1 is the first formal backup version; there is no older formal version to migrate. Validation never runs current poker reducers over historical hands.

## Restore policy

Phase 3A implements replace restore only. Merge is deferred because independent physical versions for one logical hand can require policy choices; the backend will not guess.

The service worker:

1. validates the complete backup and rebuilds its deterministic aggregate in memory;
2. previews both the candidate-backup digest and current-live-career digest;
3. requires explicit `mode: "replace"`, `confirmed: true`, and both exact previewed digests, refusing if a hand changed the live career after preview;
4. serializes validation and replacement with incremental appends;
5. clears and repopulates records, metadata, caches, and player heads inside one IndexedDB read/write transaction;
6. reads the staged records and metadata again inside that same transaction;
7. aborts unless record counts and deterministic aggregates equal the validated plan.

An abort leaves the previous database transactionally intact. Replacement preserves the backup's real career boundary and rebuilds disposable caches solely from immutable records. The mutable replace method is deliberately absent from `PokerNowHUDCareer`; a confirmation UI is deferred to Phase 3B.

## Separation and recovery

Backup/restore touches only the four career IndexedDB stores. It does not mutate the current session event engine, session storage, profile classifier/shadow state, settings, or HUD state. The existing Chrome-storage outbox and service-worker restart recovery remain in force, and append/replace operations share a worker mutation queue.

No user-visible destructive reset was added. No IndexedDB deletion occurs during replacement. Phase 1 structural migration data remains retained as before.

## Phase 3B status

Phase 3B-A adds the small Settings > Career Data status, export, preview, and digest-bound explicit confirmation surface described in [CAREER_STATS_PHASE3B_A.md](CAREER_STATS_PHASE3B_A.md). Consider merge only after a separately specified conflict policy; career dashboard work should follow as a distinct project.
