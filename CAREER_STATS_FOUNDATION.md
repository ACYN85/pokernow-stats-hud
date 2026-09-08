# Career Statistics Phase 1 foundation

> Historical design record. The current public 1.1.0 Career contract is summarized in [CAREER_DATA.md](CAREER_DATA.md) and [ARCHITECTURE.md](ARCHITECTURE.md); later phases supersede the UI-scope statements below.

Phase 2 retains this semantic contract and moves its physical storage/query layer to extension-origin IndexedDB owned by the MV3 service worker. See [CAREER_STATS_PHASE2.md](CAREER_STATS_PHASE2.md).

Career v1 persists immutable certified finalized-hand contributions. It does not provide a career HUD, dashboard, leaderboard, profile input, historical import, or session backfill.

## Identity and start boundary

The durable hand namespace is the composite:

`pokernow | canonical host | PokerNow game/room ID | authoritative hI`

The game/room ID comes from the `/games/{id}` URL and is corroborated by the registered `gameState.id` shape. PokerNow archived hand-replayer links also pair a game identifier with a hand identifier. Synthetic protocol fixtures exercise normal hand boundaries and reconnect aliases; `hI` alone is not assumed globally unique. `gN` and synthetic `*:socket:*` lifecycle IDs are never durable career keys. Lifecycle IDs are retained only as audit aliases.

Career storage initializes with `careerTrackingStartedAt` and `careerSchemaInitializedAt`. Existing current-session events and aggregates are deliberately ignored. The first accepted record must be a newly finalized hand that traverses the Phase 1 consumer after initialization and has an authoritative `hI`.

## Immutable player-hand bundle

One record represents one authoritative hand and contains all stable-player contributions atomically. The record includes:

- career record schema and record type;
- canonical game/hand namespace and authoritative `hI`;
- lifecycle aliases;
- trusted finalization time;
- independent core/preflop/CBet/showdown/source-ledger semantic versions;
- one stable-ID player entry with exact counters, compact tri-state decisions, display-name metadata, and source reducer contribution IDs;
- a semantic fingerprint and a nullable `supersedesFingerprint` reserved for future corrections.

Percentages and AF ratios are not stored. AF stores postflop aggressive actions and calls. Unsupported decisions retain `opportunity: null`, `result: null`, and an unsupported reason while contributing no denominator. Supported `0/0`, `0/1`, and `1/1` decisions remain distinguishable.

The semantic fingerprint excludes volatile finalization time, lifecycle aliases, display names, and source attachment IDs. Therefore the same `hI` replayed under a new lifecycle alias is an exact duplicate. Any exact-counter or semantic-decision change produces a conflict.

## Storage and recovery

Each record is a separate `chrome.storage.local` item whose key includes the hand key and semantic fingerprint. Metadata and the aggregate cache are separate items. The manifest requests `unlimitedStorage`; Chrome documents that this removes the ordinary local-storage quota and eviction restrictions.

The existing serialized authoritative write queue writes the new immutable record, updated career metadata/cache, and session snapshot together. The immutable items are authoritative:

- a record without a cache rebuilds successfully after reload;
- a cache without its record cannot invent history;
- a failed write remains pending for the next authoritative snapshot;
- concurrent table tabs write different immutable keys, so stale cache/meta writes cannot erase either record;
- storage change handling incrementally consumes immutable records written by other open table tabs.

Hydration always rebuilds from valid immutable records. Unknown record or semantic versions are rejected conservatively. The cached aggregate is disposable.

## Capacity measurement

The deterministic representative fixture contains three players, all exact counters, six decision states per player, and reducer contribution identities. Measured JSON key-plus-value growth is approximately:

| Hands | Estimated storage |
|---:|---:|
| 1,000 | 3.48 MiB |
| 10,000 | 34.75 MiB |
| 100,000 | 347.52 MiB |

This remains intentionally uncapped and local. Phase 2 measured the get-all/hydration cost, adopted an extension-origin indexed backend, and added a dedicated 100,000-hand invariant benchmark without reinterpreting the v1 immutable record schema. Browser-specific latency still requires the documented live Chrome procedure.

## Corrections and supersession

Normal records are immutable. Storage keys include their semantic fingerprint, so a future corrected record can coexist with the original and reference it through `supersedesFingerprint`. Phase 1 does not choose or apply superseding versions: conflicting records fail conservatively. A later version must explicitly validate the reference chain and select one active version during rebuild.

## Read-only diagnostics

The isolated content-script world exposes `PokerNowHUDCareer` with:

- `careerStats(playerId)`
- `careerPlayers()`
- `careerLedgerInfo()`
- `rebuildCareerStats()`
- `recentCareerRecords(limit)` (bounded to 20)

These APIs do not mutate career history and do not expose an unbounded raw ledger.
