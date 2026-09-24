# Public 1.2.0 live-validation matrix

Release: 1.2.0. The accepted `v1.2.0-rc2` passed signed-in manual smoke before promotion, as confirmed by the maintainer. The final ZIP is byte-identical to that candidate. This public copy does not include a signed-in session transcript, raw browser capture, or live screenshot. A Session-to-Career switch may briefly show Loading before Career values; this is accepted V1.2 behavior, unlike a false authoritative H0 while unresolved.

“MANUAL VALIDATION REQUIRED” below identifies a case without separately published live evidence, not a claim that overall RC2 signoff is pending. “AUTOMATED CERTIFIED / LIVE NOT OBSERVED” means the deterministic support boundary is covered, but a specific live observation is not included in this public record. The signed-in smoke prioritized first post-Restore hand counting, Career cold Loading/settled values, Pause/Resume, portable Career transfer, and HUD/Pot Odds sanity; rare variants retain the per-case limitations below.

| Practical case | Automated evidence (representative test) | Live evidence / status |
| --- | --- | --- |
| Normal finalized hand flow | coreStatsContinuity.production | MANUAL VALIDATION REQUIRED; no session transcript included |
| BB walk | statsWalk; walkSettlement.production; multiwayWalk.production | Synthetic walk fixture is replayed automatically; individual final-soak walks are not enumerated |
| Reload continuity | ownedHandReloadContinuity.production; breakReloadRestart.production | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for a specifically recorded final-soak reload boundary |
| Reconnect continuity | interruptedHandRecovery; pausedLifecycleRecovery.production; transport ordering | AUTOMATED CERTIFIED / LIVE NOT OBSERVED; no claim of missed-action recovery |
| Pause/break/rejoin and sparse next-hand ownership | verifiedHostPauseResume.production; lifecycleReleaseBlocker.production; sessionPauseIdleOracle.production | Synthetic Pause/Resume and sparse lifecycle fixtures; remaining live branches AUTOMATED CERTIFIED / LIVE NOT OBSERVED |
| Showdown | showdownStatsAuthoritative.production; showdownStatsContentPath.production | MANUAL VALIDATION REQUIRED; individual live settlement cases not included |
| Mucked showdown | showdownStatsReducer; showdownStatsAuthoritative.production | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for bounded check-through membership |
| F3B, including qualifying squeeze caller | preflopMultiwayFoldToThreeBet; sanitizedCaptureDerivedPreflopFixtures.production | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for the sanitized fixture case |
| Flop CBet / FCB | flopCBetContentPath.production; flopCBetVisibleIntegration.production | Earlier explicit live validation recorded in FLOP_CBET_DESIGN.md; no new per-branch RC live claim |
| Side-pot / split / ambiguous settlement | showdownStatsReducer; sanitizedCaptureDerivedPreflopFixtures.production; short-all-in scenario | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for all rare pot/eligibility combinations; conservative exclusions remain |
| Seat HUD default / Reset / painted centering | seatHudLivePanelBody.production; seatHudCanonicalPositioning | MANUAL VALIDATION REQUIRED; public fixture uses synthetic painted-body measurements |
| Seat HUD drag / manual offset / clamp | overlayGripLive.production; seatHudVisualPanelDom.production | MANUAL VALIDATION REQUIRED; no live interaction transcript included |
| Session / Career seat source | seatHudSourceSwitch.production | MANUAL VALIDATION REQUIRED |
| Chat layering / launcher hierarchy | seatHudLayeringFinalization.production | MANUAL VALIDATION REQUIRED |
| Log / Ledger / Replayer / account-menu masking | seatHudLedgerSuppression.production; seatHudVisualPanelDom.production | MANUAL VALIDATION REQUIRED |
| Settings blockers / pointer masking | settingsUi.production; seatHudLayeringFinalization.production | MANUAL VALIDATION REQUIRED |
| Player dashboard drag / resize / Reset Position | playerDashboardGeometry.production; playerDashboardGeometry.browser | MANUAL VALIDATION REQUIRED; the optional browser-shaped test runs only with `--browser` |
| Career profiles / explanations | careerPlayerProfile; playerProfileExplanation; finalUiProfileClarity | MANUAL VALIDATION REQUIRED; every filter/sample gate is not individually observed |
| Tracked Players browser | trackedPlayers; trackedPlayers.production | MANUAL VALIDATION REQUIRED for signed-in Settings and dashboard navigation |
| Exact heads-up-postflop IP/OOP | situationalDashboard; situationalDashboard.production | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for all provenance exclusions |
| Career Recent Trends | careerTrends; careerTrendsService; careerTrends.production | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for chronology, revision, cache, and race boundaries |
| Career persistence / backup / restore | careerServiceWorker; careerSupersession; careerBackupCorruption | AUTOMATED CERTIFIED / LIVE NOT OBSERVED for a separately recorded restore/size/race scenario |
| Pot Odds preflop / postflop | potOddsPersistentPreflopUi.production; potOddsStableVisibilityAndLiveDrag.production | MANUAL VALIDATION REQUIRED; rare eligibility cases remain limited |
| Pot Odds drag / per-hand Reset / board continuity | boardCompanionLiveUxFinalization.production; potOddsDraggablePosition.production | MANUAL VALIDATION REQUIRED; no live geometry transcript included |

Test names omit the common `.test.js` suffix for readability. Exact file membership is in `testSuites.js`. Automated certification describes the defined support boundary, not universal poker-variant correctness. Live-unobserved rare cases are documented limitations, not fabricated passes.
