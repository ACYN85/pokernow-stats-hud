# Player Dashboard Phase 4A

> Historical design record. The dashboard is implemented in public 1.1.0; later phase documents and current source supersede early scope limits below.

Phase 4A adds the first player-facing dashboard. A seat overlay name opens a bounded floating panel using the seat's canonical stable player ID. The panel is independent of the live seat DOM after opening and keeps Session and Career as separate selectable data windows.

## Data ownership

- **Session:** `PokerStats.computePlayerStatsByIdentity(liveEvents, playerId, displayName)`, the same finalized-event source used by the live HUD. No dashboard-specific poker reducer exists.
- **Career:** asynchronous `careerIndexedService.careerStats(playerId)` and `careerLedgerInfo()` calls through the established service-worker boundary. The dashboard does not open IndexedDB.
- **Current profile:** the existing session-based profile shadow/presentation state. Display hysteresis and raw independent fit scores are preserved. Career selection does not classify career aggregates, and profile output is not persisted in career records.
- **Notes:** `playerNotesStore.js` stores a small schema-v1 mutable map in `chrome.storage.local`, keyed only by stable player ID. Notes are not career poker history and are not included in Career Backup v1.

The ten cards are Hands, VPIP, PFR, AF, 3Bet, F3B, CBet, FCB, WTSD, and W$SD. Percentage cards display exact numerator/denominator samples and use `---` for zero denominators. AF preserves finite, `0.0`, and infinity display behavior.

## Interaction boundary

Only `.pnhud-overlay-grip` can start a seat-overlay drag. The name is a keyboard-activatable button that routes by `data-pnhud-player-id`; names, seats, DOM identity, and table position never own dashboard identity. Existing manual offsets, collision layout, Combined/Stacked modes, clipping, profile hover, and stat tooltips retain their existing paths.

## Relational provenance audit

| Stat | Meaningful single-player relation? | Stable-ID provenance in schema 2 | Schema-1 history |
| --- | --- | --- | --- |
| Hands | No; participation is a hand/population fact | None | Not applicable |
| VPIP | No canonical single counterpart | None | Not applicable |
| PFR | No canonical single counterpart | None | Not applicable |
| AF | No; postflop action ratio is population/hand scoped | None | Not applicable |
| 3Bet | Yes, against the qualifying opener | `threeBetTargetPlayerId` | Unavailable |
| F3B | Yes, against the qualifying 3-bettor | `foldToThreeBetAggressorPlayerId` | Unavailable |
| CBet | Opponent context matters, but a multiway c-bet is not one opponent-specific result | `flopCBetOpponentPlayerIds` preserves the stable-ID opponent set; no single-target numerator is asserted | Unavailable |
| FCB | Yes, against the qualifying flop c-bettor | `foldToFlopCBetAggressorPlayerId` | Unavailable |
| WTSD | Usually a hand/population outcome, not a single-counterpart response | None | Not applicable |
| W$SD | Usually a hand/pot outcome; side pots, chops, refunds, and multiway membership prevent a simple single-opponent interpretation | None | Not applicable |

The reducers already retained `openRaiser`, `threeBettor`, `cBettor`, and semantic flop entrants while building a finalized contribution. Phase 4A carries only those stable IDs into immutable career record schema 2. It does not change an opportunity, numerator, denominator, or poker formula.

Record schema 1 remains accepted exactly as historical data with relational provenance unavailable. No old aggregate or display name is used to fabricate a counterpart. Career Backup format remains v1 and now accepts/restores supported record schemas 1 and 2; schema-2 relational fields are integrity-protected and round-trip unchanged. A future head-to-head UI must label its supported tracking boundary/sample rather than imply schema-1 coverage.

## Self-identity readiness

The current production state supplies stable IDs for tracked players and seat mappings, but the audited content/runtime path does not expose a reliable canonical assertion that one of those IDs belongs to the local user. Display name, seat, DOM ownership, and table-owner inference are not safe substitutes. Phase 4A therefore adds no `isSelf` guess and no Vs You UI. Phase 4B should first establish a verified PokerNow self-ID source, then aggregate only relation-supported schema-2 samples with explicit coverage.

## Deliberate scope limits

No trends, exploits, leak analysis, position splits, session history, graphing, career leaderboard, career profile recalculation, rich notes, or hand-history browser are implemented.
