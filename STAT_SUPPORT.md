# V1 statistic support

Normative release summary of the frozen implementation, not a new semantic specification. Opportunity statistics count only supported evidence. Unknown is not a failed opportunity; missing denominators can display an unavailable/zero-history placeholder rather than a meaningful 0%. Filters aggregate existing exact counters; they do not reinterpret actions.

| Stat | Opportunity / denominator | Result / numerator | Important boundaries |
| --- | --- | --- | --- |
| Hands | Unique finalized player-hand event identities | One accepted participation per hand, including a qualified walk | Unfinished hand excluded; no lifetime/backfilled count |
| VPIP | Counted hands minus qualified Big Blind walk exclusions | At least one voluntary preflop call, bet or raise | Forced blinds alone do not qualify; one result per hand |
| PFR | Same qualified preflop opportunity base | At least one preflop raise | One result per hand, not number of raises |
| AF | Supported observed postflop calls | Postflop bets + raises divided by calls | Not a percentage; checks/folds excluded; zero calls yields infinity if aggressive actions exist, otherwise zero |
| 3Bet | Observed decision facing a supported full opening raise, before a further raise, with proven capacity for a legal full re-raise | Supported full first re-raise | Includes qualifying squeezes; short non-full raises are not 3B; unknown fullness/capacity/reopening withheld |
| F3B | A qualifying opener or already-entered live participant directly responds to a full 3Bet | Direct fold; call/partial call/raise are non-fold responses | Not opener-only: qualifying callers in multiway/squeeze hands count; a prior 4Bet changes the price and removes the conventional opportunity; missing response withheld |
| CBet | Last supported full preflop raiser reaches an unopened flop decision with an opponent | Aggressor bets before any opposing bet/raise; checking is a missed opportunity | Flop-only; donk-before-aggressor, already-all-in aggressor and automatic runout are not conventional opportunities |
| FCB | Eligible non-aggressor faces that qualifying flop CBet and has an observed direct response | Fold; call/partial call/raise are non-fold responses | Intervening raises, all-in eligibility and missing decisions constrain support |
| WTSD | Complete supported non-recovered saw-flop participation, corroborated by flop entrants | Supported contested showdown membership | Observed postflop fold or fully proven terminal foldout contributes 0/1; board completion/award alone does not establish showdown |
| W$SD | Supported showdown membership with a supported monetary result | Positive proven contested gross award, including a supported split; complete zero award is a loss | Refunds/returns excluded; not net profit. Rich pot outcome can be unknown while aggregate binary award is supported |

The walk classifier is evidence-based, not a heuristic that equates every unraised hand with a walk. Basic Hands/VPIP/PFR/AF are computed from finalized events; the ledger reducers attach statistic-specific supported counters without replacing that existing ownership.

Reloaded exact semantic checkpoints can preserve complete evidence. Generic recovered/incomplete histories cannot establish missing opportunities. Stable player IDs and authoritative hand aliases bind reducer contributions; names, seats and DOM timestamps do not substitute for identity.

## Showdown and ambiguous settlement

Shown cards are not universally required. Production can prove mucked membership in the bounded complete river check-through case: all live river entrants explicitly check, all river actions are checks, history and terminal settlement are known. Other mucked/disconnected participation is not guessed.

The reducer has synthetic coverage for explicit pot/board identities and rich win/loss/tie/mixed outcomes. Current live normalization does not provide a general main/side-pot eligibility model, multiple-board identities, incremental settlements, rake/odd-chip allocation or complete explicit-return semantics. Atomic, consistent contested gross awards can still support binary W$SD. Do not describe all side pots as either universally supported or universally rejected.

## Code and evidence

- Core counts and formatting: `stats.js`, `walkDetection.js`, `overlayStats.js`.
- Preflop: `preflopOpportunityReducer.js`; [detailed historical design](STATISTICS_DESIGN.md).
- Flop: `flopCBetOpportunityReducer.js`; [CBet design](FLOP_CBET_DESIGN.md).
- Showdown: `showdownStatsReducer.js`, `semanticHandLedger.js`; [showdown design](SHOWDOWN_STATS_DESIGN.md).
- Per-hand explanations: `statExplanation.js`; authoritative reducers remain the source of truth.

The release freeze gate requires all 68 production hashes to match the signed-off V1.1 package baseline. V1.1 adds derived Career views and exact situation filtering without changing the established counter definitions.
