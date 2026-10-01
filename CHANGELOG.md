# 1.4.0

Final V1.4.0 promotes the exact accepted RC2 archive byte-for-byte. Build ID `v1.4.0-rc2-20260930-2250` is retained. The accepted ZIP contains 73 files, is 2,377,285 bytes, and has SHA-256 `E1F804E1FF9E47A937E857A2F65201B36CEB07C99620E633E3739DC0236AB8BB`.

- Browse Session History and historical Session detail, including supported table, situation, and position filters.
- Compare Recent player Sessions or hands with Career totals and inspect Session Trends. Open history views refresh after finalized hands and Career updates.
- Delete one exact historical Session globally from Career for every affected player; the current live Session remains intact.
- New hands carry explicit Session provenance. Older Career records without it remain valid Career data and are not fabricated into historical Sessions. Backup format remains v1.
- RC2 corrects Dashboard open/closed restoration across reload, Recent/Trend selector styling, and the small unset Leaderboard size. The selected Dashboard mode still returns to Session after reload; mode restoration is deferred to V1.4.1.

# 1.3.0

Final V1.3.0 promotes the exact accepted RC4 archive byte-for-byte. Build ID `v1.3.0-rc4-20260929-0321` is retained; RC1, RC2, RC3, and RC4 remain immutable. Signed-in RC4 smoke was accepted before promotion.

## RC4 corrections

- The production-mounted Player Dashboard regression now exercises the actual source and Table Size controls, HU-only Career Profile, empty segments, mixed All suppression, and stale table-size requests.
- Profile headings identify the selected HU, 3–5, or 6+ population; empty selected segments explain why no supported Profile is available.
- The Dashboard places Session/Career on its own row and Table/Situation/Position together at normal width, with narrow-width wrapping verified in native Chrome.
- Signed-in development smoke at `c8f77c7fe66f6bd390d00ec914c006b9ecb4d111` confirmed the selector, contextual-filter layout, table-size coverage, Insights, and Review Signals. The earlier missing-selector observation was traced to an RC2 browser instance.

## RC3 history

RC3 uses Build ID `v1.3.0-rc3-20260928-1800` and includes the accepted Career schema-4 table-size and cold/warm coverage fixes. Its tag and ZIP remain immutable.

## RC3 corrections

- Maintained Career schema-4 aggregates retain exact HU, 3–5, and 6+ dealt-count partitions; unknown historical provenance stays outside classified buckets. Cold and warm Career results both include `coverage.tableSizeHands`, and warm maintained reads retrieve no history.
- Session and Career analysis use distinct supported table-size calibration. Mixed or unknown All populations retain raw numeric statistics while suppressing calibrated interpretations; supported HU, 3–5, and 6+ populations retain Profile explanations.
- The native Chrome Career upgrade fixture now injects a failed schema-4 rebuild and verifies atomic rollback, retry, actual page reload, maintained partitions, and zero-history warm reads.

## RC2 history

Release candidate RC2 follows the failed, immutable RC1. It retains the V1.3 feature set and uses Build ID `v1.3.0-rc2-20260927-2039`; signed-in validation of the exact RC2 package remains required before final promotion.

## RC2 corrections

- Restored Session VPIP/PFR opportunity semantics by giving BB-walk detection the complete selected-hand event context. BB walks still count as Hands but are excluded from VPIP/PFR opportunities; numerator counts and Evidence now use eligible opportunities.
- Restored All-positions Session coverage and live/hydrated Session agreement with Career schema-3 aggregates. The PlayerA 64-hand regression has 31 walks, 33 eligible opportunities, 8 VPIP and 1 PFR; PlayerB has 40 eligible opportunities, 1 VPIP and 1 PFR.
- Restricted Opponent Insights, Strategic Implications, self Review Signals, and cross-context Review Signals to proven 3+ handed populations. Heads-up and mixed numeric stats remain visible, while unsupported multiway-calibrated interpretations are suppressed. An exact 3+ Session slice can still qualify; mixed Career context cards are suppressed.

## V1.3 features carried forward

Release candidate RC1 freezes `dev/v1.3` commit `406dcde658f51f82d2380a537df40de3890e542c` under Build ID `v1.3.0-rc1-20260926-2109`. Automated and signed-in certification remain separate.

## Player analysis

- Evidence-gated Opponent Insights and action-first Dashboard presentation use the selected player, source, and context.
- Strategic Implications offer broad adjustments based on supported observed tendencies; they are not hand-specific solver advice.
- Self-only Review Signals compare IP/OOP and supported positions only when both sides have sufficient Evidence.
- Session and Career context partitions share same-revision comparison payloads.

## Pot Odds and Career

- Pot Odds uses a persistent canonical preflop board anchor, table-local drag placement across hands, Reset Position, and a compact 76px panel.
- Career aggregate schema 3 maintains Overall, IP, OOP, and supported positions for warm Dashboard reads; a one-time derived rebuild preserves canonical records and Backup v1 compatibility.

## Release boundary

- The 73-file production inventory includes the three V1.3 analysis modules. V1.0/V1.1/V1.2 tags, baselines, and artifacts remain unchanged.
- RC1 failed signed-in smoke and remains immutable. RC2 requires its own signed-in smoke before any final promotion.

# 1.2.0

Release candidate status: RC2 freezes the accepted post-RC1 blocker fixes at `dev/v1.2` commit `327f68a6c2c4f14e3c2a60e14e51bd90f289731a` under Build ID `v1.2.0-rc2-20260922-1612`. RC1 remains an immutable failed candidate. Automated release certification and signed-in PokerNow validation remain separate; no final `v1.2.0` release is created here.

## RC2 blocker corrections

- Restore-triggered Session reset discards the prior boundary cooldown/evidence but excludes the pre-reset hand ID, allowing the first fully observed fresh hand to count once in Session and Career.
- Career Restore outcome-gates in-flight pre-reset appends: successful replacement discards them; failed replacement or controller retirement preserves legitimate records.
- Cold-start Career Leaderboard shows `Loading…` while the batch is unresolved and `Unavailable` on failure; H0/--- represents only settled no-history data. Warm settled-snapshot reuse and identity fences remain intact.

## Added

- Career Data management with exact current-Session removal, compressed export, merge import, safe replace restore, legacy JSON compatibility, previews/results, integrity checks, conservative portability limits, and a supported whole-ledger envelope of approximately 4,032 physical records.
- Statistical Evidence support levels based on the exact displayed numerator/denominator slice. Low support retains the internal `insufficient` state while showing only the support count; Weak, Moderate, and Strong semantics remain unchanged.

## Reliability

- Career Leaderboard stale-while-revalidate publication and settled Career reuse across source switches.
- Seat HUD and content-controller ownership fencing, including explicit PokerNow Pause latch behavior and reinjection protection.
- Restore resets Session only after successful Career replacement; failed transfer operations preserve Session.

## Release boundary

- The production package inventory now explicitly includes `careerPortableFile.js` and `statEvidence.js` and contains 70 allowlisted root files.
- V1.0 and V1.1 tags, artifacts, Build IDs, and freeze metadata remain immutable.

# 1.1.0

Release candidate status: RC3 packages the accepted post-RC2 lifecycle fix under Build ID `v1.1.0-rc3-20260913-1702` together with the earlier bounded blocker corrections. RC1 and RC2 remain immutable failed/not-promotable candidates. The user passed DEV live checks for the fix commit, but that is not signed-in validation of the RC3 package. No final `v1.1.0` release is created here.

## Post-RC2 blocker correction

- Rearm one narrow sparse-deal acquisition after startup/reload, Reset Session, or verified Resume while keeping the global boundary threshold unchanged. The path requires fresh authoritative hand identity, complete deal evidence, an empty pre-deal baseline, no board or settlement, and existing Pause/signature/deduplication guards.
- Reset still discards the current partial hand; paused stale traffic, excluded prior IDs, and finalized signature replay cannot create ownership. Accepted fresh hands publish Session and Career exactly once and retain existing Leaderboard/Seat HUD refresh ownership.
- User-reported DEV live validation passed Reset-next-hand, Pause/Resume, reload-next-hand, and duplicate-protection cases for commit `028d3e2`. The RC3 package itself remains live-unvalidated until the final signed-in RC3 smoke.

## Post-RC1 blocker corrections

- Verified PokerNow Pause now rejects hand-boundary and semantic betting-action progression from sparse or stale nonterminal patches while retaining recovery metadata and an owned terminal settlement path.
- Pot Odds now resets its manual offset to exact `0,0` once per authoritative hand on the first verified measured postflop board. Authoritative preflop rejects stale prior-board DOM, and the per-hand latch survives reload so later user movement remains intact.
- Normal source identifies itself as `PokerNow Stats HUD - DEV VERSION`; release staging projects only that manifest display name to `PokerNow Stats HUD`.
- Reset Session now clears Session statistics/lifecycle state while immediately reconciling authoritative current-seat stable identities, preserving Career Leaderboard and Career Seat HUD links without appending or deleting Career data; same-name players remain distinct by stable ID.

## Added

- Career-backed numeric source for the Leaderboard while preserving its Session-derived player inclusion and ordering.
- Tracked Players browser under Settings → Players with local search, sorting and stable-ID dashboard navigation.
- Career-backed player profiles derived only from accepted, exact 3+ handed schema-v3 evidence.
- Movable and resizable Player Dashboard with page-lifetime geometry retention and position-only reset.
- Exact heads-up-postflop In position / Out of position Dashboard situations with conservative provenance exclusions.
- Career Recent Trends for Last 25, 50, 100 and 250 eligible dated hands, including revision, cache and race protection.
- Seat HUD visibility control.

## Improved

- Career Dashboard filtered-query resolution reuse and lightweight Career player-summary indexing.
- Dashboard observer behavior, Settings-to-player navigation, Pot Odds placement and Leaderboard reset reliability.
- Career snapshot isolation, partial supported table-context handling, quarantine-aware summaries and deterministic cache invalidation.

## Notes and limitations

- Profiles require sufficient supported evidence; heads-up and unknown-context hands do not enter Career archetypes.
- IP/OOP requires exact supported two-player postflop provenance and is not inferred for multiway, legacy or incomplete hands.
- Trends are Career-only and overall; Dashboard filters do not alter them.
- BTN-vs-blinds, blinds-vs-steal, trend charts, arbitrary windows/date ranges and Session Trends remain deferred.

# 1.0.0

Release candidate: RC1. Feature-complete baseline passed user live visual signoff and final soak. Final V1 promotion remains an explicit later decision.

## Added

- Live Seat HUD and Session leaderboard with configurable poker statistics.
- Session/Career numeric sources, persistent local Career history, health reporting, integrity-checked backup and previewed replace-only restore.
- Player dashboard with position/relational filters and local stable-ID notes.
- Interpretable player archetypes, sample/confidence gates and profile explanations.
- Hands, VPIP, PFR, AF, 3Bet, F3B, flop CBet/FCB, WTSD and W$SD with explicit support boundaries.
- Persistent preflop/postflop Pot Odds arithmetic, chip-based wording and drag/reset controls.
- Painted-player-panel Seat HUD centering, manual offsets, accessibility clamps and native-panel layering.

## Reliability

- Evidence-based lifecycle boundaries, bounded reload/reconnect continuity and exactly-once finalized-hand accounting.
- Immutable Career contributions, fingerprint deduplication, explicit supersession and conservative quarantine.
- Shared Session caches, batched Career queries and bounded observer/diagnostic work.
- Stable table-local BoardCompanion geometry and preserved drag lifecycle.
- Production-shaped regression fixtures, package dependency/order guards and reproducible release packaging.

## RC1 release hygiene

Version/build labels and manifest description are production-facing. Misleading legacy “All-time” controls are labeled “Session (legacy)” without changing the underlying source. Documentation, local-data/privacy notes, certification boundaries, frozen-file verification and a canonical Git release workflow are included. No feature, statistic, profile or storage semantics changed during RC1 finalization.
