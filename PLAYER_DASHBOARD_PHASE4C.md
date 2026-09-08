# Player Dashboard Phase 4C: Position and opponent-context UI

> Historical design record. These controls are implemented in public 1.1.0; dated candidate labels below describe development chronology.

Build `candidate-dashboard-position-vs-you-ui-20260812-2355` exposes the certified Phase 4B dimensions in the existing bounded Player Dashboard. It changes presentation and query orchestration only; no poker reducer, position resolver, career schema, self identity, relational provenance, profile classifier, or notes contract changed.

## Controls and layout

The Session/Career selector remains first. A compact Position dropdown beside it defaults to All positions and exposes only the canonical labels: BTN, CO, HJ, LJ, UTG, UTG+1, UTG+2, SB, and BB.

The statistics are deliberately split:

- Core stats: Hands, VPIP, PFR, AF, CBet, WTSD, and W$SD.
- Relational stats: 3Bet, F3B, and FCB, with Overall, Vs You, and Vs Everyone Else controls.

Opponent context never applies visually or computationally to the core section. Position applies to both sections, so Position=SB plus Opponent=Vs You displays SB-filtered core statistics and SB 3Bet/F3B/FCB against the canonical self ID.

## Identity and self dashboards

Vs You and Vs Everyone Else are disabled until authenticated `registered.currentPlayer.id` is available. Display names, DOM placement, and seats are never identity inputs. On the user's own dashboard, Vs You is disabled as nonsensical self-vs-self; Overall and Vs Everyone Else remain available.

## Coverage and unavailable samples

The core section states total hands, position-tracked hands, and the selected position's tracked sample using the Phase 4B coverage response. A selected position with no tracked hands gets an explicit empty state. Relational cards always display exact numerator/denominator and use `---` when the denominator is zero. Missing historical position or counterpart provenance remains excluded.

## Query and state ownership

Session filters call `sessionStatsFiltered()`. Career filters call the service-worker `careerStatsFiltered()` API. Career requests capture player ID, data mode, position, opponent mode, and request token; a response is accepted only if every field still matches. Position and opponent context do not reset one another.

Filters are dashboard-local and reset to All/Overall when another player is opened. The existing current profile is not recalculated from filters. Notes remain keyed only by stable player ID and retain draft state across filter rerenders.

No trends, exploit recommendations, leak detection, graphs, heatmaps, or session-history browser were added.
