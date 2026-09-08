# WTSD and W$SD design record

> Current status — public 1.1.0: WTSD and W$SD are implemented and covered by automated behavioral tests. This document retains historical candidate chronology; signed-in validation remains separate and is not included as public evidence.

Historical candidate build: `candidate-dashboard-drag-grip-live-fix-20260812-0738`. Phase 4A.1 changed only the live seat-overlay grip interaction and sizing and did not change showdown semantics. Coherent finalized profile snapshots, exact counter provenance, arbitrary-depth CBet ownership, terminal live mucked-loser membership, first-hand showdown handling, core-stat continuity, multiway F3B ownership, uncontested-winner handling, and explicit main/side-pot variants remain protected. The per-hand explanation API reports the same finalized contributions consumed by session aggregation, and the viewport-bounded read-only settings inspectors present hand-stat and player-profile evidence without DevTools.

The seat HUD renders WTSD/W$SD on a dedicated showdown row in both Combined and Stacked layouts. The leaderboard places both columns after FCB. Seat and leaderboard values are compact percentages; detailed numerator/denominator counts remain in shared accessible tooltips. A zero denominator renders `---`, while a supported zero numerator renders `0%`.

Overlay statistic preferences migrate from version 2 to version 3, and independent leaderboard preferences migrate from version 1 to version 2. Migration appends the two new default-enabled statistics without resetting existing selections or their order. Current-version preferences can hide either statistic independently. No poker-statistics persistence schema or storage key changed.

## Scope

`showdownStatsReducer.js` consumes finalized schema-version-1 semantic hand records. It does not parse WebSocket frames, observe active hands, write storage directly, or render UI.

The pure `deriveContribution(record)` function creates a deterministic per-hand contribution. The `createState` / `reduce` / `attach` / `inspect` API provides exact-identity deduplication and bounded in-memory inspection. `attach` is a read-only association audit: it records which existing finalized event matched, but never annotates or replaces that event.

Production flow is:

`WebSocket frames -> content lifecycle -> semanticHandLedger.finalize -> showdownStatsReducer.reduce -> PokerStats.applyShowdownContribution -> existing finalized live event -> existing liveEvents persistence`

The reducer registers after `flopCBetOpportunityReducer.js` and before `overlayStats.js`; Stage 1.4 requires `globalThis.PokerShowdownStatsReducer` before `content.js` starts.

## Authoritative counters

Only four binary per-hand contributions are copied from supported reducer output into an existing finalized event:

- `sawFlopForWTSD`;
- `wentToShowdown`;
- `showdownsForWSD`;
- `wonMoneyAtShowdown`.

Events additionally retain `showdownStatsReducerVersion`, `showdownStatsContributionId`, and `showdownStatsMatchedHandId` for exact idempotence and provenance. Rich outcome, award, return, pot, ambiguity, and evidence objects remain in bounded reducer diagnostics and are not duplicated in persisted events.

WTSD is `wentToShowdown / sawFlopForWTSD`. W$SD is `wonMoneyAtShowdown / showdownsForWSD`. Missing or legacy fields aggregate as numeric zero under live schema version 4, so no schema migration or additional storage key is required.

## Ledger audit

### Hand and history authority

- `handIdentity.handId` preserves PokerNow's authoritative hand identity when available.
- `handIdentity.lifecycleHandId` preserves the existing production lifecycle owner and deduplication identity.
- The reducer retains both identities and uses exact aliases only. It never performs fuzzy identity matching.
- `provenance.historyComplete: true`, `recovered: false`, and an ordered non-recovered action sequence are required. Partial recovery and observation truncation are unsupported.

### Saw-flop authority

`players[].sawFlop: true` must agree with `streets.flop.entrants`. This is the supported WTSD denominator. A player marked false and absent from the entrants has no opportunity. Contradictory or missing evidence is null/unsupported.

A preflop all-in player counts as seeing the flop when the authoritative flop transition retains that player in the entrant set. Automatic runout does not create betting actions, but it does not erase supported street participation.

### Showdown authority

The current ledger's `showdown.detected: true` is derived from bounded visible-card evidence. `showdown.participants` is therefore not a universal showdown list. `false` is supported only for a complete terminal foldout; all other uncertainty remains null.

The reducer does not require shown cards. It accepts an independently supported `players[].reachedShowdown: true`, so a semantically proven mucked participant can count. Production now establishes that membership for the bounded case where every live river entrant has an explicit check, every recorded river action is a check, history is complete, terminal phase is known, and settlement is retained. Missing cards, board completion, or settlement alone remain insufficient.

### Settlement and awards

A known current ledger settlement requires terminal phase plus object-valued `gameResult` evidence. Positive `gameResult.<player>.gained` values become gross awards keyed by stable player ID.

Current guarantees:

- gross positive award amount and recipient are supported for captured atomic settlements;
- absent result entries can represent a revealed loser in A3;
- returns/refunds remain separate reconciliation facts and are not awards;
- exact stack reconciliation may support a hand-level net result;
- repeated finalized lifecycle identities cannot produce another ledger record.

Current gaps:

- `potId` and `boardIndex` are null;
- `sidePotStatus` is null;
- `chopped` means multiple positive recipients, not necessarily one tied pot;
- main/side eligibility, incremental settlement, rake, odd chips, multiple boards, explicit return payloads, and mucked/disconnected membership outside the complete-river-check-through rule are not normalized;
- current captured settlement patches are atomic, so a separate multi-message settlement contract is unproven.

Exact duplicate award records are collapsed by exact award identity/tuple. Distinct awards require distinct award, pot, or board identities. This prevents replayed evidence from doubling gross amounts without pretending that anonymous equal awards are a complete multi-pot model.

## WTSD semantics

### Denominator

A player contributes one WTSD opportunity when:

1. the finalized history is complete and non-recovered;
2. the stable player identity is unique;
3. `players[].sawFlop` is true;
4. the same player is present in `streets.flop.entrants`.

No opportunity is contributed before the flop. Contradictory or incomplete participation is null, not zero.

### Numerator

A player contributes one Went-to-Showdown result when:

1. the player has a supported WTSD opportunity;
2. no supported flop/turn/river fold removes the player;
3. the finalized record explicitly establishes that player as a showdown participant;
4. at least one other explicit participant also reaches the contested showdown.

A supported postflop fold contributes `0/1`. A complete uncontested postflop terminal contributes `0/1` for every player who saw the flop and creates no W$SD denominator. This negative-showdown conclusion is supported when history and action order are complete, terminal settlement is known and internally consistent, exactly one positive award recipient remains among the flop entrants, every other flop entrant has an observed postflop fold, no explicit showdown participant or automatic runout exists, and the settlement does not claim a contested result. This covers flop, turn, and river foldouts without treating a lone award or the winner's failure to fold as sufficient evidence. Board completion alone never creates a numerator.

`showdownOpportunityCount` is the rich outcome denominator and equals one only when `wentToShowdown` is one.

## Rich showdown outcome semantics

The reducer retains rich outcome facts independently from the authoritative binary W$SD contribution. For every supported showdown participant it retains:

- `showdownOutcome`: `win`, `loss`, `tie`, `mixed`, or `unsupported`;
- exact gross showdown award when settlement supports it;
- exact reconciled hand net result when every reconciliation component agrees;
- pot counts for eligibility, sole wins, ties, and losses;
- separate WTSD and monetary-support flags;
- ambiguity codes and evidence.

It also emits `wonMoneyAtShowdownCandidate`, which the authoritative stats path ingests only when support is explicit:

- `1` when a supported showdown player has a positive proven contested gross award;
- `0` when complete contested settlement proves that player has no positive award;
- `null` for non-showdown players, missing/incomplete settlement, unsupported membership, or ambiguous awards.

`contestedGrossAward` excludes `excludedReturnAmount`. This candidate does not replace `showdownOutcome`; rich pot classification can remain unsupported while the aggregate binary candidate is supported.

### Explicit single pot

When `sidePotStatus: false` explicitly establishes one eligible pot:

- one positive recipient is `win`; other eligible participants are `loss`;
- multiple positive recipients with `chopped: true` are `tie`;
- unequal split amounts remain exact and are not converted to a fixed fraction.

### Explicit pot ledger

An optional future-compatible `settlement.pots` record must provide a unique pot identity, exact amount, eligible stable player IDs, and exact award allocation. Per-player outcome is then:

- `win`: at least one sole pot win and no tied/lost eligible pot;
- `tie`: at least one tied pot and no sole win/lost eligible pot;
- `loss`: losses in all eligible pots;
- `mixed`: more than one of win/tie/loss occurs across eligible pots.

A player who wins a side pot but loses the main pot is therefore `mixed`. A main-pot winner who was never eligible for the side pot can remain `win`.

Without explicit single-pot or complete per-pot evidence, gross awards are preserved but the outcome and pot counts remain unsupported.

### Returns and net results

`settlement.refunds` and award records explicitly typed as returns are excluded from `showdownGrossAward`. They cannot create a win.

`showdownNetResult` is emitted only when starting stack, committed amount, gross award, refund, and ending stack reconcile exactly. It is the full-hand stack result, not the future visible W$SD numerator.

## Direct design answers

1. **Does a preflop all-in automatic runout count as seeing the flop?** Yes, only when the all-in player remains in the supported flop entrant set.
2. **Does reaching showdown require exposed cards?** No. Explicit terminal semantic membership is sufficient.
3. **Does a mucked player count?** Yes when membership is independently supported. Complete river check-through, terminal river calls, visible comparison with other terminal live players, and completed-board all-in runouts can supply that support without requiring every hand to reveal; generic absence outside those bounded paths remains unknown.
4. **Does an uncontested river win count?** No. Both players may have WTSD opportunities, but neither reaches showdown.
5. **How are split pots represented?** As exact award amounts plus per-pot recipient sets when pot evidence exists.
6. **How are ties represented?** `showdownOutcome: "tie"` and `potsTied`; W$SD records one binary win when a supported participant receives a positive contested award, never a fixed 0.5.
7. **How are mixed main/side outcomes represented?** `showdownOutcome: "mixed"` with separate `potsWon`, `potsTied`, and `potsLost`.
8. **Are returned bets excluded?** Yes. Returns are never gross showdown awards.
9. **Can gross and net both be derived?** Gross can be supported by known contested awards. Net requires exact full reconciliation and is otherwise null.
10. **What supports an outcome?** Supported showdown membership, known contested settlement, valid deduplicated awards, and explicit single-pot or complete per-pot eligibility/allocation.
11. **What causes null/unsupported?** Partial history, malformed ordering/identity, contradictory saw-flop evidence, unknown showdown membership, missing settlement, contested-state conflict, malformed awards, or incomplete pot eligibility.
12. **Which visible W$SD definition is used?** Option A, any positive proven contested pot award divided by supported showdowns. It excludes returns and never consumes unsupported settlement.

## Visible W$SD options evaluated

### Option A — any award counts

Implemented: a supported positive contested-pot award counts once. It handles chops and side-pot shares in the conventional HUD style, while the rich reducer retains nuance for diagnostics.

### Option B — strict outright wins

Rejected as the default recommendation because it silently excludes chops and supported side-pot awards that conventional W$SD generally treats as money won.

### Option C — fixed 0.5 ties

Rejected because two-way, three-way, unequal odd-chip splits, and mixed pots do not share one correct 0.5 representation.

### Option D — equity-style pot share

Useful as a different analytical statistic, but not conventional W$SD and not safely available from the current pot schema.

Option A is exposed by the current automated-validation candidate.

## Fixture coverage

`testSupport/showdownStatsFixtures.js` contains sanitized semantic specification fixtures S1–S20. They contain no raw WebSocket traffic, account data, or session metadata. S4 and S11–S14 deliberately exercise future-compatible explicit semantic evidence that the current production ledger does not yet emit universally.

The focused test also replays sanitized authoritative A3, A4, and A6 fixtures through the real production ledger. Those records support WTSD membership and exact aggregate awards, but their null pot identity/side-pot status intentionally leaves rich monetary outcome unsupported. This distinction prevents specification fixtures from being misrepresented as captured PokerNow protocol proof.

`showdownStatsContentPath.production.test.js` adds realistic raw-message coverage through the exact manifest/content-script path. It covers turn/river folds, heads-up river-call muck, three-way check-through with two mucked losers, revealed and entirely unshown all-in runouts, chops, multiway aggregate settlement, returns, missing settlement, repeated terminal frames, reload/recovery, reconnect replay, differing lifecycle/authoritative aliases, and uncontested preflop completion.

Explicit complete pot ledgers support main/side winners, chops, mixed outcomes, and multiple awards to one player while still emitting one hand-level W$SD result. Explicit but incomplete per-pot allocation suppresses W$SD instead of guessing. Aggregate PokerNow settlements without an asserted side-pot ledger can still prove the binary any-positive-contested-award result; returns remain excluded.

`showdownFirstHandLifecycle.production.test.js` adds the fresh-game F1/F2 regression. It proves that a first-hand check-through with an unshown loser counts both showdown members, a second identical hand adds exactly once after restoration, duplicate terminal frames remain idempotent, all-in runouts remain supported, and river foldouts remain excluded.

`showdownStatsAuthoritative.production.test.js` adds A1-A21 coverage for bounded event annotations, existing live-event persistence and restoration, legacy zero normalization, duplicate/reload protection, exact stable-player ownership, session reset, and supported-only aggregation. `showdownStatsVisibleIntegration.production.test.js` covers the shared registry, production seat and leaderboard renderers, accessible tooltips, preference migration, restoration, legacy placeholders, and meaningful zeroes.

## First-hand-after-break correction

Live testing of the earlier visible candidate exposed an intermittent first-resumed-hand omission. PokerNow can send a non-empty `gameResult` while the merged hand is still on the river, then send terminal phase and reveal evidence in a later sparse patch. The old content path committed on the first settlement object, so the semantic record could retain a supported saw-flop denominator while showdown membership or settlement remained unsupported. The exact lifecycle identity was then finalized and later complete evidence was rejected as a duplicate.

The corrected path retains that early settlement as provisional evidence for the exact active lifecycle hand. It emits the existing one-time hand commit only after the merged state has terminal phase, a settlement patch has been observed for that hand, and the settlement remains present after sparse merge. No post-commit contribution upgrade was introduced. Exact lifecycle identity, stable player ID attachment, reducer semantics, counters, persistence, and UI remain unchanged.

`showdownPostBreakLifecycle.production.test.js` exercises active play, a verified heads-up break, stable-player return, and the first and second resumed showdown through the real content path. I1-I10 cover rejoin-before-start, immediate start, late resume status, delayed authoritative identity, split settlement/terminal frames, duplicates, sparse player metadata, an open page throughout the break, reload during the break, and reload immediately after return. It also covers completed replay and reload after the first resumed showdown. One split-frame scenario deliberately uses distinct lifecycle and authoritative hand IDs.

## Bounded memory and duplicate protection

- contribution records: 50, FIFO eviction;
- reduction attempts: 100, FIFO eviction;
- player aggregates: 200, least-recently-observed eviction;
- exact hand identity aliases: 400, FIFO eviction;
- exact shadow association IDs and association records: 200, FIFO eviction.

Reload restoration seeds the bounded identity index from the existing finalized-hand identities. No new storage key or persistence pipeline is introduced. Tests can inspect the bounded reducer state through `inspect`; structured content-path logging remains off unless `globalThis.__PNHUD_SHOWDOWN_DEBUG__ === true`.

## Remaining work before production validation

- manually confirm the bounded complete-river-check-through membership rule against repeated fresh PokerNow games;
- capture explicit main/side pot ownership and eligibility;
- capture incremental/repeated settlement behavior across reload;
- capture explicit return/refund, rake, odd-chip, and multiple-board allocation;
- perform manual V1-V12 live validation before describing WTSD or W$SD as production-ready.
- perform the focused B1-B7 break/rejoin live retest before validating this corrected candidate.
