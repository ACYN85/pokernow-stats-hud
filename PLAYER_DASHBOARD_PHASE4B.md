# Player Dashboard Phase 4B: positional and relational analysis foundation

> Historical design record. The position and relational query foundation is implemented in public 1.1.0; dated candidate labels below describe development chronology.

Build `candidate-position-relational-crossfilter-foundation-20260812-2103` adds provenance and read-only query infrastructure. It does not add final dashboard filter controls, trends, leak detection, exploit analysis, or graphs.

## Authoritative position evidence

Position is resolved once from the first frozen semantic-ledger observation for the authoritative hand. `iHPI` supplies the stable IDs actually dealt, `seats` supplies their numeric clockwise seat order, and `dealerID`, `sBPI`, and `bBPI` supply button, small blind, and big blind identity. `deadButton` is retained and fails closed. Current seating, observers, display names, joins, leaves, rebuy state, and later seat changes are not inputs.

Production captures establish ascending numeric seat order with wrap as clockwise. For three or more players, the next dealt seat after the button must be SB and the next must be BB. Heads-up is explicit: the button must also be the PokerNow small blind and the other player must be BB; dashboard labels are `BTN` and `BB`.

| Dealt | Canonical positions, button-first |
|---:|---|
| 2 | BTN, BB |
| 3 | BTN, SB, BB |
| 4 | BTN, SB, BB, CO |
| 5 | BTN, SB, BB, UTG, CO |
| 6 | BTN, SB, BB, UTG, HJ, CO |
| 7 | BTN, SB, BB, UTG, LJ, HJ, CO |
| 8 | BTN, SB, BB, UTG, UTG+1, LJ, HJ, CO |
| 9 | BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO |

Evidence is unavailable rather than guessed when dealt count is outside 2–9, stable IDs or frozen unique seats are missing/duplicated, button/blind IDs are missing or not dealt, blind identities conflict with clockwise order, or a dead-button hand is observed. Unusual/missed blind posting does not change assignment when authoritative role identities and order agree; conflicting role evidence is unsupported.

## Durable record contract and coverage

Career record schema 3 adds per-player `position` with `schemaVersion: 1`, `status`, `dealtPosition`, `dealtPlayerCount`, and `unsupportedReason`. Schema-1 and schema-2 records remain valid and are never backfilled. Filter results expose total, position-tracked and matched hands, earliest position/relational timestamps, physical/active record counts, and exclusion counts. Historical version-1 labels must not be silently reinterpreted.

Session events receive the same resolver's frozen position and relational fields after existing certified reducers attach their unchanged deltas. Career records persist the same dimensions. Overall formulas are unchanged.

## Self identity and relational meaning

Incoming authenticated `registered.currentPlayer.id` is the canonical automatic self ID. It is PokerNow's local player binding, not a name, seat, HUD location, DOM string, or profile selection. Registration state is reissued on reload/reconnect/table revisit; the stable ID survives seat/name changes. Because this robust source exists, no manual Set-as-Me mapping or mutable identity setting is introduced.

Only three current stats have one sound qualifying counterpart:

- 3Bet → qualifying open raiser/target (`threeBetTargetPlayerId`)
- F3B → qualifying three-bettor (`foldToThreeBetAggressorPlayerId`)
- FCB → qualifying flop c-bettor (`foldToFlopCBetAggressorPlayerId`)

Hands, VPIP, PFR, AF, WTSD, and W$SD have no single counterpart. A CBet may face multiple defenders, so `flopCBetOpponentPlayerIds[]` remains context but CBet is rejected by the single-counterpart API.

`careerStatsFiltered(playerId, filters)` and `sessionStatsFiltered(playerId, filters)` accept explicit position, stat, counterpart, and `counterpartMode` (`specific`, `self`, or `others`). Vs You means the supported qualifying counterpart equals authenticated self. Vs Everyone Else means it exists and differs from self. Missing provenance belongs to neither group. Cross-filtering selects immutable contributions and sums existing exact counters; it performs no new poker inference.

## IndexedDB, caches, backup, and supersession

Filtered career reads use the existing multi-entry `playerIds` index, then filter only that player's records on demand. No database-version or index change is justified: this avoids global scans and a player × position × counterpart index/cache explosion. Existing overall-player aggregates remain cached; filtered results are disposable.

The opt-in `phase4bQueryBenchmark.js 100000` query-plan benchmark generated 100,000 records across 100 tracked players, selected 1,000 candidates through the modeled player index, and completed a position + Vs You exact-delta query in 76.2 ms on the bundled Node runtime. This is algorithmic evidence, not a Chrome IndexedDB latency claim; live-browser timing remains a future smoke check.

Career Backup format v1 accepts record schema 3 and round-trips the new provenance. Old format-v1 backups with schema-1/2 records stay valid. Filtered rebuilding uses existing active-record resolution, so only the supersession tip contributes while old physical versions remain auditable.

The read-only isolated-world `globalThis.PokerNowHUDCareer` API adds `filteredCareerStats`, `positionStats`, `relationalStats`, `filteredSessionStats`, and `selfIdentityInfo`. It exposes no IndexedDB mutation methods.
