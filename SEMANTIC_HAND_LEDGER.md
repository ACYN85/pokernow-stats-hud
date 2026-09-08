# Production Semantic Hand Ledger

> Current status — public 1.1.0: implemented and covered by automated behavioral tests. The build label below is retained only as private-development chronology.

Historical status: production shadow ledger in build `validated-flop-cbet-20260802-1752`; its 3Bet/Fold-to-3Bet and Flop CBet/Fold-to-Flop-CBet consumers were validated during development.

## Purpose and scope

`semanticHandLedger.js` converts the existing production runtime's merged live-hand state into one bounded, normalized record after the existing hand finalizer accepts a completion boundary. It is the semantic source for validated production 3Bet/Fold-to-3Bet contributions and future statistics; the ledger itself does not render UI.

The ledger does not replace or mutate Hands, VPIP, PFR, AF, Big Blind walk handling, lifecycle state, runtime badges, HUD rendering, gameplay, or storage. It does not read the DOM, intercept WebSockets, or import the fixture-only CommonJS extractor.

## Production flow

`websocketHook.js` relays the authoritative frames as before. `content.js` decodes and merges them as before, resolves hand ownership and boundaries, and gives the selected merged state and sparse patch to `PokerSemanticHandLedger.observe`. The ledger never owns transport parsing or lifecycle classification.

Both supported completion paths continue to converge on `PokerHandFinalization.commitHand`:

- a verified settlement/game-result patch; or
- a distinct next-hand boundary that commits the prior active hand.

Only the accepted result in `applyHandCommitResult` may call `PokerSemanticHandLedger.finalize`. A lifecycle discard calls `discard` and emits no semantic record.

## Finalized record contract

Every record has `schemaVersion: 1`, `mode: "production_shadow"`, and these top-level groups:

- `handIdentity`: authoritative `hI` when available, the existing lifecycle hand ID, game number, and observed previous/next identities.
- `players`: stable IDs, seats, blind roles, starting/ending stacks, fold/all-in state, saw-flop state, showdown state, and award total.
- `actions`: ordered forced and voluntary actions with street, player, amount-to/by, commitment context, minimum-raise context, all-in/full-raise/short-all-in tri-state facts, and bounded evidence references.
- `streets`: board, entrants, first actor, ordered actors, first bettor, checks before the first bet, and bounded sequence references.
- `preflopRoles`: blinds/dealer, opener, normal 3-bettor, normal squeezer, callers/cold callers, short-all-in raiser, final qualifying full aggressor, and last aggressive actor.
- `automaticRunout`: tri-state detection, all-in/reveal/street sequences, and postflop action count.
- `showdown`: tri-state detection and bounded visible-reveal participants/winners/losers.
- `settlement`: known or unresolved status, positive award events, totals, chop/uncontested tri-state facts, nullable side-pot status, terminal stacks, supported inferred refunds, and per-player reconciliation.
- `ambiguities`: explicit codes and bounded evidence for unsupported or partial interpretations.
- `provenance`: source, accepted finalization reason, timestamps/sequences, observation count, recovery/completeness flags, event names, and evidence-field names.

Boolean semantic fields use `true`, `false`, or `null`. `null` means the captured evidence does not support either boolean result. In particular, A4's short all-in is not a full raise, while action reopening remains `null`.

## Finalization and deduplication

The existing lifecycle hand ID is the deduplication key because it is already authoritative for production commit ownership and reload continuity. Existing persisted `finalizedHandIds` seed the shadow ledger on startup. A repeated observation or finalization for a seeded/finalized identity is recorded as a bounded duplicate attempt and cannot append another record.

The record keeps raw `hI` separately as its preferred semantic identity. This avoids replacing the existing lifecycle owner while preserving the PokerNow identity needed by future consumers.

A terminal phase plus object-valued `gameResult` evidence observed and retained for the same active hand produces supported settlement facts. PokerNow may split settlement, terminal phase, and reveals across sparse patches; `finalizationReadiness` holds the settlement provisionally until the merged hand reaches terminal phase. A distinct next-hand boundary may still finalize a record without complete settlement; in that case settlement, showdown, awards, and other unsupported facts stay unresolved or `null`. Recovered history and observation truncation are explicit ambiguities. Unowned/stale recovered hands are discarded without a fabricated record.

## Observability and bounds

Copy Diagnostics includes `semanticHandLedger` inspection output. The API also exposes defensive-copy inspection for tests. Optional preflop handoff tracing uses `globalThis.__PNHUD_PREFLOP_DEBUG__`; it remains disabled by default, so normal production use produces no preflop debug trace.

Default bounds are:

- 50 finalized records;
- 240 merged-state observations per active hand; and
- 100 finalization-attempt entries.

Only selected semantic fields are retained. Full raw frames, DOM text, fixture payloads, and unbounded merged snapshots are not stored. Finalized identity deduplication follows the existing session identity set and is intentionally independent of the record-retention bound.

## Verified fixture coverage

- A1: open, normal 3Bet, fold, uncontested award, and supported implicit refund.
- A2: open, normal 3Bet, call, flop CBet, fold, uncontested award, and supported implicit refund.
- A3: multiway cold call/squeeze, postflop action order, revealed showdown, and 330/330 chop.
- A4: short non-full all-in below retained `mR=380`, reopening unknown, action-free automatic runout, revealed showdown, and 350/350 chop.
- A5: open, 3Bet, opener 4Bet jam, and later 3-bettor fold without Fold-to-3Bet misattribution.
- A6: full legal all-in 3Bet, opener call, and automatic runout/showdown.
- A7: limp, first full raise, limper 3Bet, and original raiser fold.

## Live production validation

The deterministic fixtures cover supported 3Bet opportunities, made 3Bets, call/fold declines, opener folds, flat-calls facing a 3Bet, 4Bet responses, and ordinary-open flat/fold actions without false Fold-to-3Bet attribution. Signed-in PokerNow validation remains a separate release activity; no live session evidence is stored in this public copy.

## Known limitations

Full-raise classification now carries the last proven full raise size forward through ordered preflop actions. A numeric PokerNow `mR` remains authoritative when present; when it disappears after deeper aggression, the next minimum full raise-to is derived from the current high commitment plus the prior full-raise increment. A short/non-full all-in never advances that increment or replaces the final qualifying aggressor. Legal reopening and unresolved side-pot action remain unsupported when the retained evidence cannot prove them.

The ledger recognizes unshown/mucked showdown members only from bounded terminal evidence: complete river check-through, a terminal river call, a visible comparison with other non-folding terminal live players, or an action-free completed-board all-in runout, always with complete history and retained contested settlement. A terminal foldout with one live player remains uncontested. Abort/disconnect/incomplete histories, contradictory award recipients, complete side-pot ownership, run-it-twice/multiple-board allocation, fractional awards, rake, odd-chip rules, and general explicit refunds remain unsupported. `potId` and `boardIndex` remain nullable extension points. Records are an in-memory diagnostic shadow buffer; no new all-time or lifetime persistence exists.

The validated production 3Bet/Fold-to-3Bet reducer consumes a separately versioned projection from finalized records and retains the existing null/unsupported rules. Future consumers must likewise avoid active ledger state and may not bypass the accepted production hand-completion boundary.
