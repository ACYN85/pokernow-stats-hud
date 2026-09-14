# PokerNow Stats HUD architecture

## Public 1.1.0 operating map

This is the current public-release architecture. Historical phase documents describe how these owners evolved.

```text
PokerNow WebSocket
  -> MAIN capture / isolated runtime + lifecycle ownership
  -> bounded semantic hand ledger + ordered action evidence
  -> supported preflop / flop / showdown reducers
  -> finalized Session events + exact counters -> Session cache -> HUD / dashboard
                                                |
                                                +-> immutable Career contribution
                                                    -> worker-owned extension IndexedDB
                                                    -> indexed aggregation -> Career HUD / dashboard
```

This is a conceptual dependency map: the production finalization owner controls when ledger finalization and reducer attachment happen. The semantic ledger does not become a second transport/finalization owner. No unfinished hand contributes visible finalized Session totals.

| Owner | Modules / responsibilities |
| --- | --- |
| Runtime/lifecycle | content.js coordinates; runtimeScope.js, firstHandLifecycle.js, gameBreakLifecycle.js, ownedHandReloadContinuity.js, interruptedHandRecovery.js, handFinalization.js own bounded guards/checkpoints |
| Ledger/reducers | semanticHandLedger.js; preflopOpportunityReducer.js; flopCBetOpportunityReducer.js; showdownStatsReducer.js; stats.js consumes authoritative supported counters |
| Session/cache | sessionRuntime.js, sessionStatsCache.js; content.js per-game persistence and revision invalidation |
| Seat HUD/layering | seatOverlay.js + content.js geometry/DOM adapter; stable identity separate from painted bounds; canonical + manual offset, render-only accessibility clamp |
| Profiles/explanations | playerProfileClassifier.js, playerProfilePresentation.js, playerProfileShadowStore.js; playerProfileExplanation.js reads decomposition/policy without changing scoring; visible profiles are Session-derived |
| Dashboard/filters/notes | playerDashboard.js, filteredStats.js, positionResolver.js, playerNotesStore.js |
| Career | careerContributionStore.js builds immutable bundles; careerServiceWorker.js owns extension-origin IndexedDB via careerIndexedStore.js; careerStatsAggregator.js chooses active contributions; careerBackup.js / careerBackupPolicy.js validate bounded replace-only backup |
| Board/Pot Odds | boardCompanionLayout.js owns stable table-local canonical board epochs; potOddsPosition.js owns offsets/clamps; potOdds.js owns arithmetic; read-only boardCompanionDiagnosticBridge.js |
| Settings | settingsUi.js, careerDataSettings.js and content.js adapters; popup.js uses existing storage/message boundaries |
| Diagnostics/performance | hudDiagnostics.js, hudHealth.js, runtimeBounds.js, tbTrace.js, pause/showdown captures and read-only inspectors; bounded, opt-in where applicable, never poker-semantic owners |

Career append is downstream of accepted finalized contributions, not historical Session backfill. Fingerprints, linear supersession, quarantine, outbox replay and indexed query revisions preserve exactly-once logical aggregation. Whole-ledger restore affects Career stores only; Session, notes, profile state and settings remain separate.

[Stat support](STAT_SUPPORT.md), [Career Data](CAREER_DATA.md), [Privacy](PRIVACY.md), [Testing](TESTING.md) and [Release Audit](RELEASE_AUDIT.md) describe the current V1 contract. The detailed implementation notes below retain phase terminology where historically useful.

## Shared board companion layout

`boardCompanionLayout.js` is the single owner of one stable PokerNow table/stage coordinate system and one immutable five-card `canonicalBoardLocalRect` per genuine layout epoch. Table selectors are evaluated in real priority order and extension-owned Settings nodes are excluded at both controller and layout-service boundaries. Five explicit slots are strongest evidence; when a genuine epoch starts postflop, 3–5 actual cards plus credible pitch may establish the complete slot-1-to-slot-5 envelope. Thereafter card DOM is validation-only: street, Settings, hand lifecycle, drag, and board remount cannot replace canonical geometry. Same-epoch proposals are rejected as `ILLEGAL_CANONICAL_GEOMETRY_CHANGE`; Settings-owned proposals are rejected as `ILLEGAL_SETTINGS_GEOMETRY_CHANGE`. Pot Odds consume LEFT via stable-root delegated title dragging; a future Turn/River panel must consume RIGHT from the same model with an independent offset. `potOddsPosition.js` applies the feature-owned persisted offset and non-destructive viewport clamp afterward. `boardCompanionDiagnosticBridge.js` exposes only three asynchronous, read-only, privacy-scrubbed methods to ordinary page DevTools, including schema-v3 expected/observed first-slot and Pot Odds alignment evidence. The bounded 160-event history contains reason-coded Settings, geometry, drag/capture, offset, reset, and render changes rather than samples. See `BOARD_COMPANION_LAYOUT.md` and `LIVE_VALIDATION_MATRIX.md` for the manual certification boundary.

Player Dashboard Phase 4B position/relational ownership and coverage are documented in `PLAYER_DASHBOARD_PHASE4B.md`. `positionResolver.js` alone owns 2–9 handed dealt-position semantics; `filteredStats.js` filters existing exact session/career contributions without changing poker-stat reducers.

## Seat HUD visual geometry and panel layering

Stable seat identity and visual placement geometry are deliberately separate. Actual live DOM inspection established `.table-player > .table-player-infos-ctn` as the painted player body. `content.js` resolves that one visible connected direct-child background box for both canonical X center and Y bottom; nested identity anchors locate the body through their nearest existing `.table-player` without changing identity ownership. Name/stack layout, sibling status/cards, trophy/rebuy signals, and action bubbles do not enlarge the direct box. `seatOverlay.js` retains bottom +8px, canonical-plus-manual-offset requests, and rendering-only viewport clamps unchanged. Missing or ambiguous painted bodies use the prior safe geometry with explicit `visual_fallback` / `seat_fallback` labels. Diagnostics expose body source/rect, panel/HUD centers, center delta, panel bottom, canonical top, and vertical gap alongside offsets/requested/rendered/clamp data.

The seat root owns z-index 2147483643; Chat and the small LOG/LEDGER launcher remain below. Expanded Session Log/Ledger/Replayer and account/game menu roots receive an idempotent marker at 2147483644. Because a native ancestor stacking context can still cap that panel, the extension subtracts only panel intersections from HUD paint and hit-test regions with a CSS path. This guarantees partial occlusion without raising the whole native app or reparenting its DOM. A maximum of eight expanded panels and 64 fragments per HUD is retained; close/cleanup restores the full HUD. Settings remain true blockers. Existing mutation/resize/drag signals drive reconciliation; there is no polling or new production listener.

This extension uses ordinary Manifest V3 scripts, not ES modules. Script order in `manifest.json` is part of the runtime contract. The MAIN-world WebSocket hook and isolated-world HUD have separate globals and communicate only through `window.postMessage`.

## Production data flow

```text
PokerNow WebSocket frame
  -> websocketHook.js: HudWebSocket / relay
  -> content.js: handlePageBridgeMessage
  -> content.js: decodeTransportFrame
  -> content.js: findGameStateContribution
  -> content.js: processGcSnapshot
  -> tbTrace.js: PokerTbTrace.mergeSnapshot
  -> content.js: detectGcNewHand (existing lifecycle ownership)
  -> semanticHandLedger.js: observe selected merged-state facts in shadow mode
  -> content.js: inferLiveActionCandidates
  -> liveActionPipeline.js: PokerLiveActionPipeline.handleMergedPatch
  -> actionInference.js: PokerActionInference.processTbPatch
  -> content.js: acceptHandEvent / stageStatsEvent
  -> handFinalization.js: PokerHandFinalization.stageEvent
  -> content.js: finalizeStatsHand
  -> handFinalization.js: PokerHandFinalization.commitHand
     -> semanticHandLedger.js: finalize one bounded shadow record
     -> stats.js: PokerStats.computePlayerStats (unchanged existing path)
     -> playerProfileClassifier.js + playerProfilePresentation.js + playerProfileShadowStore.js: raw classification plus bounded, non-persistent shadow presentation
     -> playerProfileExplanation.js: pure presentation adapter over the record, displayed state, and score decomposition
     -> playerProfileCalibration.js: isolated-world, read-only current/historical calibration exports
  -> content.js: persistHandAccounting
  -> content.js: render + reconcileSeatOverlays
  -> seatOverlay.js: PokerSeatOverlay.createController().reconcile
```

The live WebSocket pipeline is the sole owner of ordinary session statistics. Full Log discovery and parsing are display/diagnostic-only: `observeLog` classifies first renders, lazy renders, virtualized remounts, recycled rows, removals, and container replacements, while `recordLine` returns at an explicit source-ownership gate before hand staging or finalization. DOM mount time is never treated as poker completion time. The extension currently has no supported missed-hand recovery or historical-import mode; any future import must be an explicit reconciliation workflow using stable PokerNow hand IDs rather than the live finalization path.

Career Statistics Phase 1 is an additional consumer after semantic finalization and certified reducer attachment. `careerContributionStore.js` builds one immutable player-hand bundle from the exact finalized events and reducer outputs; `careerStatsAggregator.js` rebuilds exact per-player career counters from those bundles. Existing session state is never backfilled. The durable key combines host, PokerNow game/room ID, and authoritative `hI`; synthetic lifecycle IDs are aliases only. See [CAREER_STATS_FOUNDATION.md](CAREER_STATS_FOUNDATION.md).

Career Statistics Phase 2 moves only the career record layer to extension-origin IndexedDB after measured Phase 1 get-all startup costs became unsuitable at long-term scale. `careerServiceWorker.js` owns the database and an allowlisted runtime-message boundary; the content script never opens host-origin IndexedDB. `careerIndexedStore.js` performs structural Phase 1 migration, fingerprint-keyed append transactions, indexed per-player cache/query recovery, deterministic export, and crash-safe outbox replay. The exact Phase 1 semantic records and career boundary remain unchanged. The aggregator resolves explicit linear supersession chains and quarantines ambiguity. See [CAREER_STATS_PHASE2.md](CAREER_STATS_PHASE2.md).

Career Statistics Phase 3A adds `careerBackup.js`: a canonical versioned JSON format, SHA-256 integrity, strict whole-backup validation, and replace-only restoration. The service worker validates and rebuilds before mutation, requires digest-bound explicit confirmation, and atomically clears/repopulates only the four career stores with in-transaction verification. Merge restore remains deferred; the certified replace-only restore UI is available in Settings > Career Data. See [CAREER_STATS_PHASE3A.md](CAREER_STATS_PHASE3A.md).

Player Dashboard Phase 4A adds `playerDashboard.js` as a pure presentation/stat adapter and `playerNotesStore.js` as a separate mutable stable-ID metadata store. `content.js` wires name activation to the existing authoritative Session computation and asynchronous career service boundary. Career record schema 2 carries minimal reducer-proven stable IDs for 3Bet, F3B, multiway CBet context, and FCB; schema 1 remains valid without relational coverage. See [PLAYER_DASHBOARD_PHASE4A.md](PLAYER_DASHBOARD_PHASE4A.md).

## Runtime entry and worlds

- `runtimeScope.js` installs `PokerNowRuntimeScope` in each world in which it is loaded.
- `websocketHook.js` runs at `document_start` in MAIN world so it can wrap PokerNow's native `WebSocket` before the game connects.
- `content.js` runs in the isolated world after every dependency listed before it in the manifest.
- Both `pokernow.com/games/*` and `www.pokernow.com/games/*` are intentionally supported by the checked-in manifest and runtime guards.

The local URL guard in `content.js` and the self-contained MAIN-world guard are compatibility fallbacks. They are duplicated deliberately because isolated-world globals cannot be shared with MAIN world, and earlier production packaging failures proved the isolated fallback useful.

## Core modules and frozen contracts

- `websocketHook.js`: frame capture and relay.
- `content.js`: production coordinator and owner of accumulated socket state, runtime identity/seat state, storage synchronization, and DOM observers.
- `tbTrace.js`: immutable snapshot merge and `tB` trace records.
- `liveActionPipeline.js`: production normalization and candidate lifecycle ledger.
- `actionInference.js`: verified `external.$.tB.$player` semantics and delayed stack corroboration.
- `handFinalization.js`: active-hand staging, participant evidence, commit/deduplication, and recovery for WebSocket-owned session hands.
- `semanticHandLedger.js`: pure, bounded production shadow normalization of selected merged WebSocket state into finalized hand facts. It has no transport, DOM, storage, statistics, or rendering ownership.
- `handLogDom.js`: Full Log observer identity, virtualized/recycled-row diagnostics, and the display-only statistics-ownership policy.
- `gameBreakLifecycle.js`: owns the narrowly scoped stopped-heads-up resume epoch. It records break state, supplies a boundary-only normalized baseline, validates a strict current-deal signature, and permits one consumption; it never mutates the merged socket snapshot or accumulated statistics.
- `stats.js`: VPIP, PFR, AF, hands, opportunity counters, and current pure Big Blind walk classification.
- `playerProfileClassifier.js`: pure interpretable feature stabilization, archetype scoring with defining VPIP compatibility, independently supported behavioral tags, and read-only score decomposition.
- `playerProfilePresentation.js`: pure deterministic minimum-sample, strength, persistence, hold, and replacement policy over detached raw profile records. Its output supplies the guarded displayed profile through the presentation adapter; it does not mutate numeric statistics.
- `playerProfileExplanation.js`: pure JSON-safe explanation adapter over authoritative classifier decomposition and presentation state. It reads active classifier/presentation configuration, owns no thresholds or profile state, and cannot change classification or hysteresis.
- `playerProfileShadowStore.js`: stable-player-ID ownership, exact numeric input signatures, bounded profile/history inspection, and failure containment. It has no rendering or persistence authority.
- `playerProfileCalibration.js`: discovers per-game persisted event namespaces from an isolated extension context and reconstructs session-separated calibration exports without storage writes or cross-session identity pooling.
- `walkDetection.js`: authoritative `sBPI`/`bBPI` blind-role preservation and finalized Big Blind walk classification.
- `seatOverlay.js`: pure seat assignment, anchor selection, placement, display modes, and overlay reconciliation state.
- `uiBootstrap.js`: minimum HUD/details/toggle root creation.
- `hudDiagnostics.js`: isolated-world off/basic/deep console gate. Diagnostics never control poker logic.
- `hudHealth.js`: pure health-panel markup and incremental metric-to-DOM updates.
- `parser.js`: stateful line parser retained for Full Log display/history diagnostics.

- `hudRuntimeStatus.js`: read-only runtime presentation state and precedence.
- `hostControlTrace.js`: exact verified-owner outgoing Pause/Resume recognition and its persisted authoritative latch.
- `pokerNowLifecycleSignal.js`: bounded observations of incoming lifecycle-shaped transport fields; it does not own verified outgoing host commands.
- `pauseDiagnosticCapture.js` and `pauseLifecycleCapture.js`: bounded, opt-in diagnostic evidence only. They never classify production lifecycle state.

## State ownership

| State or boundary | Owner | Invariant |
| --- | --- | --- |
| Raw WebSocket interception and MAIN-to-isolated relay | `websocketHook.js` | MAIN-world objects are relayed by message; their globals are not shared with the isolated world. |
| Accumulated `gC`/`tB` snapshot and transport coordination | `content.js` with pure merges from `tbTrace.js` | Patches are merged in arrival order; the current snapshot is not replaced by diagnostic or DOM state. |
| Staged versus finalized hand events | `handFinalization.js` | Staged events cannot affect HUD statistics. Only verified settlement or a distinct next-hand boundary commits them. |
| Finalized semantic shadow records | `semanticHandLedger.js`, gated by `applyHandCommitResult` | Selected merged-state evidence is normalized only after existing lifecycle ownership. Existing lifecycle IDs deduplicate; raw `hI` remains record identity when known. Records never feed current HUD statistics or storage. |
| Shadow player profiles | `playerProfileClassifier.js`, `playerProfilePresentation.js`, and `playerProfileShadowStore.js`, refreshed by `content.js` after authoritative stats changes | Raw results and displayed-candidate state remain separate, keyed only by stable player ID, bounded to 200 players, never persisted, and never consumed by current HUD rendering. |
| Stopped/waiting resume epoch | `gameBreakLifecycle.js` | One narrowly verified epoch can be consumed once; it is independent from paused-hand recovery. |
| Incoming lifecycle observations | `pokerNowLifecycleSignal.js` | Observations are evidence records, not authority to manufacture an outgoing host command. |
| Verified host Pause/Resume latch | `hostControlTrace.js` | Only an exact outgoing `action` payload with top-level `type: "UP"` or `type: "UR"`, plus matching local-player/table-owner IDs, can set it. |
| Runtime badge/footer selection | `hudRuntimeStatus.js` | The selector reads lifecycle/transport inputs and has no hand, epoch, persistence, or statistics side effects. |
| Diagnostic buffers, markers, and raw capture | `pauseDiagnosticCapture.js` and `pauseLifecycleCapture.js` | Disabled by default and incapable of changing production classification or accounting. |

## Authoritative Pause/Resume flow

An exact verified-owner outgoing Socket.IO `action` payload `{ type: "UP" }` records authoritative Pause; `{ type: "UR" }` records authoritative Resume. The evidence source is `verified-host-outgoing-command`, and the latch is persisted independently of whether a hand is active. UI clicks and diagnostic markers may be recorded for correlation, but they never satisfy the production recognizer.

Merged `gC` lifecycle data can add an authoritative paused observation. When a patch has no such authoritative Pause field, `content.js` passes `undefined` to the runtime status reconciler so the existing verified-host latch is preserved. A generic active/in-progress patch therefore cannot clear Pause. Only the verified Resume command or an already-established authoritative lifecycle transition may clear it.

`hudRuntimeStatus.js` applies the fixed presentation precedence: transport disconnected → connecting/awaiting fresh game state → waiting/break/stopped → authoritative pause → verified live. Internal state values remain unchanged; the `live-socket` state is presented to users as `Paused`.

Frozen behavior includes Engine.IO/Socket.IO decoding, snapshot merging, `tB` semantics, player mapping, hand boundaries, participant selection, action inference, finalized-hand accounting, VPIP/PFR/AF formulas, and persisted overlay offsets.

## Hand staging and finalization

`content.js` selects an active hand with `beginStatsHand`. Every accepted event reaches `stageStatsEvent`, which calls `PokerHandFinalization.stageEvent`. Displayed statistics use only `handAccounting.finalizedEvents`; the active staged hand is persisted separately and does not affect the HUD.

At cold start, `firstHandLifecycle.js` gates WebSocket frames until table-scoped storage restoration has created `handAccounting`. Frames captured during that short window are replayed in original capture order through the unchanged production decoder. This prevents the asynchronous storage callback from replacing an early first-hand object. Reset Session starts a comparison trace but does not close the already-ready frame gate.

`finalizeStatsHand` calls `PokerHandFinalization.commitHand` on WebSocket settlement/gameResult evidence. `PokerHandFinalization.beginHand` commits the previous active hand when a distinct next WebSocket hand begins. Full Log end markers do not call either function. Recovered hands that were not observed again are discarded rather than guessed complete.

The semantic ledger observes after current lifecycle ownership/boundary selection and before the merged snapshot advances. Both accepted completion paths converge on `applyHandCommitResult`; only committed/duplicate production results reach its finalizer, while discarded recovered hands are removed without a record. Startup seeds the ledger with the existing persisted finalized IDs and any existing active hand. Finalized records (50), observations per active hand (240), and finalization attempts (100) are bounded in memory and available through Copy Diagnostics. No semantic record or new statistic is persisted. See [SEMANTIC_HAND_LEDGER.md](SEMANTIC_HAND_LEDGER.md).

## Walk classification and opportunities

`PokerStats.computePlayerStats` groups finalized events by hand and delegates to `PokerWalkDetection.detectBigBlindWalk`. A verified walk depends on a finalized `blind` event carrying `blindType: "big"`, all other recorded participants folding preflop, no Big Blind decision/action, and no postflop action. A detected walk increments `handsPlayed` but not `vpipOpportunities` or `pfrOpportunities`.

The production entry point for Big Blind identity is `detectGcNewHand`, which passes verified `sBPI`/`bBPI` identities to `PokerWalkDetection.createInitialHandEvent`. Stack deductions supply blind amounts but are not required to preserve an otherwise verified blind role. Full Log parsing cannot alter walk classification or finalized statistics.

When PokerNow omits fold actions before an uncontested Big Blind settlement, `content.js` passes the pre-settlement and settlement snapshots to `PokerWalkDetection.evaluateSettlementWalk` before committing the hand. The helper preserves missing fold evidence for every verified eligible non-Big-Blind participant only when the dealt-in set, Small/Big Blind identities, blind-only preflop history, no board/showdown/Big-Blind decision, blind commitment cleanup, and sole Big Blind settlement winner all agree. Table-roster players absent from the dealt-in set are excluded. Ordinary settlement remains ignored by general action inference.

When startup frame replay begins from a hydrated, clean waiting/stopped/broken snapshot with no persisted active hand, `gameBreakLifecycle.js` owns that snapshot as a reload-scoped break baseline. It can authorize exactly one subsequent boundary only after a verified break-to-active lifecycle transition and a complete current deal signature. This does not recover a pre-reload hand, change ordinary boundary confidence, or share ownership with paused-hand recovery.

`hudRuntimeStatus.js` is the read-only owner of the primary connection/game-status presentation. Its precedence is documented above. The user-visible labels are `Disconnected`, `Connecting…`, `Waiting`, `Paused`, and `Live`; the internal authoritative Pause runtime state remains `live-socket`. This selector reads lifecycle output but cannot create hands, consume epochs, persist lifecycle commands, or mutate statistics.

Percentages use `vpipHands / vpipOpportunities` and `pfrHands / pfrOpportunities`. AF remains `(postflop bets + postflop raises) / postflop calls`, with infinity when aggressive actions exist and calls are zero.

## Storage ownership

`content.js` builds table-scoped keys from hostname plus game ID. It stores finalized live events, the serialized active hand, finalized IDs and fingerprints, player mappings, hand signatures, session metadata, display/debug preferences, and per-table manual overlay offsets.

`handAccounting` owns finalized and staged hand state. `liveEvents` is the single display/storage alias for `handAccounting.finalizedEvents`; the former duplicate `finalizedHandEvents` variable was removed. `hostControlTraceState` separately owns the persisted verified-host Pause/Resume latch; it is intentionally not derived from active-hand storage.

## HUD and overlays

V1.1 adds derived read paths without changing immutable hand authority. `careerIndexedStore.js` maintains lightweight player summaries and revision-keyed Trend/query caches; `trackedPlayers.js` presents those summaries inside Settings. `filteredStats.js` owns exact heads-up-postflop IP/OOP projection, while `playerDashboard.js` owns presentation-only geometry and filter state. Career profiles use the shared classifier over a rebuildable projection limited to accepted exact 3+ handed evidence. None of these views writes alternative statistics or mutates accepted Career records.

`render` creates the details table and health panel from finalized events. `reconcileSeatOverlays` computes player stats and passes confirmed player/seat entries to `PokerSeatOverlay.createController().reconcile`. Drag listeners and persisted relative offsets remain in `content.js`; placement math remains pure in `seatOverlay.js`.

The seat-overlay root remains a fixed direct `BODY` child so viewport placement and dragging are not trapped by native transforms or clipping. Stable identity, direct painted panel-body geometry, canonical/requested/rendered rectangles, offsets, and render-only clamps remain separate for 2/3/4/6/9-handed layouts. Current-node remounts re-resolve the panel. Live-panel finalization does not modify any layering, identity, or drag code.

Expanded log/replay/account-menu surfaces never enter global suppression reasons. The native marker plus intersection-only HUD clip enforces visual and pointer order across ancestor stacking contexts. Extension Settings and verified PokerNow Game Settings retain true-blocker behavior. Diagnostics include expanded-panel type/evidence, current rect, ancestor contexts, and layer strategy alongside identity, geometry, offsets, clamp/grip, and source state. See `BOARD_COMPANION_LAYOUT.md` for the current layout contract.

Display modes are represented only by `pokerNowHudDisplayMode`. Details visibility is derived through `PokerSeatOverlay.detailsEnabled`; the obsolete separately persisted leaderboard-open boolean was removed.

## Diagnostics

`hudDiagnostics.js` provides:

- `off`: errors only;
- `basic` (default): startup, hand/finalization, accepted action lifecycle, and walk/stat summaries;
- `deep`: transport, payload, mapping, `tB`, mutation, anchor, and candidate traces.

Copy Diagnostics includes `firstHandLifecycleTraces`, a bounded cold-start/reset-session record covering storage readiness, queued frames, snapshots, boundary decisions, mapping readiness, active-hand creation, event staging, finalization, deduplication, and displayed-hand increments. It also includes `gameBreakLifecycleTraces`, which preserves stopped/waiting state, pre-break and post-return baselines, the first two resume-boundary evaluations, retained action/settlement state, and the resulting settlement-finalizer decision. A resume epoch can arm only after a verified resolved heads-up hand transitions into a stopped/waiting state with fewer than two eligible players. Its one-shot boundary override requires current mapped/in-hand/blind/actor/hole-card evidence, a deal-specific field transition, and a fingerprint distinct from the stale terminal representation.

Pause diagnostic capture is opt-in and disabled by default. Marker ownership, DOM mutation capture, transport hooks, snapshots, redaction, bounded buffers, and export validity are diagnostic-only. The global capture listener is installed by name and removed during content-instance cleanup so reinjection cannot accumulate active listeners.

The source-ownership diagnostic build also records `handSourceTraces`, `handCommitTraces`, `handIdentityComparisons`, and `handLogDomMutationTraces`. These distinguish live WebSocket, initialization replay, current snapshot, Full Log first/lazy render, virtualized row remount, recycled row, container replacement, socket traffic while Hand Log is open, reconnect, storage restoration, and unknown sources. Every Full Log mutation trace records a rejected/no-attempt statistics decision. Installation counters are cumulative; the active observer count shows whether one observer is currently attached, so repeated Hand Log opens can be compared without changing hand accounting behavior.

To change level during development, open PokerNow DevTools, select the extension content-script execution context, and run:

```js
chrome.storage.local.set({ pokerNowHudDiagnosticsLevel: 'deep' });
```

Use `basic` or `off` to quiet it again. The isolated script relays the setting to MAIN world, so per-frame logging is disabled unless deep diagnostics are active. Visual debug preferences remain independent: identity labels, withheld placeholders, and deep anchor boxes.

## Refactor safety rules

1. Preserve manifest order and world boundaries.
2. Do not infer new meanings for minified fields during structural work.
3. Route production actions through `PokerLiveActionPipeline.handleMergedPatch` and `PokerActionInference.processTbPatch`.
4. Keep active events out of displayed statistics until commit.
5. Never replace global player/seat assignment with a greedy mapper.
6. Preserve player-relative drag offsets across rerenders and seat changes.
7. Run the fast suite after a focused extraction and the full suite before delivery.

## Deferred / Higher-Risk Optimization

These ideas are intentionally documented rather than changed in the current behavior-preserving pass:

- Split the large transport, merged-state, boundary, and inference coordinator functions in `content.js`. Their shared mutable ordering makes extraction a lifecycle risk without a dedicated equivalence harness.
- Collapse apparently overlapping lifecycle, recovery, or pause state. The states have different evidence owners and persistence rules, so consolidation requires a separately scoped redesign.
- Remove the initial snapshot clone/merge clone or otherwise change object identity in the hot path. Tests cover values, but not every consumer's identity assumption.
- Cache HUD root elements across renders. PokerNow and the extension can replace roots, so only within-call child lookups are currently cached.
- Change diagnostic timer registries or capture scheduling. This is bounded diagnostic behavior and should be addressed with timing-specific tests.
- Change storage schemas, keys, or restore ordering. Migration and cold-start ordering require a dedicated compatibility project.
- Remove legacy UI-click or incoming-lifecycle corroboration. Those paths are non-authoritative but remain valuable diagnostics and recovery evidence.

## Intentionally retained technical debt

- `content.js` remains large because transport coordination, seat discovery, Full Log diagnostics, and overlay DOM lifecycle share mutable browser state. Splitting those paths would be a riskier redesign.
- Full Log discovery and parsing remain for display/history diagnostics only; historical import is intentionally unsupported until it has a separate reconciliation design.
- Runtime guards remain duplicated across worlds for isolation and packaging resilience.
- Mock/all-time scaffolding remains; this cleanup neither implements all-time stats nor removes the original demo generator.
