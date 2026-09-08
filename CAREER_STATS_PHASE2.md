# Career Statistics Phase 2: indexed persistence and supersession

> Historical design record. The current public 1.1.0 Career contract is summarized in [CAREER_DATA.md](CAREER_DATA.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

Phase 2 changes only the career persistence/query layer. Certified poker reducers, session persistence, HUDs, and player profiles remain unchanged.

## Benchmark decision

The Phase 1 `chrome.storage.local.get(null)` shape materialized every immutable record at startup. The dedicated Node benchmark used representative three-player bundles and measured:

| Hands | JSON size | Parse | Hydrate/rebuild | List all | Rebuild one player | RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 3.49 MiB | 13.4 ms | 142.4 ms | 22.7 ms | 108.7 ms | 105.5 MiB |
| 10,000 | 34.87 MiB | 156.1 ms | 1.48 s | 204.7 ms | 1.35 s | 392.6 MiB |
| 50,000 | 174.33 MiB | 1.06 s | 6.96 s | 1.20 s | 4.52 s | 1.57 GiB |
| 100,000 | 348.71 MiB | 2.04 s | 14.14 s | 3.12 s | 11.59 s | 2.96 GiB |

These are automated Node/runtime measurements, not browser-performance claims. They demonstrate algorithmic and allocation behavior. Browser-specific IndexedDB transaction/latency measurements still require a live Chrome smoke/benchmark.

`chrome.storage.local` remains appropriate for settings, current-session snapshots, the migration marker, and a short-lived append outbox. It is no longer appropriate for hydrating multi-year immutable career history.

## IndexedDB architecture

The MV3 extension service worker owns database `PokerNowHUDCareer`, version 1. The content script never calls a web-storage API: it reaches the career backend only through an allowlisted `chrome.runtime` message protocol. This keeps IndexedDB under the extension origin instead of the PokerNow host-page origin. The database owns career data only:

- `careerRecords`: immutable physical records, keyed by fingerprint; indexes for logical hand key, stable player IDs, finalization time, and predecessor fingerprint.
- `careerMetadata`: career boundary, schema/migration state, counts, and monotonic append sequence.
- `careerAggregateCache`: disposable exact per-player aggregate caches.
- `careerPlayerHeads`: affected-player cache revisions and player enumeration.

No session, profile, setting, or HUD storage moved.

The content script startup reads only its ordinary bounded runtime keys. The service worker verifies committed IndexedDB migration metadata before trusting the small Chrome marker; a stale marker with a missing/incomplete database therefore re-reads the retained Phase 1 source safely. After a verified migration, it does not request historical record values from `chrome.storage.local`. Modern Chrome `storage.local.getKeys()` enumerates only pending outbox keys in the service-worker context; the compatibility fallback uses `get(null)` only where `getKeys()` is unavailable.

## Structural Phase 1 migration

On the first Phase 2 startup:

1. Phase 1 items are read exactly as stored.
2. Every fingerprint/schema/semantic version is validated without running poker inference.
3. Exact records are copied by the extension service worker to one IndexedDB transaction with metadata, player heads, and initial exact caches.
4. The existing `careerTrackingStartedAt`, `careerSchemaInitializedAt`, first hand, and timestamps are preserved.
5. The IndexedDB metadata commits `migration.state = complete` atomically.
6. A small Chrome-storage marker prevents future all-record reads.

An abort commits none of the migration transaction. Retry is idempotent because physical records are fingerprint-keyed and an already-complete database bypasses import. Old Phase 1 items are deliberately retained; Phase 2 never deletes or reinterprets them. Invalid/unknown input blocks migration and reports diagnostics.

## Crash-safe append and concurrency

Before a new record transaction, the content script writes that immutable record to a fingerprint-keyed Chrome-storage outbox. It then asks the service worker to atomically append the record, advance metadata/player revisions, and invalidate only affected player caches. Success or an exact duplicate clears the outbox. Transaction failure, content reload, or service-worker restart retains it for retry; service initialization replays pending entries before accepting requests.

IndexedDB serializes read/write transactions. Different table tabs therefore cannot lose metadata/player-head updates, including when the same stable player appears at both tables. Fingerprint and logical-hand validation remain the idempotence boundary.

## Logical identity and supersession

- Physical identity: immutable semantic fingerprint.
- Logical identity: provider + host + game ID + authoritative hand ID, represented by `handKey`.

Normal gameplay creates one root. A correction creates a new immutable record for the same logical hand with `supersedesFingerprint` pointing to the active predecessor and at least one supported semantic version advanced.

The resolver accepts linear A→B and A→B→C chains and counts only the tip. It quarantines the entire logical hand for missing predecessors, forks, disconnected chains, cycles/self-reference, cross-hand or cross-player transitions, semantic-version regression, or a correction that advances no semantic version. It never chooses a branch heuristically.

Known compatible exact-delta semantic versions may coexist across different hands. Unknown future versions fail conservatively.

## Caches and queries

Aggregate caches contain exact counters only and are disposable. Each cache is checked against aggregate schema and a player-head revision. Missing, malformed, old-version, partial, or stale entries rebuild from the stable-player index. A normal append invalidates affected players only.

The read-only `PokerNowHUDCareer` API is asynchronous under IndexedDB:

- `await careerStats(playerId)`
- `await careerPlayers()`
- `await careerLedgerInfo()`
- `await careerPlayerRecordInfo(playerId)`
- `await recentCareerRecords(limit)` (indexed cursor, maximum 20)
- `await rebuildCareerStats()` (explicit full scan)
- `await exportCareer()` (explicit deterministic full scan)

The canonical export is JSON-safe metadata plus immutable records sorted by hand key and fingerprint, with explicit export/storage/record/aggregate versions. Import mutation remains out of scope.

## Size audit

The representative Phase 1 item averaged 3,644 bytes including its Chrome-storage key. The IndexedDB envelope averaged 3,591 bytes, a 1.5% reduction. Most bytes are the readable semantic bundle, not avoidable key overhead.

Repeated namespace, version, property, decision, and presentation fields were reviewed. Phase 2 intentionally did not compact or binary-compress them: per-record namespace/version history, reason codes, stable IDs, and correction auditability are durable semantics. Lifecycle aliases, names, and source IDs remain excluded from the semantic fingerprint but retained for audit. A future format version may normalize common strings only with measured read/write benefits and a reversible representation.

## Dedicated 100k invariant

`careerPhase2ScaleBenchmark.js 100000` is an opt-in slow benchmark, not part of fast/full CI. With 100 stable players and compact one-player records it verified 100,000 unique keys/fingerprints, exact rebuild, duplicate idempotence, active supersession, and a 1,000-record indexed player rebuild. On the bundled Node runtime it measured 4.55 seconds for full rebuild, 51.5 ms for one indexed player, and 384.9 MiB RSS. These figures are runtime evidence, not a Chrome latency certification.

## Manual Chrome smoke procedure

After loading the candidate on a PokerNow game page, select the extension's isolated content-script console:

1. `const before = await PokerNowHUDCareer.careerLedgerInfo()`
2. Observe several finalized hands.
3. `const players = await PokerNowHUDCareer.careerPlayers()` and choose a stable `playerId`.
4. `const after = await PokerNowHUDCareer.careerStats(playerId)`
5. Reload; repeat steps 1 and 4 and verify exact counters are unchanged.
6. Observe one new finalized hand; verify only its participating players advance once.
7. `await PokerNowHUDCareer.recentCareerRecords(5)` and `await PokerNowHUDCareer.careerPlayerRecordInfo(playerId)`.
8. Optionally open a second table, finalize near-simultaneous hands, reload both, and verify the shared player's totals include both once.

Also verify `careerLedgerInfo().migration.state === 'complete'`, backend `extension-service-worker-indexeddb`, and no new extension error. In `chrome://extensions`, inspect the extension service worker and confirm its Application/IndexedDB panel contains `PokerNowHUDCareer`; the PokerNow page-origin storage must not contain that database. This procedure has been documented but requires a user-controlled live PokerNow table; the automated production replay is not presented as a manual live result.

Formal backup and atomic replace restoration are specified in [CAREER_STATS_PHASE3A.md](CAREER_STATS_PHASE3A.md).
