# PokerNow HUD Statistics Expansion Design

> Current status — public 1.1.0: the bounded semantic ledger and finalized-record reducers are implemented and covered by automated behavioral tests. This document also retains historical rollout rationale; dated build labels and live-validation statements are development history, not evidence shipped in the public repository.

Design baseline build: `optimization-maintainability-20260727-0230`  
Historical validated build: `validated-flop-cbet-20260802-1752`

## 1. Scope

This document defines the evidence, semantics, architecture, persistence, rollout, and regression requirements for:

- 3Bet %
- Fold to 3Bet %
- Flop CBet %
- Fold to Flop CBet %
- WTSD %
- W$SD %

The design preserves the project's WebSocket-authoritative boundary. Diagnostic DOM data and Full Log output may help investigate payloads, but they must not create, repair, or mutate production statistic facts.

This document began as a pre-implementation audit and now records the implemented 3Bet/Fold-to-3Bet production contract alongside requirements for the remaining statistics. No later statistic is authorized by the completed preflop validation.

The public repository's deterministic protocol examples are documented in [`fixtures/capture-derived-preflop/README.md`](fixtures/capture-derived-preflop/README.md). Seven privacy-sanitized, de-identified, capture-derived behavioral fixtures cover heads-up fold/call responses, a multiway squeeze, a short non-full all-in, a 4Bet response, a full legal all-in 3Bet, and a limp-reraise. Fixture aliases and cards are synthetic; the event shapes are capture-derived.

### Established external semantics

Where trackers differ, this project uses explicit, versioned conventions. The starting point is the [PokerTracker statistical reference](https://www.pokertracker.com/guides/PT3/general/statistical-reference-guide), which defines 3Bet as re-raising a raiser when given the opportunity, WTSD as reaching showdown after seeing the flop, and W$SD as winning money at showdown. The production Fold-to-3Bet reducer is player-specific: every player who voluntarily entered before the qualifying full 3Bet, remained live, and made an observed direct response contributes once. A later action after an intervening 4Bet does not rewrite or create that response. PokerTracker also treats a split-pot award as a showdown win. Its [Fold to Flop CBet definition](https://www.pokertracker.com/videos/PT4/leaktracker/leaktracker-fold-to-flop-cbet) identifies the qualifying bettor as the last preflop raiser.

## 2. Current Statistics Architecture Summary

### Current authority and flow

The current production path is:

1. The page-world WebSocket relay receives PokerNow traffic.
2. `content.js` decodes transport and Socket.IO records and finds game-state contributions.
3. `PokerTbTrace` merges `gC` state into the current table snapshot.
4. `PokerLiveActionPipeline` normalizes `tB`, current actor, current required investment, stacks, blinds, board/street, hand participants, and settlement data.
5. `PokerActionInference` creates action candidates. Commitment changes are confirmed by later stack, pot, actor, or required-investment evidence before being emitted.
6. `content.js` fingerprints and deduplicates accepted hand events.
7. `PokerHandFinalization` stages events under an active hand and commits them exactly once at a recognized hand boundary.
8. `PokerSemanticHandLedger` observes selected merged-state fields and emits a bounded normalized shadow record only when that existing commit boundary is accepted.
9. `PokerPreflopOpportunityReducer` consumes only that newly finalized record, keeps bounded inspection totals, and returns per-hand 3Bet/Fold-to-3Bet contributions.
10. `content.js` attaches supported contributions exactly once to the matching finalized lifecycle event; `PokerStats.computePlayerStats` derives Hands, VPIP, PFR, AF, 3Bet, and Fold-to-3Bet from that authoritative event path.
11. The active hand, finalized events (including the four preflop counters), hand IDs, fingerprints, and host-control state are persisted under live schema version 4; semantic ledger records and reducer inspection history are not persisted.
12. The compact HUD, seat overlays, and leaderboard project the same computed registry values.

Full Log and runtime diagnostics observe this path but are not statistic authorities.

### Existing finalized statistics-event contract

The current finalized records contain a deliberately small event vocabulary:

- `handId`
- `playerId` when it survives the source path
- `player`
- `action`
- `street`
- `amount`
- `timestamp`
- optional blind/evidence/fingerprint metadata

Current actions include fold, check, call, bet, raise, blind, and dealt. This is sufficient for the existing aggregate definitions because they ask whether a player participated, voluntarily invested preflop, raised preflop, or made postflop bets/raises/calls/folds.

The legacy statistics-event contract is intentionally unchanged and is not sufficient by itself to reconstruct legal betting state or a contested showdown. It does not guarantee:

- a stable action sequence number;
- amount-to-call and amount-to after every action;
- full raise versus short all-in raise;
- whether action was reopened;
- the first and last qualifying preflop aggressor;
- the first flop bettor;
- whether a player was all-in at a decision point;
- explicit street-entry participants;
- showdown participants, including mucked hands;
- pot-award ownership, side-pot identity, split-pot handling, or uncalled-bet refunds;
- an authoritative complete/aborted classification for every terminal path.

The separate schema-version-1 semantic shadow record supplies supported ordered actions, roles, street entry, bounded visible showdown, awards/chops, supported refunds, and explicit ambiguity without replacing the event contract. The version-1 preflop reducer consumes only finalized records; supported integer numerator/denominator contributions are attached to finalized events for existing stats persistence and HUD rendering. See [SEMANTIC_HAND_LEDGER.md](SEMANTIC_HAND_LEDGER.md).

### Audited end-to-end finalized hand

The captured two-player test fixture was traced through the production path. It produces:

- a preflop raise and call;
- a flop bet and call;
- turn check/check;
- river check, bet, and call;
- settlement;
- one exactly-once finalized hand;
- persisted finalized events;
- recomputed existing statistics.

This confirms the ordering and commit boundaries of the current architecture. It does not prove legal raise classification, showdown membership, or award allocation because the fixture does not contain those authoritative facts.

## 3. Definitions

| Statistic | Human-readable meaning | Denominator | Numerator | Maximum contribution |
| --- | --- | --- | --- | --- |
| 3Bet % | How often a player makes the first full preflop re-raise when legally able to do so | Qualifying opportunities to make the first full preflop re-raise | Opportunities resolved by making that qualifying 3Bet | One opportunity and one success per player per hand |
| Fold to 3Bet % | How often a player folds when a qualifying first preflop re-raise reaches the player | Qualifying decisions directly facing the first full preflop 3Bet | Those decisions resolved by folding | One opportunity and one fold per player per hand |
| Flop CBet % | How often the last full preflop aggressor follows through by betting an unopened flop | Qualifying unopened-flop decisions by the last full preflop aggressor | Those decisions resolved by betting | One opportunity and one success per player per hand |
| Fold to Flop CBet % | How often an opponent folds when directly facing a valid flop continuation bet | Qualifying opponent decisions directly facing a valid flop CBet | Those decisions resolved by folding | One opportunity and one fold per player per hand |
| WTSD % | How often a player who saw the flop reaches a contested showdown | Hands in which the player saw the flop | Those hands in which the player reached a contested showdown | One saw-flop denominator and one showdown numerator per player per hand |
| W$SD % | How often a player receives part of a showdown pot after reaching showdown | Hands in which the player reached a contested showdown | Those showdowns in which the player received a positive showdown-pot award | One showdown denominator and one win numerator per player per hand |

All percentages are `numerator / denominator * 100`. A zero denominator displays the project's established unavailable value rather than `0%`, because no opportunity is not the same as an unsuccessful opportunity.

### Per-stat metadata, finality, and current support

| Statistic | Required hand/player metadata | Result becomes final | Current support and ambiguity |
| --- | --- | --- | --- |
| 3Bet % | Complete ordered preflop ledger; forced-bet classification; player identity; commitments; amount faced; full-raise, all-in, and reopening state | Opportunity resolves on action; delta commits only at complete finalization | Production and live-validated across A1–A7 plus real-session opportunity, made, declined, 4Bet, and ordinary-open cases. A4 remains void where reopening is unsupported |
| Fold to 3Bet % | Same ledger plus player-specific direct decision ownership after the qualifying 3Bet | Fold/call/4Bet resolves one opportunity for each previously entered live player; commit waits for finalization | Heads-up/opener paths are live-validated; multiway squeeze ownership is regression-validated. Intervening 4Bets stop unresolved responses and A4 remains null/void |
| Flop CBet % | Final full preflop aggressor; flop entrants; unopened/action order; active/all-in state; first flop bet | Bet/check resolves opportunity; commit waits for finalization | Production and live-validated for supported first-action, checked-to, check-back, donk-exclusion, and 3Bet-pot paths; unsupported eligibility remains void |
| Fold to Flop CBet % | Valid CBet fact; each opponent's active/all-in state; exact direct-response order and amount faced | Each direct fold/call/raise resolves independently; commit waits for finalization | Production and live-validated for direct fold/call responses, with reload restoration and duplicate suppression; unsupported responses remain void |
| WTSD % | Saw-flop list; terminal completion kind; authoritative showdown participants including bounded mucked players | At authoritative terminal settlement/finality | A3 supports normal all-revealed showdown; A4 supports two pre-runout all-in reveals and automatic board completion; a complete checked-through river plus retained settlement supports unshown membership; other muck, abortion, and durable ownership cases remain blocked |
| W$SD % | WTSD metadata plus contested gross award ownership, pot identity, refunds, splits, and board index | After complete terminal awards | A3 and A4 support even single-pot split/chop results; side pots, refunds, rake, odd chips, multiple boards, and persistence remain blocked |

## 4. Numerator and Denominator Rules

### 4.1 3Bet %

#### Qualifying opening raise

The opening raise is the first voluntary, qualifying full preflop raise above the current forced-bet level. Calls or limps may precede it. Therefore, an isolation raise after one or more limps is still the opening raise for this statistic.

Forced posts do not create a 3Bet sequence. Blinds, antes, straddles, dead blinds, and missed-blind posts must be normalized as forced bets before this calculation is enabled. If a forced contribution cannot be classified safely, the new-stat facts for that hand are void.

#### Opportunity

A player receives a 3Bet opportunity when:

- a qualifying opening raise has occurred;
- no qualifying 3Bet has occurred yet;
- ordered action reaches that player;
- the player has not folded or gone all-in;
- a legal full re-raise is available;
- the observation is complete enough to distinguish that decision from a forced or short all-in action.

This includes:

- a cold player acting behind the opener;
- a limper to whom action returns;
- a caller only if action returns before another player has already made the qualifying 3Bet;
- a back-raise or limp-reraise situation when the legal sequence supports it.

The original raiser does not receive a 3Bet opportunity when later facing a 3Bet; a further raise by the opener is a 4Bet.

#### Success and failure

- Success: the player makes the first qualifying full preflop re-raise.
- Failure: the player folds, calls, or otherwise completes the opportunity without making that 3Bet.
- Void: the action, all-in amount, legal minimum, action reopening, or sequence is ambiguous.

A short all-in increase that does not meet the legal full-raise threshold is not a 3Bet for this statistic and does not reopen action. This requires explicit or safely derived betting legality; a generic `raise` label is insufficient.

### 4.2 Fold to 3Bet %

#### Opportunity

A player receives an opportunity when ordered action reaches the player while directly facing the first qualifying full preflop 3Bet and the player has a legal fold/call/raise decision.

Following the chosen tracker convention, the player's prior action does not restrict eligibility. The denominator can include:

- the original raiser facing a 3Bet;
- a caller facing a squeeze;
- a limper facing a 3Bet;
- another player who previously invested and now directly faces that 3Bet.

A player does not receive an opportunity merely because a 3Bet exists somewhere in the hand. The decision must reach that player while the amount being faced is still the qualifying 3Bet. If an intervening 4Bet changes the amount before the player acts, that later decision is not a Fold to 3Bet opportunity.

#### Success and failure

- Success: an explicit fold while directly facing the qualifying 3Bet.
- Failure: call, all-in call, or legal raise/4Bet.
- Void: inferred inactivity without an action, a missing decision, an ambiguous short all-in, or an incomplete sequence.

A known timeout or disconnect does not change the poker outcome: an explicit fold still counts. A player merely becoming inactive, disappearing, or disconnecting without an authoritative fold does not count.

### 4.3 Flop CBet %

#### Preflop aggressor

The preflop aggressor is the player who made the last qualifying full preflop raise. This may be the opener, 3Bettor, 4Bettor, or later legal full raiser. A short non-reopening all-in increase does not take over aggressor ownership.

#### Opportunity

The preflop aggressor receives a Flop CBet opportunity when:

- an authoritative flop transition exists;
- the aggressor reached the flop, remains active, and is not already all-in;
- ordered flop action reaches the aggressor;
- no opponent has bet or raised the flop;
- the hand and action prefix are complete.

Checks before the aggressor do not remove the opportunity. An opponent's bet before the aggressor acts is a donk bet and removes the CBet opportunity. Multiway and heads-up pots use the same one-opportunity-per-aggressor rule.

#### Success and failure

- Success: the aggressor bets into the unopened flop.
- Failure: the aggressor explicitly checks when given the qualifying opportunity.
- No opportunity: the aggressor was all-in before the flop, folded before the flop, or faced a donk bet.
- Void: the flop action prefix is incomplete or the aggressor's decision is not observed.

A checked-through flop counts as a missed CBet only when the aggressor's check is explicitly observed. A delayed turn bet is out of scope.

### 4.4 Fold to Flop CBet %

#### Opportunity

Each active opponent receives one opportunity when:

- a valid Flop CBet has just occurred;
- ordered action reaches that opponent;
- the opponent directly faces the unchanged CBet amount;
- the opponent has a legal fold/call/raise decision.

Players are counted separately in multiway pots. A player who checked before the CBet can still receive an opportunity if action returns to that player while the player directly faces the CBet.

If an intervening opponent raises, players who act later face the raise rather than the original CBet and do not receive a Fold to Flop CBet opportunity from that later decision.

#### Success and failure

- Success: an explicit fold directly to the CBet.
- Failure: call, all-in call, or raise.
- Void: missing ordered action, ambiguous inactivity, or an incomplete hand.

Overcalls are ordinary failures for each qualifying player. A donk-bet pot cannot produce a CBet or a Fold to CBet opportunity.

### 4.5 WTSD %

#### Saw flop denominator

A dealt-in player saw the flop when an authoritative flop transition occurs and that player had not folded before the transition. An all-in player who remains entitled to a pot sees the flop. Merely being dealt cards is not sufficient.

#### Reached showdown numerator

A player reached showdown when:

- the player saw the flop;
- the player remained non-folded through the last betting decision relevant to a pot;
- the terminal facts prove that at least two live hands reached a contested showdown for that pot.

Hole cards need not be shown. A mucked losing hand still counts when authoritative terminal participation proves it reached showdown. An all-in player counts when the board is run out and the player's hand remains eligible for a contested pot.

Board completion alone is not proof of showdown. An uncontested river winner, a player who folded on the river, and an aborted hand do not count. Run-it-twice must count once per hand, not once per board.

### 4.6 W$SD %

#### Showdown denominator

The denominator is the same `reachedShowdown` fact used as the WTSD numerator.

#### Won at showdown numerator

A player won at showdown when the player receives a positive gross award from any contested showdown pot in that hand.

- A split or tied pot counts as one win, not half a win.
- Winning any main-pot or side-pot share counts as one win for the hand.
- Winning a side pot while losing the main pot still counts.
- Net profit is irrelevant; the award may be smaller than the player's total investment.
- An uncalled-bet refund is not a showdown-pot award.
- Shown cards are not required when authoritative award ownership and showdown participation are known.
- For run-it-twice, any positive aggregate showdown award counts as one win for the hand.

No fractional numerators are stored.

## 5. Opportunity Lifecycle

All four opportunity-based statistics should use the same state shape while retaining separate pure reducers:

```js
{
  handId,
  playerId,
  statId,
  opportunityId,
  openedSequence,
  status: "open" | "success" | "failure" | "void",
  resolvedSequence,
  reason,
  evidenceVersion
}
```

Rules:

1. Open an opportunity only when all prerequisites are known.
2. Resolve it exactly once from the first qualifying response.
3. Never turn missing evidence into a failure.
4. Mark unresolved opportunities `void` if the hand becomes incomplete or ambiguous.
5. Commit only `success` and `failure` records from a complete finalized hand.
6. Persist open opportunities with the active hand so reload recovery can resume without double counting.
7. Use stable keys derived from `handId`, `playerId`, `statId`, and the semantic decision point.

The per-player finalized delta should contain integer counters, not precomputed percentages:

```js
{
  handId,
  playerId,
  evidenceVersion,
  threeBetMade,
  threeBetOpportunities,
  foldedToThreeBet,
  foldToThreeBetOpportunities,
  flopCBetMade,
  flopCBetOpportunities,
  foldedToFlopCBet,
  foldToFlopCBetOpportunities,
  sawFlop,
  reachedShowdown,
  wonAtShowdown
}
```

## 6. Edge-Case Decisions

| Scenario | Required result |
| --- | --- |
| Limp, raise, limper re-raises fully | Limper has a 3Bet opportunity; full re-raise is a 3Bet |
| Raise, caller, squeeze | Squeezer succeeds at 3Bet; opener and caller each get Fold to 3Bet opportunities only when their decisions reach them |
| Cold 3Bet | Count as 3Bet |
| Short all-in increase below a full raise | Do not call it a 3Bet; do not treat action as reopened |
| Full all-in re-raise | Count when legal full-raise threshold is proved |
| Straddle/dead/missed blind not normalized | Void new-stat facts for the hand |
| Preflop aggressor all-in before flop | No Flop CBet opportunity |
| Checks to preflop aggressor | CBet opportunity remains |
| Donk bet before preflop aggressor | No CBet opportunity |
| Multiway CBet | One CBet opportunity; independent Fold to CBet decisions for direct responders |
| CBet, fold, call | First responder success; second responder failure |
| CBet, raise, later fold | Later player faced the raise, not the original CBet; no Fold to CBet opportunity for that later decision |
| Checked-through flop | CBet failure only if aggressor's check was observed |
| Player all-in preflop and sees board | Counts as saw flop |
| River fold before comparison | Saw flop, but did not reach showdown |
| Uncontested river winner | Did not reach contested showdown |
| Mucked loser at proved showdown | Counts WTSD; does not count W$SD |
| Split pot | Every showdown participant with a positive pot award counts as W$SD success |
| Side-pot winner loses main pot | Counts as W$SD success |
| Only uncalled chips returned | Not a W$SD success |
| Run-it-twice | One WTSD and W$SD result per player per hand |
| Explicit timeout/disconnect fold | Treat as fold if exact action and decision context are authoritative |
| Inactive/disconnected without fold action | Void the affected opportunity |
| Reload during an open opportunity | Resume from persisted fact ledger; do not reopen or double count |
| Aborted/incomplete hand | Commit no new-stat delta |

## 7. Data-Readiness Matrix

Classification terms remain: authoritative/reliable, available but inferred, diagnostic-only, missing, and ambiguous/unsafe.

| Required signal | Current classification | Evidence and limitation |
|---|---|---|
| Hand identity and boundary | Authoritative raw across reconnect and many new-hand boundaries; not normalized/persisted by production | A2→A3 and A3→A4 continuity plus A4 target/next `hI`; reload exactly-once still untested |
| Board/street transition | Authoritative for normal and automatic runouts | A3 ordered betting/check runout; A4 no-action automatic flop/turn/river after reveal |
| Dealt-in / saw-street participants | Authoritative for captured A3/A4 three-player paths | A4 preserves the folded cold caller separately from two all-in showdown participants; muck variants remain open |
| Ordered preflop actions | Authoritative for A1–A4 captured paths | A4 preserves open, cold call, short all-in, returned opener call, then cold-caller fold; no durable production ledger |
| Ordered postflop actions | Authoritative for A2/A3; zero-action runout proven A4 | A4 transitions the board without actor/action events after both live hands reveal |
| Initial/final preflop aggressor | Authoritative for captured normal paths; bounded short-all-in distinction in A4 | A4 retains opener as last qualifying full aggressor and separately records short-all-in actor |
| Full raise versus short all-in | Normal full raises supported; A4 short classification strongly supported | Prior high 200, all-in to 250, prior full increase 180, retained minimum 380, direct `pGS=allIn`; no explicit full-raise flag |
| Action reopening | Missing/unsafe | A4 proves returned action but exposes no understood legal/available-action set; opener call cannot prove raise unavailable |
| Amount faced / responder role | Authoritative for captured ordinary/A4 decisions; not retained in production | A4 response order and 50 extra call are proven; legality remains separate |
| All-in state | Authoritative for A4 captured player/action | Direct `pGS.P2=allIn`; universal state transitions still need contrasting cases |
| Minimum raise calculation | Strongly supported, scenario-bounded | A4 retains `mR=380` around a 250 all-in; omission in shove patch is not a new declaration |
| First flop bettor / unopened state | Authoritative for A2/A3 normal paths | A4 aggressor is all-in and has no CBet opportunity |
| Flop CBet opportunity and numerator | Authoritative for captured normal paths | Donk/intervening raise and durable ownership remain open |
| Fold to Flop CBet responses | Authoritative for A2/A3 normal paths | Raise/all-in/intervening-action cases remain open |
| Explicit checks / checked-through street | Authoritative for A3 | Incoming `tB=check`, actor assignment, cycle, and transition prove closure |
| Showdown participants | Authoritative for A3 all-terminal-revealed and A4 pre-runout-revealed paths | Muck representation remains missing |
| Shown versus mucked | Shown proven; bounded check-through muck supported | Absence of shown cards remains unsafe unless every live river entrant explicitly checked and complete terminal settlement is retained |
| Settlement winner identity / gross awards | Authoritative for A1–A4 captured paths | A4 result keys own 350/350 awards; side-pot ownership remains missing |
| Split-pot outcome | Authoritative for two even single-pot splits/chops | A3 330/330; A4 350/350; odd-chip and side-pot cases not observed |
| Main/side-pot identity | Missing | No side-pot structure or distinct main/side winners |
| Uncalled-bet refund | Accounting effect supported A1/A2; explicit representation missing | No named refund field/frame |
| Complete versus aborted hand | Normal fold, revealed showdown, and A4 automatic all-in completion authoritative; abortion unsafe | Timeout/cancel variants missing |
| Full Log DOM/text evidence | Diagnostic-only | It must never mutate production statistics |

## 8. Missing Signals and Capture Requirements

A1–A4 establish normal heads-up and multiway full-raise responses, first-action and checked-to CBets, ordered checks, a normal revealed showdown, direct all-in status, strongly supported short-increase sizing, returned action, automatic runout, two even single-pot splits/chops, exact A4 settlement, and repeated hand boundaries. Production implementation must still pause until real, redacted fixtures establish:

1. Explicit legal/available-action state for short-all-in reopening, or an equivalently unambiguous raw contract.
2. A full all-in raise meeting/exceeding the minimum that reopens action and creates main/side pots.
3. Actual reload/recovery using raw `hI` with exactly-once open-opportunity resumption.
4. A 4Bet response path.
5. A limp-reraise/back-raise.
6. A donk-bet flop.
7. A CBet response containing a raise or all-in.
8. A showdown with a mucked eligible participant.
9. Explicit refund/rake/odd-chip behavior.
10. Multiple boards/run-it-twice when supported.
11. Timeout/disconnect and aborted/cancelled hands.

For each fixture, continue documenting event order, snapshot/event ownership, full-versus-short raise legality, amount form, showdown membership, award ownership, and the exact finality boundary. Diagnostic capture may collect evidence but may not own finished statistic facts.

## 9. Recommended Architecture

### Shared prerequisite foundation

Do not begin by adding `3Bet` branches to `stats.js`. First add an additive, versioned per-hand fact model in shadow mode:

```text
WebSocket snapshots/events
        |
        v
normalized ordered hand facts
        |
        +--> legal preflop reducer
        +--> flop initiative reducer
        +--> showdown/award reducer
        |
        v
per-player finalized integer deltas
        |
        v
existing statistics projection and HUD registry
```

The fact model should include:

- stable `sequence` and source-record identity;
- `playerId`, street, action, and source timestamp;
- prior commitment, added amount, amount-to, highest amount before/after, and amount faced;
- `fullRaise`, `reopensAction`, and `allIn`, each with explicit evidence;
- dealt-in and street-entry participant snapshots;
- board/street transitions;
- terminal completion kind;
- showdown participants, revealed/mucked state when available;
- an award ledger with player, amount, pot identity/type, and board index;
- evidence/confidence and a reason whenever a fact is void.

Schema version 1 of this model is now exercised by isolated A1–A4 synthetic replay tests and the independently implemented production contract in [SEMANTIC_HAND_LEDGER.md](SEMANTIC_HAND_LEDGER.md). The replay stores no runtime or persistent state. A4 directly proves all-in state and strongly supports one short/non-full raise, but reopening/legal-action fields remain null; side-pot/muck/refund limitations remain explicit. This completion does not authorize Batch 1.

### Reducer ownership

Use one shared fact contract, not one monolithic statistic algorithm:

- `PreflopOpportunityReducer`: opening raise, 3Bet, Fold to 3Bet.
- `FlopInitiativeReducer`: last preflop aggressor, CBet, Fold to CBet.
- `ShowdownReducer`: saw flop and reached showdown.
- `AwardReducer`: positive showdown-pot awards and W$SD.

Reducers should be pure and deterministic. They receive a finalized fact ledger and return per-hand opportunity/result records or a specific void reason. They must not inspect the DOM, storage, HUD, Full Log, or mutable runtime globals.

### Integration point

Derive and commit new-stat deltas only inside the existing exactly-once hand finalization boundary. Rendering must remain downstream:

1. finalize the existing hand;
2. validate fact completeness;
3. derive new-stat deltas;
4. commit deltas idempotently;
5. aggregate counters;
6. expose display values through the existing stat catalog;
7. let compact HUD, overlays, and leaderboard consume that catalog.

New display fields should not be registered until their calculators and persistence are verified. Hidden shadow facts are preferable to an early user-visible number.

## 10. Persistence and Migration

Do not replace or reinterpret live schema version 4 and do not erase existing Hands, VPIP, PFR, or Aggression Factor data.

Use a separate additive versioned store, for example:

```js
{
  schemaVersion: 1,
  evidenceVersion: 1,
  activeHands: {
    [handId]: {
      facts: [],
      opportunities: []
    }
  },
  finalizedDeltas: {
    [handId]: {
      [playerId]: { /* integer deltas */ }
    }
  }
}
```

Requirements:

- Existing schema-4 storage remains readable and behaviorally unchanged.
- Absence of the new store means “no new-stat history,” not corruption.
- Migration creates an empty additive store; it must not synthesize historical opportunities from legacy generic events.
- Active facts persist after each accepted authoritative record, using the existing write-serialization discipline.
- Finalized deltas are keyed by hand and player and committed atomically/idempotently.
- Reload recovery restores open opportunities and action sequence without duplicating records.
- A new evidence-version calculation never silently mixes with an older semantic definition. Recompute only when the persisted raw facts are compatible; otherwise begin the new version from zero with an explicit boundary.
- Reset/export behavior must identify the new store explicitly.
- Size limits and compaction should retain finalized integer deltas longer than raw fact ledgers.

## 11. Implementation Batches and Risk

### Batch 0 — Evidence fixtures and contracts

Risk: low production risk; medium investigation risk.

- A1–A4 authoritative imports are complete, including A4 short-all-in sizing/status and automatic chopped runout.
- Continue capturing the blockers in Section 8, beginning with the contrasting full all-in reopen/side-pot path and explicit legal-action state.
- Record exact field semantics/finality and add fixture-only regressions.

### Batch 0.5 — Test-only fact-schema prototype

Status: **complete as an isolated development prototype**. Risk remains low because it is unreachable from runtime and persistence.

- [x] Define versioned fixture-replay facts for ordered actions, roles, streets, CBet responses, revealed showdown membership, single-pot awards, and per-player opportunity records.
- [x] Consume only authoritative A1–A4 fixtures in development tests and compare all four to checked-in golden derivatives.
- [x] Preserve ordered raw patches and fully merged states, explicit `hI` boundaries, sparse omissions, and outgoing-request/confirmation ownership.
- [x] Assert no manifest registration, production import, browser global, persistence, HUD, lifecycle, or current-statistic dependency.
- [x] Represent A4 all-in/short-raise sizing directly while keeping reopening/legal-action facts and affected preflop opportunity results null; treat muck, side-pot, explicit-refund, and reload cases as controlled ambiguities.

See the synthetic replay tests for fixture-oracle coverage and [SEMANTIC_HAND_LEDGER.md](SEMANTIC_HAND_LEDGER.md) for the independently implemented production contract. Batch 1 is complete as a bounded, non-persisted shadow layer.

### Batch 1 — Production shadow fact ledger

Status: **complete as a bounded, non-persisted production shadow layer**.

- [x] Normalize supported ordered actions, raise/all-in metadata, street entry, terminal kind, visible showdown, awards, chops, and supported refunds.
- [x] Preserve true/false/null and explicit ambiguity rather than guessing unsupported reopening or settlement.
- [x] Finalize only at the existing accepted production hand boundary and deduplicate with existing lifecycle identities across restore/replay.
- [x] Compare A1–A4 through a limited shared semantic contract.
- [x] Prove no mutation to current lifecycle, Hands, VPIP, PFR, AF, runtime labels, rendering, or storage.
- [x] Keep inspection in a bounded in-memory diagnostics buffer.

Persistence was deliberately excluded from this phase and remains a separate future design.

### Batch 2 — 3Bet and Fold to 3Bet

Status: **complete and live-validated in production**.

- [x] Implement the supported finalized-record-only preflop reducer.
- [x] Keep A4 and unsupported reopening cases void/unknown.
- [x] Attach integer contributions exactly once to authoritative finalized events.
- [x] Persist and restore the four counters through the existing session-statistics path.
- [x] Render `3B` and `F3B` with unavailable output for zero denominators.
- [x] Validate A1–A7, lifecycle/reload neutrality, and duplicate suppression automatically.
- [x] Complete real-session manual validation, including reload persistence and no observed duplicate accumulation.

### Batch 3 — Flop CBet and Fold to Flop CBet

Status: **complete and live-validated in production**.

- [x] Implement the finalized-record flop opportunity reducer.
- [x] Integrate authoritative counters through existing persistence and restoration.
- [x] Render compact CB/FCB values and detailed accessible tooltips.
- [x] Validate C1–C14 and production-path duplicate/reload behavior automatically.
- [x] Complete real-session M1–M6 validation, including donk exclusion and 3Bet-pot ownership.

### Batch 4 — Showdown and award normalization

Risk: high.

- Normalize showdown participants, muck status, gross awards, pots, splits, refunds, side pots, and multiple boards.
- A3 supports the normal all-revealed single-pot split path only.

### Batch 5 — WTSD

Risk: medium after Batch 4.

- Implement saw-flop and reached-showdown reducers.
- Do not infer universal showdown membership from board completion or showing cards alone.

### Batch 6 — W$SD

Risk: high and last.

- Implement only after side pots, muck membership, refunds, rake, and any supported multiple-board allocation are verified.

Each batch is independently reviewable and must preserve the verified Pause/Resume lifecycle, hand finalization, current statistics, diagnostics boundaries, and package order.

## 12. Regression Matrix

### Shared authority, lifecycle, and persistence

- [ ] Only WebSocket-derived facts affect production counters.
- [ ] Full Log, runtime diagnostics, and DOM mutations cannot create or change a fact.
- [ ] One source record produces at most one normalized action.
- [ ] Duplicate snapshots do not duplicate facts, opportunities, or deltas.
- [ ] Simultaneous ambiguous commitment changes produce an explicit void reason.
- [ ] Active facts survive reload and resume at the correct sequence.
- [ ] A finalized hand commits new-stat deltas exactly once.
- [ ] An aborted/incomplete hand commits no new-stat delta.
- [ ] Cold-start mid-hand observation does not invent earlier opportunities.
- [ ] Current Hands, VPIP, PFR, AF, and walk results remain byte-for-byte equivalent for existing fixtures.
- [ ] A Big Blind walk produces no voluntary action or new-stat opportunity.
- [ ] Runtime status, Pause/Resume, epoch, lifecycle, and statistics reset behavior remain unchanged.
- [ ] Legacy schema-4 state loads without loss when the additive store is absent.

### 3Bet

- [x] Open raise followed by fold/call decisions creates correct opportunities.
- [x] Open raise, 3Bet, fold creates the correct 3Bet and Fold to 3Bet results.
- [x] Open raise, 3Bet, call creates the correct 3Bet and Fold to 3Bet results.
- [x] Open raise, 3Bet, 4Bet creates the correct 3Bet and non-fold results.
- [x] Open raise followed by a full re-raise creates one 3Bet success.
- [x] Cold 3Bet counts.
- [x] Isolation raise after limpers is treated as the opening raise.
- [x] Limp-reraise/back-raise counts when action legally reopens.
- [x] Raise plus callers still gives an unacted player a 3Bet opportunity.
- [x] Original raiser facing a 3Bet does not receive a second 3Bet opportunity.
- [x] Short all-in non-reopening increase is not a 3Bet.
- [x] Full all-in re-raise is a 3Bet.
- [x] A multiway preflop pot opens and resolves each decision exactly once.
- [ ] Unknown straddle/dead/missed-blind semantics void the hand's new-stat facts.

### Fold to 3Bet

- [x] Original raiser folding directly to a 3Bet counts.
- [x] Original raiser calling or 4Betting is a denominator-only result.
- [x] Previously entered cold callers receive one Fold-to-3Bet opportunity when their direct fold/call/raise response to a qualifying squeeze is observed.
- [x] Players acting only after an intervening 4Bet do not receive a response to the original 3Bet.
- [x] A later fold by the 3-bettor after an opener 4Bet is not misattributed to the opener.
- [x] A player whose turn is bypassed by an intervening 4Bet is not counted as facing the original 3Bet.
- [ ] Explicit timeout/disconnect fold counts.
- [ ] Inactive/disconnected state without a fold action is void.

### Flop CBet

- [ ] Last full preflop raiser owns initiative.
- [ ] A short non-reopening all-in does not take initiative.
- [ ] Checks before the aggressor preserve the opportunity.
- [ ] Aggressor bet into an unopened flop counts.
- [ ] Aggressor check is a denominator-only result.
- [ ] Donk bet removes the opportunity.
- [ ] Preflop all-in aggressor has no opportunity.
- [ ] Heads-up and multiway hands each create only one aggressor opportunity.
- [ ] Delayed turn bet does not count as a Flop CBet.
- [ ] A hand that never reaches the flop creates no flop-stat opportunity.

### Fold to Flop CBet

- [ ] Each direct multiway responder gets an independent opportunity.
- [ ] Fold directly to CBet counts.
- [ ] Call, overcall, all-in call, or raise is denominator-only.
- [ ] A player who checked before the CBet can be counted when action returns.
- [ ] A player facing an intervening raise is not counted as folding to the original CBet.
- [ ] Donk-bet hands produce no Fold to CBet opportunities.

### WTSD

- [ ] A non-folded dealt-in player at the flop transition counts as seeing the flop.
- [ ] A preflop folder does not see the flop.
- [ ] A preflop all-in player that reaches the board sees the flop.
- [ ] A river folder does not reach showdown.
- [ ] An uncontested river winner does not reach showdown.
- [ ] A shown winner and shown loser both reach showdown.
- [x] A proved mucked loser reaches showdown in the bounded complete-river-check-through case.
- [ ] Board completion without participant proof does not imply showdown.
- [ ] Run-it-twice counts once per player per hand.

### W$SD

- [ ] Heads-up sole showdown-pot winner counts.
- [ ] Multiway sole showdown-pot winner counts.
- [ ] Every tied player with a positive split award counts.
- [ ] Side-pot winner counts even when losing the main pot.
- [ ] Showdown loser does not count.
- [ ] Positive net stack movement without a proved award does not count.
- [ ] Uncalled-bet refund does not count.
- [ ] Mucked winner with an authoritative award counts.
- [ ] Multiple-board awards aggregate to one per-hand result.

### Display and packaging

- [x] Zero denominators display the established unavailable value.
- [x] Seat overlay and leaderboard read the same stat registry values.
- [x] Persisted counters render identically after reload.
- [x] Package validation includes every new production module in dependency order.
- [x] Diagnostics-disabled mode remains behaviorally inert.

## 13. Risks and Deferred Decisions

### Blocking risks

- **Legal raise semantics:** Current `raise` inference cannot distinguish a full raise from a short all-in increase or prove that action reopened.
- **Terminal completeness:** A boundary is not always equivalent to a safely classified complete statistical hand.
- **Showdown membership:** Revealed cards alone omit mucked hands; board completion alone includes uncontested hands. The supported non-reveal alternative requires a complete explicit river check-through by all live entrants plus retained terminal settlement.
- **Award semantics:** `position`, `gained`, winner flags, stack deltas, pot awards, and refunds are not interchangeable.
- **Identity continuity:** Every fact must retain stable `playerId`; display names are not safe keys.
- **Recovery:** Replaying inferred actions after reload can silently duplicate opportunities without stable source identity and sequence.

### Explicitly deferred

- Turn and river CBet statistics.
- 4Bet, Fold to 4Bet, squeeze, and donk-bet display statistics.
- Fractional W$SD credit.
- Historical backfill from legacy finalized events.
- DOM or Full Log fallback calculation.
- An assumption that all PokerNow table variants share one settlement schema.

### Go/no-go gate

3Bet, the previously validated heads-up/opener Fold-to-3Bet paths, Flop CBet, and Fold-to-Flop-CBet passed this gate through authoritative fixtures or bounded semantic evidence, production-path regressions, persistence/package validation, and live manual PokerNow testing. Corrected multiway Fold-to-3Bet ownership remains a candidate pending targeted live revalidation.

Every future statistic remains blocked until:

1. its required rows in the readiness matrix are authoritative and reliable;
2. real fixtures cover its blocking edge cases;
3. the shadow fact ledger survives reload and exactly-once finalization;
4. ambiguity produces a void record rather than a guessed failure;
5. all current lifecycle and statistics suites remain unchanged;
6. additive persistence and package validation pass.

Until those gates pass for a remaining statistic, the correct visible state is “not implemented,” not an approximate percentage.
