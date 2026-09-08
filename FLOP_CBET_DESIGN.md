# Flop CBet / Fold-to-Flop-CBet Design Checkpoint

> Current status — public 1.1.0: implemented and covered by automated behavioral tests. The original manual-validation statement below records private-development history and is not public evidence.

Historical status: production-validated. Supported authoritative counters render in the seat HUD and leaderboard with accessible detailed tooltips.

Historical validated build: `validated-flop-cbet-20260802-1752`.

## Decision rules

### Flop CBet opportunity

The opportunity belongs only to the last player who made a supported full preflop raise. It is counted when:

- the finalized ledger record contains complete, non-recovered, ordered history;
- the final preflop aggressor is supported by the ordered full-raise sequence;
- at least one opponent entered the flop;
- the hand is not an automatic runout;
- the aggressor was not already all-in;
- flop ordering is internally consistent; and
- action reaches the aggressor before any opposing flop bet or raise.

An unopened flop bet by that aggressor is a made CBet. A check is a supported missed CBet opportunity. An opposing bet before the aggressor acts is a donk bet: it produces no conventional CBet opportunity and is not a CBet.

An absent or unsafe decision is `null`, not `false`. Automatic runouts, a known all-in aggressor, no flop, and no opponent at the flop are supported no-opportunity cases.

### Fold-to-Flop-CBet opportunity

An opportunity belongs to each non-aggressor who:

- is a supported flop entrant;
- is not already all-in;
- faces the qualifying CBet without an intervening raise changing the price; and
- has a directly observed meaningful response.

Direct fold, call/partial call, and raise responses contribute one opportunity. A direct fold contributes one fold; a call or raise contributes zero folds. An all-in call or raise is retained as a response classification. Missing responses are `null`; a player already all-in contributes no opportunity.

## Existing ledger fields used

| Decision need | Semantic ledger field |
| --- | --- |
| Hand identity and deduplication | `handIdentity.handId`, `handIdentity.lifecycleHandId`, identity aliases |
| Complete trustworthy history | `provenance.historyComplete`, `provenance.recovered`, ledger ambiguities |
| Final preflop initiative | ordered `actions` on `preflop`, `isFullRaise`, and `preflopRoles.finalAggressor` |
| Flop participants | `streets.flop.entrants` |
| Flop action ordering | ordered `actions`, `streets.flop.firstActor`, `streets.flop.actionOrder` |
| First bet cross-check | `streets.flop.firstBettor` |
| All-in exclusion | player `allIn`, preflop action `isAllIn` |
| Automatic-runout exclusion | `automaticRunout.detected` |
| Side-pot uncertainty signal | preflop `isShortAllInRaise`, `settlement.sidePotStatus` |
| Debug evidence | action sequence/source sequence/confidence and finalization provenance |

## Information gaps

- The ledger does not expose the legal-action set at each decision.
- Stack-at-flop and side-pot eligibility are not modeled strongly enough to decide every short-all-in case.
- `allIn: null` means unknown, not false.
- Omitted action versus a decision that never arrived cannot always be distinguished.
- Recovered or incomplete history cannot safely establish exact flop ordering.

Consequently, short-all-in side-pot scenarios with unresolved eligibility and incomplete ordering remain unsupported rather than contributing zeroes.

## Contribution schema

Each version-1 contribution contains:

- `handIdentity`, source ledger version, reducer version, mode, provenance, and ambiguities;
- hand facts: final preflop aggressor, qualifying CBet, CBet action, and prior donk bettor;
- per-player integer fields: `flopCBetMade`, `flopCBetOpportunities`, `foldToFlopCBet`, and `foldToFlopCBetOpportunities`;
- per-player tri-state decisions, response/reason/evidence, `supported`, and `unsupportedReason`.

The reducer supports bounded, in-memory inspection, hand-identity deduplication, and statistic-specific attachment identities. Supported per-player contributions are annotated onto existing finalized live events and persist through the existing live-events storage path. Unsupported/null decisions annotate nothing and contribute no denominator. The shared statistic registry exposes `CB` and `FCB`; both visible surfaces consume those same authoritative counters.

## Production counters-and-persistence flow

The exercised order is:

1. Realistic Socket.IO registered/gC frames enter the existing content.js dispatch.
2. The existing sparse merge, lifecycle, and hand-finalization owners run unchanged.
3. PokerSemanticHandLedger.finalize produces a finalized record.
4. PokerFlopCBetOpportunityReducer.reduce derives one versioned per-hand contribution.
5. PokerStats.applyFlopCBetContribution matches explicit hand aliases and the exact stable player ID, then annotates at most one finalized event per supported player decision.
6. Existing hand-accounting persistence saves the annotated finalized events under the existing storage key.
7. PokerFlopCBetOpportunityReducer.attach retains a bounded shadow/audit link.
8. The existing disabled-by-default globalThis.__PNHUD_PREFLOP_DEBUG__ channel exposes structured test/development observations.
9. Shared registry definitions format compact seat/leaderboard percentages and provide detailed hover/focus tooltip models.

Ingestion uses explicit hand aliases in this exact order: lifecycleHandId, then authoritative handId. The target player must match event.playerId exactly. Seats, display names, timestamps, and fuzzy action shapes are never matching keys. Each annotated live event contains the four integer fields plus reducer-version, matched-hand, and statistic-specific contribution provenance. The bounded shadow attachment separately retains tri-state support metadata and evidence.

Reducer state is initialized from the existing finalized lifecycle hand IDs after reload, preventing completed hands from being reduced again. Per-hand aliases prevent duplicate reducer invocation in one runtime, and per-player reducer-version contribution IDs prevent duplicate authoritative ingestion. Per-hand maximum aggregation is an additional guard without adding an unbounded ledger.

The storage schema version remains 4. Older finalized events or aggregate records that lack the four fields normalize them to numeric zero, preserving their existing VPIP/PFR/AF/3B/F3B values without migration or session invalidation.

## Reload checkpoints

- **C12 — reload after preflop, before flop:** the existing active-hand recovery object carries a bounded versioned semantic observation snapshot. Exact restoration retains complete-history provenance; the eventual CBet and direct fold ingest and persist once.
- **C13 — reload after flop completion, before settlement:** the same snapshot preserves ordered preflop/flop evidence until settlement. Repeated settlement frames produce one reduction and one persisted contribution per player.
- **C14 — reload after completion:** existing finalized lifecycle identity and boundary ownership reject replay before semantic reduction, so persisted counter events remain byte-identical.

Generic active-hand recovery without the versioned semantic snapshot remains conservatively incomplete and therefore unsupported. This distinction is intentional.

## C1-C11 coverage

| Scenario | Expected isolated result |
| --- | --- |
| C1 | Opener CBet 1/1; caller folds to CBet 1/1 |
| C2 | Opener CBet 1/1; caller folds 0/1 with response `call` |
| C3 | Opener CBet 0/1 after checking back; no Fold-to-CBet opportunity |
| C4 | Donk bet recorded; no conventional CBet or Fold-to-CBet opportunity |
| C5 | Opener CBet 1/1; one defender 1/1 and the other 0/1 |
| C6 | 3-bettor is final aggressor and CBet 1/1; omitted defender response is unsupported |
| C7 | 4-bettor is final aggressor and CBet 1/1; omitted defender response is unsupported |
| C8 | Automatic runout produces no opportunities |
| C9 | Short-all-in side-pot eligibility remains unsupported |
| C10 | Live defender gets 0/1; already-all-in participant gets no opportunity |
| C11 | Incomplete/inconsistent ordering remains unsupported |

## Live browser validation

M1-M6 were manually tested in a real PokerNow browser session with no detected CB or FCB errors:

- **M1:** open, call, flop check, CBet, fold;
- **M2:** open, call, flop check, CBet, call;
- **M3:** open, call, flop check, check back;
- **M4:** open, call, caller donk-bets before the aggressor acts;
- **M5:** 3Bet pot, checks to the final preflop aggressor, CBet; and
- **M6:** reload after a completed CBet hand.

Seat HUD, leaderboard, and tooltip output appeared consistent. Reload restored totals without any detected duplicate contribution. Unsupported side-pot eligibility and incomplete ordering remain null and outside the visible denominators.
