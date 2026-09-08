# Player Profile Classifier Design

> Current status — public 1.1.0: the classifier, presentation, dashboard integration, and explainability surfaces are implemented. Profiles remain Session-derived and non-persistent. This document retains the earlier shadow-candidate rationale as historical design context.

Historical initial status: production shadow candidate. The classifier and its bounded store load only in the isolated content-script world.

This is an interpretable heuristic classifier. It summarizes observed poker behavior under an explicit model; it is not a claim about a person's identity, skill, intent, or immutable playing style. Profiles can change as the sample changes.

## Architecture and contract

`playerProfileClassifier.js` is a pure UMD/CommonJS module. `classify(authoritativePlayerStats, options)` consumes the numeric result already produced by `PokerStats.computePlayerStats`. It never parses HUD strings, reads the DOM, observes WebSockets, writes storage, or changes its input.

`playerProfileShadowStore.js` owns the production observation layer. `content.js` refreshes it after a finalized hand has received all supported reducer contributions, after authoritative live-event restoration/change, and when a stable player ID is first mapped or renamed. UI renderers never invoke the classifier.

`playerProfilePresentation.js` is a separate pure, deterministic presentation policy. It consumes detached raw classifier records and its previous presentation state, then returns a JSON-safe shadow decision. The shadow store keeps that decision in a separate bounded map. It never mutates the raw classifier record, persists a label, or supplies the current HUD, leaderboard, popup, settings, or tooltips.

The JSON-safe schema-version-3 result contains:

- `primary`: displayed archetype or unknown state, best candidate, runner-up, confidence, score margin, every archetype score, and supported/unsupported evidence;
- `tags`: independently supported behavioral tags with their raw rate, stabilized rate, opportunities, threshold, and confidence;
- `features`: raw counts, denominators, raw/stabilized rates, priors, confidence, and support state;
- `support`: hands plus supported and unsupported feature lists;
- `provenance`: deterministic classifier version and the effective priors.

`Infinity`, `NaN`, functions, DOM objects, and cyclic values never enter the result. A valid infinite AF is represented as `rawRate: null`, `rawValue: "infinity"`, and `isInfinite: true`.

## Authoritative inputs

| Feature | Numerator | Denominator/source |
| --- | ---: | ---: |
| Hands | `handsPlayed` | Finalized unique hands |
| VPIP | `vpipHands` | `vpipOpportunities` |
| PFR | `pfrHands` | `pfrOpportunities` |
| Aggression | `afDetails.bets + afDetails.raises` | `afDetails.calls`; frequency uses all three actions |
| 3Bet | `threeBetMade` | `threeBetOpportunities` |
| Fold to 3Bet | `foldToThreeBet` | `foldToThreeBetOpportunities` |
| Flop CBet | `flopCBetMade` | `flopCBetOpportunities` |
| Fold to Flop CBet | `foldToFlopCBet` | `foldToFlopCBetOpportunities` |
| WTSD | `wentToShowdown` | `sawFlopForWTSD` |
| W$SD | `wonMoneyAtShowdown` | `showdownsForWSD` |

The classifier does not consume the rounded HUD fields `vpip`, `pfr`, or `af`. It recomputes features from authoritative counts.

## Stabilization and confidence

Each binomial rate uses a configurable Beta-prior mean expressed as equivalent prior observations:

`stabilizedRate = (numerator + priorMean × priorStrength) / (opportunities + priorStrength)`

`confidence = opportunities / (opportunities + priorStrength)`

The raw observed rate remains `numerator / opportunities`. With zero opportunities the raw rate is `null`, the stabilized value equals the prior mean, confidence is zero, and the feature is unsupported. Thus an unavailable feature cannot masquerade as 0%.

Default priors are provisional population assumptions, not learned PokerNow population facts:

| Feature | Mean | Strength | Minimum opportunities | Minimum confidence |
| --- | ---: | ---: | ---: | ---: |
| VPIP | 28% | 24 | 20 | 0.40 |
| PFR | 20% | 24 | 20 | 0.40 |
| 3Bet | 8% | 30 | 12 | 0.30 |
| Fold to 3Bet | 50% | 20 | 12 | 0.35 |
| Flop CBet | 55% | 20 | 12 | 0.35 |
| Fold to Flop CBet | 45% | 20 | 12 | 0.35 |
| WTSD | 28% | 24 | 15 | 0.35 |
| W$SD | 50% | 20 | 12 | 0.35 |
| Aggressive-action frequency | 60% | 12 | 12 | 0.40 |

Both minimum conditions apply. They are feature-specific: 200 hands do not make one Fold-to-3Bet opportunity reliable. Overrides are copied and validated; invalid means, strengths, thresholds, or opportunity counts fall back to safe values.

### Derived features

- `vpipPfrGap`: VPIP minus PFR, using both raw and stabilized component rates;
- `pfrVpipRatio`: PFR divided by VPIP, guarded against zero and contradictory PFR-above-VPIP data;
- `aggressionFrequency`: `(bets + raises) / (bets + raises + calls)`, stabilized as a binomial rate;
- `aggressionFactor`: `(bets + raises) / calls`, plus a stabilized ratio converted from stabilized aggression frequency.

The gap and ratio use the lower confidence and opportunity support of VPIP/PFR. Unsupported or contradictory components keep them unsupported.

## Primary archetype scoring

Candidates are Nit, TAG, LAG, Tight Passive, Loose Passive, Calling Station, and Maniac. Each candidate defines a short list of weighted triangular membership curves. A curve has a low endpoint, an ideal target, and a high endpoint: membership rises linearly from zero to one and then falls linearly to zero. Unsupported features contribute nothing.

For each archetype:

`score = Σ(weight × featureConfidence × membership) / Σ(weight × featureConfidence)`

The configuration emphasizes:

| Archetype | Strongest supported signals |
| --- | --- |
| Nit | Very low VPIP/PFR, small gap, restrained participation |
| TAG | Moderate VPIP/PFR, high PFR/VPIP ratio, small gap, meaningful aggression |
| LAG | Elevated VPIP/PFR, high ratio, aggression, supported elevated 3Bet |
| Tight Passive | Tight VPIP, low PFR, larger gap, low aggression |
| Loose Passive | Loose VPIP, insufficient raising relative to VPIP, a large gap, and low-to-moderate aggression; no high-WTSD requirement |
| Calling Station | Loose/passive core plus supported, positively matching stickiness evidence from low FCB or high WTSD |
| Maniac | Extreme VPIP/PFR, high ratio, extreme aggression, supported elevated 3Bet |

W$SD is deliberately absent from every primary score. A short winning or losing run cannot redefine a fundamentally TAG/LAG profile. Situational features have bounded weights and never replace supported VPIP/PFR core evidence.

Calling Station has an additional semantic-eligibility rule: at least one supported `foldToFlopCBetRate` or `wtsdRate` observation must have positive membership in its smooth Calling Station curve. Unsupported priors are not observations, and a supported selective/high-fold value does not qualify merely because a denominator exists. The score diagnostics retain the unadjusted score, supported requirement features, positive features, and exclusion reason. Low Fold-to-3Bet and aggressive-action frequency remain useful scored evidence after eligibility is established, but neither can independently create the specialized label.

`callShare = calls / (bets + raises + calls)` was audited and deliberately not added: with the existing authoritative aggression counts it is exactly `1 - aggressionFrequency`. Adding both would double-count the same decisions under different names.

### Archetype overlap audit

| Pair | Primary distinction | Intentional overlap and calibration decision |
| --- | --- | --- |
| Loose Passive / Calling Station | Calling Station additionally needs demonstrated postflop stickiness or showdown frequency | Their loose preflop region intentionally overlaps. Calling Station preflop weights were reduced and FCB/WTSD weights doubled; semantic eligibility prevents missing evidence from being replaced by priors. |
| LAG / Loose Passive | PFR/VPIP ratio, aggression frequency, and 3Bet separate aggressive from passive looseness | Moderate-loose boundary overlap is intentional and remains subject to the 0.08 margin gate. No curve changed. |
| TAG / LAG | VPIP/PFR ranges define tight versus loose aggression | The boundary is intentionally uncertain; P13 remains the explicit regression. No curve changed. |
| Tight Passive / Nit | VPIP-PFR gap, ratio, and aggression distinguish passive entry from simply tight play | Low participation overlap is intentional. No curve changed. |
| LAG / Maniac | Extreme VPIP/PFR, aggression, and supported 3Bet distinguish Maniac | The upper LAG/lower Maniac transition remains smooth; mature controls retain a wide margin. No curve changed. |

VPIP, PFR, their gap, and their ratio are correlated. They remain interpretable components because they express participation, raising volume, and relative raising tendency, but their combined weight must not erase orthogonal evidence. This pass changes that balance only for Calling Station, where the defect was demonstrated; the other archetypes are fundamentally preflop-style categories and retained their existing curves and weights.

Primary classification requires at least 20 hands plus supported, internally consistent VPIP and PFR. The result is ambiguous when the best score is below 0.42 or the best/runner-up margin is below 0.08.

### Defining VPIP compatibility

Positive weighted memberships alone are insufficient to reject a semantic contradiction. Every primary archetype therefore requires positive membership in its own existing `vpipRate` curve before its unadjusted weighted score can become its final score. Unsupported VPIP evidence remains neutral and the ordinary insufficient-sample gate still owns that case; supported VPIP with zero archetype membership is explicit contradictory evidence and makes that archetype ineligible.

This is a defining-feature floor, not a new percentage cutoff. Nit, TAG, LAG, Tight Passive, Loose Passive, Calling Station, and Maniac reuse their existing smooth VPIP curves. Their weights, targets, and tails are unchanged. Calling Station additionally retains its existing requirement for supported positive FCB or WTSD stickiness evidence. The 0.42 global score gate and 0.08 margin gate are unchanged.

The real R7 defect demonstrates why this is necessary. At stabilized VPIP/PFR 0.6224/0.0943, Nit previously received 2.3602 weighted points from PFR and 0.6587 from aggression. Its defining VPIP, gap, and ratio memberships were each zero, but the positive-membership average still produced 3.0189 / 8.4636 = 0.3567. Loose Passive received a slightly larger 3.0931 numerator, but its 10.5701 denominator plus partial VPIP/PFR/ratio/aggression membership and a zero membership for the 0.5281 gap produced 0.2926. The absence of a defining VPIP constraint—not unsupported evidence or triple correlated Nit credit—allowed Nit to lead.

After compatibility, R7 keeps Nit's 0.3567 as an interpretable `unadjustedScore` but assigns a final Nit score of zero with `contradictoryFeatures: ["vpipRate"]`. Loose Passive leads at 0.2926. The result remains `Unknown / Uncertain` because it still fails the unchanged 0.42 score gate.

Primary confidence is deterministic:

`45% × bestScore + 35% × coreConfidence + 20% × min(1, margin / 0.25)`

Insufficient results are capped below 0.40; ambiguous results are capped below 0.60. The best candidate and all scores remain visible for debugging even when `archetype` is `Unknown / Insufficient Sample` or `Unknown / Uncertain`.

## Secondary behavioral tags

Tags require their feature's independent opportunity and confidence gate. Thresholds apply to the stabilized rate:

| Tag | Rule |
| --- | --- |
| 3B Heavy / 3B Light | 3Bet at least 12% / at most 5.5% |
| Folds to 3B / Sticky vs 3B | F3B at least 62% / at most 38% |
| High CBet / Low CBet | CBet at least 65% / at most 42% |
| Sticky vs CBet / Fit-or-Fold | FCB at most 34% / at least 58% |
| Showdown Heavy / Showdown Selective | WTSD at least 34% / at most 22% |
| High W$SD / Low W$SD | W$SD at least 58% / at most 42% |

No opposite pair can both match. A tag includes the feature, raw rate, stabilized rate, opportunities, confidence, direction, and threshold.

## Synthetic profile matrix

| ID | Expected result |
| --- | --- |
| P1 | Clear Nit |
| P2 | Clear TAG |
| P3 | Clear LAG |
| P4 | Tight Passive |
| P5 | Loose Passive |
| P6 | Calling Station |
| P7 | Maniac |
| P8 | Unknown / Insufficient Sample |
| P9 | Raw 2/2 3Bet is shrunk and issues no 3B Heavy tag |
| P10 | 40/80 3Bet produces strong 3B Heavy evidence |
| P11 | 200 hands with one F3B opportunity issues no F3B tag |
| P12 | Tiny WTSD denominator issues no Showdown Heavy tag |
| P13 | Close TAG/LAG scores return Unknown / Uncertain |
| P14 | Supported 0% 3Bet is real evidence and can produce 3B Light |
| P15 | Zero 3Bet denominator remains unsupported, not 0% |
| P16 | Calling Station supported by loose/passive core, high WTSD, and low FCB |
| P17 | LAG with 3/3 W$SD remains LAG and receives no W$SD tag |
| P18 | Extreme, sufficiently supported Maniac |

## Semantic contradiction calibration

| ID | Shape | Result |
| --- | --- | --- |
| R7 | Real-shaped 62% VPIP / 9% PFR ultra-loose passive contradiction | Unknown / Uncertain; Loose Passive leads; Nit and Tight Passive excluded |
| R8 | 15% VPIP / 11% PFR true tight control | Nit |
| R9 | 22% VPIP / 11% PFR passive tight control | Tight Passive |
| R10 | 52% VPIP / 13% PFR passive loose control | Loose Passive |
| R11 | 43% VPIP / 32% PFR aggressive loose control | LAG |

R1-R2 are unchanged. R3 remains Maniac but its final margin becomes 0.8148 because incompatible LAG evidence is excluded. R4 remains Loose Passive with LAG as runner-up and a 0.5632 margin. R5 remains Unknown with Loose Passive leading, Maniac second, and a 0.2246 margin. R6 remains Unknown with LAG leading, Loose Passive second, and a 0.2470 margin. These are intentional diagnostic/ranking changes; no global gate changed.

The synthetic P1-P18 primary labels and D1-D8 displayed transitions remain unchanged. D7's early raw LAG/Maniac margins increase because semantically incompatible candidates no longer dilute them, but the unchanged presentation policy still produces `hidden -> LAG`. D8 remains immediately visible Maniac.

## Limitations and future calibration

- Priors, endpoints, weights, and thresholds are expert-readable starting assumptions, not validated PokerNow population percentiles.
- Table size, stake, game format, session context, and changing play over time are not modeled.
- The output describes observed tendencies, not causality, intent, skill, or identity.
- Confidence is opportunity support, not a frequentist confidence interval or prediction guarantee.
- No temporal decay, opponent adjustment, clustering, machine learning, or population learning is implemented.

The configuration boundary allows future replacement of fixed priors and triangular endpoints with PokerNow population means, standard deviations, and percentiles. That later calibration can preserve this output contract and explanation model without changing authoritative statistics.

## Visible seat-HUD candidate

Build `candidate-player-profile-visible-hud-20260809-2302` adds the first normal-user presentation. The compact primary-archetype chip appears inside the existing seat HUD, before its statistic rows, and consumes only the stable player ID's `displayedProfile`. A chip is emitted only when `displayedProfile.visible === true` and its archetype is one of the seven supported primary labels. Unknown, insufficient, unsupported, raw candidates, confidence, scores, hysteresis details, effective table size, and secondary tags remain absent from normal UI.

The versioned `hudUiPreferences` object owns a default-on `showPlayerProfiles` preference. Toggling it changes only seat-HUD presentation; shadow classification and presentation updates continue. Chip changes participate in the existing stable-player overlay reconciliation key, so seat moves retain the correct chip, replacement players cannot inherit a prior occupant's chip, and unchanged displayed states do not rerender. Updates remain downstream of the finalized-hand profile refresh.

The chip uses readable text plus a subdued archetype-specific border/background. The existing single delegated tooltip owner and viewport placement helper provide hover and keyboard-focus descriptions without internal classifier metrics. The chip remains within the overlay's measured bounds, collision placement, z-index, and native-panel SVG clipping path. This integration is candidate-quality until a real PokerNow session validates seat turnover, long labels, combined/stacked layouts, the visibility toggle, and partial clipping.

## Shadow presentation policy

Five interpretable policies were evaluated against the clean real-session boundary shapes and synthetic controls: minimum-hands gating alone, stronger early gates alone, hysteresis alone, existing-label hold alone, and a combined policy. Minimum hands or early gates do not address mature TAG/Nit/Tight-Passive uncertainty. Hysteresis without sample gates can expose tiny-sample aggressive labels. An unbounded label hold can freeze a stale archetype. The combined policy was selected because it reduces visible crossings while retaining explicit upper bounds on stale labels and genuine style changes.

Exact default rules:

- fewer than 40 hands: hidden;
- 40-79 standard archetypes: score at least 0.50, margin at least 0.12, confidence at least 0.60, then three matching updates spanning at least four hands;
- 80+ standard archetypes: three matching updates spanning at least four hands;
- a mature strong initial label can reveal immediately at 80+ hands when score is at least 0.60, margin at least 0.18, and confidence at least 0.70;
- LAG is hidden before 60 hands; from 60-79 it requires score 0.58, margin 0.16, confidence 0.65, and four updates spanning eight hands; at 80+ it requires three updates spanning five hands;
- Maniac is hidden before 100 hands and normally requires five updates spanning ten hands; a mature strong Maniac with score 0.70, margin 0.25, and confidence 0.75 can reveal immediately;
- a supported replacement normally requires four updates spanning eight hands; LAG below 120 hands requires five updates spanning ten hands; Maniac requires five updates spanning twelve hands; a strong mature replacement requires two updates spanning three hands;
- raw Unknown temporarily holds an established visible label, but four Unknown updates spanning six hands or twelve total disagreement hands hides it;
- continuous supported disagreement is capped at 20 hands, and a candidate spanning 20 hands may satisfy persistence even when updates are sparse;
- insufficient-sample and unsupported raw states hide immediately.

The shadow status and reason fields distinguish hidden insufficient/unsupported/uncertain states, pending initial reveal, stable display, temporary uncertainty hold, ineligible candidates, and pending replacement. The raw archetype, raw status, hand count, best candidate, score, margin, and confidence remain present beside the display decision; the policy never claims that held presentation is the current raw classification.

Sanitized D1-D8 results:

| Fixture | Raw transitions | Shadow displayed transitions |
| --- | --- | --- |
| D1 stable Loose Passive, 42-67 hands | Loose Passive | hidden -> Loose Passive |
| D2 strong TAG, 89 hands | TAG | TAG |
| D3 TAG/Tight-Passive boundary, 105-132 | Unknown <-> TAG | hidden |
| D4 established TAG/Nit boundary, 106-123 | TAG <-> Unknown | TAG |
| D5 Tight-Passive boundary, 82-103 | Tight Passive <-> Unknown | hidden -> Tight Passive |
| D6 genuine style shift | TAG -> Loose Passive | TAG -> Loose Passive |
| D7 synthetic T5 | LAG -> Maniac -> LAG | hidden -> LAG |
| D8 mature R3 | Maniac | Maniac |

The real-shaped D3 case remains neutral/hidden rather than flickering, so no visible boundary flicker remains in D1-D8. Sustained Unknown and continuous disagreement have separate regressions proving that an old label cannot remain indefinitely.

The current authoritative statistics path cannot identify bomb pots exactly. The available game-type/phase field is used for street and lifecycle interpretation, but no captured, proven bomb-pot marker is propagated into finalized live events or profile statistics. Bomb-pot hands therefore remain indistinguishable within current profile inputs. This is documented as a separate limitation; the table-size fact may still be recorded when reliable and no speculative bomb-pot exclusion is applied.

## Table-size context candidate

Primary profiling uses the number of players actually dealt into each finalized hand, never nominal seat capacity. `content.js` starts from PokerNow's exact `iHPI` collection and corroborates participation with forced blinds, hole-card entries, verified actors, and explicit active-in-hand status. `PokerHandFinalization` excludes players known only from the seated roster and stamps its final corroborated participant count onto every finalized event as `playersDealtCount`, version 1, source `finalized-hand-participants`.

For each player, `PokerStats` derives these additive, session-scoped counters from the existing persisted finalized events:

- `preflopTableSizeSum`: sum of exact dealt-player counts for supported VPIP/PFR opportunities;
- `preflopTableSizeOpportunities`: number of those opportunities carrying the exact versioned fact;
- `effectiveTableSize = preflopTableSizeSum / preflopTableSizeOpportunities` only when every current VPIP/PFR opportunity has the fact.

Verified Big Blind walks follow the existing per-player opportunity exclusion. Mixed table sizes are naturally opportunity-weighted, and a player joining later receives context only from that player's own hands. No recent window is added: the cumulative opportunity weighting already limits a one-hand arrival/departure to one observation and stays exactly rebuildable across reload and reset.

The classifier keeps one shared archetype configuration and linearly shifts primary membership curves between the 9-handed reference and 3-handed minimum. With `s = clamp((9 - effectiveTableSize) / 6, 0, 1)`, the curve-point shifts are:

- VPIP: `+0.10 * s`;
- PFR: `+0.10 * s`;
- VPIP-PFR gap: `+0.01 * s`;
- 3Bet: `+0.03 * s`.

Each shift applies equally to the factor's low, target, and high points, clamped to `[0, 1]`. PFR/VPIP ratio, aggression frequency, AF, F3B, CBet, FCB, WTSD, and W$SD are not adjusted. Secondary-tag thresholds remain absolute, including 3Bet tags. Debug score decomposition reports the reference curve, shifted curve, exact shift, effective table size, opportunity coverage, and unsupported reason.

This curve-shift approach was chosen over normalizing observed rates because it preserves raw/stabilized statistics in diagnostics; over an independent table-size feature because a separate score cannot change what 20% VPIP means; and over format-specific configs because duplicated 3-max/6-max/9-max thresholds create discontinuities and maintenance drift.

Historical rows without the explicit versioned finalized participant fact are not reconstructed from seat capacity or guessed from visible/event actors. They retain the prior absolute classifier behavior and report table context unsupported. Exact current-format histories rebuild context from persisted events. A fully supported heads-up average returns `Unknown / Unsupported` because the current multiway vocabulary and calibration are not claimed to be meaningful heads-up. Presentation hysteresis is unchanged and consumes the contextual raw profile through its existing contract.

Read-only isolated-world inspection adds:

```js
globalThis.PokerNowHUDProfiles.displayedProfile(playerId)
globalThis.PokerNowHUDProfiles.allDisplayedProfiles()
globalThis.PokerNowHUDProfiles.scoreDecomposition(playerId)
globalThis.PokerNowHUDProfiles.exportLiveProfileValidation()
```

Each live-validation player now includes `displayedProfile`. This state is in memory only, is bounded with the same 200-player ownership/eviction lifecycle, and is absent from every visible renderer.

`scoreDecomposition(playerId)` is a detached, read-only diagnostic. For each archetype it reports every supported feature's stabilized value, confidence, configured weight, membership, effective weight, weighted contribution, numerator sum, normalization denominator, unadjusted score, final score, and semantic compatibility evidence. It reconstructs only the already retained numeric classifier inputs, contains no player identity or raw poker payload, and performs no storage write.

## Production shadow store

- ownership: stable PokerNow `playerId`, never seat, display name, table order, or DOM location;
- source: current table-session `liveEvents` passed through `PokerStats.computePlayerStats`;
- capacity: 200 players, deterministic least-recently-updated eviction;
- history: at most 10 snapshots per player;
- recomputation: exact JSON signature of the 20 authoritative numeric counters; timestamps, seats, and names are excluded;
- transition capture: initial profile, primary/status change, tag-set change, or confidence movement of at least 0.05;
- restore: profile state is regenerated from restored authoritative events and mappings; profiles/history are never persisted;
- failure containment: malformed counters or classifier exceptions create `Unknown / Unsupported` diagnostic records without escaping into HUD rendering;
- logging: disabled unless `globalThis.__PNHUD_PROFILE_DEBUG__ === true`, and then emitted only for meaningful changes.

## Live shadow validation telemetry

The live-validation layer is diagnostic-only, in-memory, isolated-world data. It never changes classifier inputs or outputs, never writes a profile storage key, and never enters the HUD, leaderboard, popup, settings, or tooltips.

Per stable player ID it retains:

- at most 100 meaningful transition records, FIFO;
- at most 250 compact per-update samples, FIFO;
- exactly five possible first-at-or-after band snapshots for 20, 40, 80, 150, and 250 hands;
- cumulative interpretable counters for primary changes, supported-primary changes, Unknown/support transitions, tag changes, stable spans, and confidence extrema.

Each transition is JSON-safe and contains only the stable ID, hand count, classification fields, best score, margin, confidence, tag names, supported stabilized feature summaries, feature opportunities/confidences, Calling Station eligibility evidence, classifier schema version, generation timestamp, and structured transition reasons. Raw events, cards, chat, transport frames, account data, cookies, tokens, and display names are excluded.

Transition reasons include status/primary/best/runner changes, tag additions/removals, confidence movement of at least 0.05, crossing the 0.08 score-margin gate, and Calling Station semantic-support or eligibility changes. The original ten-entry profile history and its 0.05 confidence-delta rule remain unchanged. That rule can hide useful sub-threshold score/confidence movement in a stable profile; the separate 250-sample diagnostic series preserves it without changing production history semantics.

The isolated-world API adds:

```js
globalThis.PokerNowHUDProfiles.profileTimeline(playerId)
globalThis.PokerNowHUDProfiles.profileSamples(playerId)
globalThis.PokerNowHUDProfiles.profileStability(playerId)
globalThis.PokerNowHUDProfiles.profileBandSnapshots(playerId)
globalThis.PokerNowHUDProfiles.allProfileStability()
globalThis.PokerNowHUDProfiles.exportLiveProfileValidation()
globalThis.PokerNowHUDProfiles.identityDiagnostics()
```

The export contains the current session key, explicit bounds, and detached current/timeline/sample/band/stability data for each bounded shadow player. The export object itself is never persisted.

### Live identity and monotonicity invariants

Live shadow ownership now passes through one canonical stable-ID guard. `null`, `undefined`, empty/whitespace values, literal `"null"`/`"undefined"`, and the `gamePlayer` placeholder are rejected case-insensitively. Legitimate opaque IDs are otherwise unrestricted. Exact IDs carried directly by PokerNow or used as keys inside known player-map containers remain valid evidence; display names, seats, timestamps, hand counts, and profile similarity are never used to resolve identity.

The socket discovery paths no longer stringify missing IDs and no longer treat arbitrary structural object keys as player IDs. An unresolved spectator, empty seat, or joining player is skipped. When an exact stable ID later appears, that player's profile begins or resumes normally without retroactively adopting unresolved samples.

Within one in-memory session/player record, cumulative `hands` must be monotonically non-decreasing. A lower count is rejected before classification, history, samples, band snapshots, or stability metrics change. The explicit Reset Session workflow remains authoritative because it clears the shadow store before rebuilding zero-hand profiles. The live validation export includes FIFO-bounded identity and monotonicity diagnostics (50 retained entries each) containing only reason, source, observed identity or stable ID, hand counts, and session key.

The debug API exists in the extension's isolated content-script execution context, not the ordinary page/MAIN context. `content.js` explicitly installs the same frozen object on the isolated world's `globalThis`, `window`, and `self` aliases so Chrome DevTools evaluation resolves it consistently. In PokerNow DevTools, select the **PokerNow Stats HUD** content-script context from the Console execution-context dropdown, then use:

```js
globalThis.PokerNowHUDProfiles.list()
globalThis.PokerNowHUDProfiles.get("stable-player-id")
globalThis.PokerNowHUDProfiles.summary()
globalThis.PokerNowHUDProfiles.clear()
globalThis.PokerNowHUDProfiles.exportCalibration()
globalThis.PokerNowHUDProfiles.calibrationSummary()
globalThis.PokerNowHUDProfiles.rebuildFromExistingStats()
globalThis.__PNHUD_PROFILE_DEBUG__ = true
```

`clear()` removes only in-memory shadow profiles. It does not modify poker statistics or storage. Reloading regenerates profiles from authoritative counters.

### Historical sessions

Authoritative live events are persisted in `chrome.storage.local` under a distinct namespace for each PokerNow hostname/game ID. Old namespaces normally survive page reload, browser restart, leaving a game, and joining another game. They are removed only by that game's Reset Session operation, schema invalidation when the game is next loaded, extension removal/storage clearing, or storage-capacity failure. The extension does not impose a session-count limit; the practical bound is Chrome's local extension-storage quota.

Only the current game is loaded into normal runtime memory. The isolated debug API can discover and reconstruct other stored game namespaces read-only:

```js
await globalThis.PokerNowHUDProfiles.sessions()
await globalThis.PokerNowHUDProfiles.rebuildSession("pokernow.com:game-id")
await globalThis.PokerNowHUDProfiles.exportSessionCalibration("pokernow.com:game-id")
await globalThis.PokerNowHUDProfiles.sessionCalibrationSummary("pokernow.com:game-id")
```

Discovery exposes only the session key, lobby/game ID, event/player counts, first/last event timestamps, approximate unique-hand count, schema version, and availability status. Reconstruction keeps sessions separate, uses each namespace's stable player-ID map plus finalized events, and never writes events, counters, mappings, or profiles. The legacy unscoped `pokerNowHudLiveEvents` key is excluded because its game ownership cannot be proven.

Historical calibration schema v3 validates identity before classification. Missing values, empty/whitespace strings, the literal sentinels `"null"` and `"undefined"`, and the legacy `registered.gamePlayer` object-key placeholder are rejected. `gamePlayer` names local-user settings in the PokerNow registration payload; it is not the stable ID carried by `registered.currentPlayer.id` and `gameState.players[id]`. An invalid or placeholder row is resolved only when that same persisted row carries one unambiguous explicit `stablePlayerId` or `authoritativePlayerId`; names, seats, counters, timestamps, and statistical equality are never identity evidence. Unresolved rows are omitted from `profiles[]` and retained only as bounded, JSON-safe `unsupportedPlayers[]` diagnostics. Duplicate paths to one exact stable ID classify once, while conflicting names for one stable ID fail closed. Summaries deduplicate by session plus stable player ID, so the same stable ID remains an independent observation in different sessions.
