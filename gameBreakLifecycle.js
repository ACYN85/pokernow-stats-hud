/* Scoped stopped-game/resumption epoch ownership and diagnostics. */
(function (root) {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function createState(options) {
    options = options || {};
    return {
      buildId: String(options.buildId || 'unknown-build'),
      gameSessionKey: String(options.gameSessionKey || 'unknown-session'),
      traceSequence: 0,
      breakEpoch: 0,
      breakOpen: false,
      resumeObservationRemaining: 0,
      resumeDealFingerprints: new Set(),
      resumeEpoch: null,
      lastSnapshot: null,
      preBreakBaseline: null,
      postReturnWaitingBaseline: null,
      initialAuthoritativeLifecycle: null,
      traces: []
    };
  }

  function append(state, kind, input) {
    var timestamp = Number(input && input.timestamp || Date.now());
    var trace = Object.assign({
      traceId: 'game-break-' + (++state.traceSequence),
      kind: kind,
      timestamp: timestamp,
      isoTime: new Date(timestamp).toISOString(),
      buildId: state.buildId,
      gameSessionKey: state.gameSessionKey,
      breakEpoch: state.breakEpoch
    }, clone(input || {}));
    state.traces.push(trace);
    if (state.traces.length > 600) state.traces.shift();
    return trace;
  }

  function classificationFlags(classification) {
    return {
      active: classification === 'active',
      temporarilyStopped: classification === 'temporarily stopped',
      waitingForPlayer: classification === 'waiting for player',
      brokenHeadsUpGame: classification === 'broken heads-up game',
      resumed: classification === 'resumed'
    };
  }

  function recordSnapshot(state, input) {
    input = input || {};
    var normalizedLifecycle = input.normalizedLifecycle || {};
    var normalizedClassification = String(normalizedLifecycle.classification || '').toLowerCase();
    var normalizedInactive = /^(?:paused|stopped|broken|waiting)$/.test(normalizedClassification);
    var normalizedActive = normalizedClassification === 'active';
    var activeCount = Number(input.activeInGamePlayerCount || 0);
    var occupiedCount = Number(input.occupiedSeatCount || 0);
    var hasActiveHand = Boolean(input.activeHand && input.activeHand.handId || input.activeHandId);
    var inDeal = hasActiveHand || Number(input.holeCardCount || 0) > 0 || (input.inHandPlayerIds || []).length >= 2;
    var tableStatus = String(input.currentTableStatus || '').toLowerCase();
    var statusSaysWaiting = normalizedInactive || /waiting|paused|stopped|break|need.*player|not.*enough/.test(tableStatus) ||
      input.waitingToStart === true || input.gamePaused === true || input.gameStopped === true || input.gameBroken === true;
    var belowMinimum = activeCount < 2;
    var prior = state.lastSnapshot;
    var priorEligiblePlayerIds = prior ? (prior.playerStatuses || []).filter(function (player) {
      return player.mapped && player.activeInGame;
    }).map(function (player) { return String(player.playerId); }) : [];
    var breakEpochBefore = state.breakEpoch;
    var genuineHeadsUpBreak = priorEligiblePlayerIds.length === 2 && belowMinimum && statusSaysWaiting;
    var startedBreak = !state.breakOpen && !hasActiveHand && input.priorHandResolved === true && genuineHeadsUpBreak && Boolean(prior && (prior.dealingPossible || prior.classification === 'active'));
    var initialReloadBreak = !prior &&
      input.initialAuthoritativeSnapshot === true &&
      input.storageHydrationComplete === true &&
      !hasActiveHand &&
      normalizedInactive &&
      normalizedClassification !== 'paused' &&
      (input.cleanPreDealBaseline === true || normalizedLifecycle.confidence === 'authoritative');
    if (startedBreak || initialReloadBreak) {
      var baselinePlayerIds = initialReloadBreak
        ? (input.playerStatuses || []).filter(function (player) { return player.mapped && player.occupied; }).map(function (player) { return String(player.playerId); })
        : priorEligiblePlayerIds;
      state.breakEpoch += 1;
      state.breakOpen = true;
      state.resumeObservationRemaining = 2;
      state.resumeDealFingerprints = new Set();
      state.preBreakBaseline = clone(prior && prior.currentBoundaryBaseline || null);
      state.postReturnWaitingBaseline = null;
      state.resumeEpoch = {
        breakEpoch: state.breakEpoch,
        armed: true,
        consumed: false,
        armedAt: Number(input.timestamp || Date.now()),
        consumedAt: null,
        source: initialReloadBreak ? 'reload-broken-baseline' : 'observed-active-to-break-transition',
        expectedPlayerIds: baselinePlayerIds.slice().sort(),
        terminalDealFingerprint: String(input.currentDealFingerprint || ''),
        normalizedBaseline: {
          holeCardCount: 0,
          holeCardCollections: [],
          inHandPlayerIds: [],
          smallBlindPlayerId: null,
          bigBlindPlayerId: null,
          currentPlayerId: null,
          playerInTurnId: null,
          dealerOrButton: null,
          tB: {},
          settlementPresent: false
        },
        observedSignals: initialReloadBreak ? [
          'storage hydration completed before authoritative frames were released',
          'first authoritative snapshot after reload was waiting/stopped/broken',
          'no persisted active hand was eligible for recovery',
          input.cleanPreDealBaseline === true ? 'clean pre-deal break baseline observed' : 'authoritative break status superseded stale terminal deal fields',
          'reload break baseline cannot recover or commit a stale hand'
        ] : [
          'verified heads-up game transitioned from active to waiting/stopped',
          'eligible active-player count fell below two',
          'no active hand exists',
          'prior hand was finalized or terminal settlement was observed'
        ]
      };
    }

    var classification = 'temporarily stopped';
    if (normalizedClassification === 'broken' || belowMinimum && occupiedCount >= 2) classification = 'broken heads-up game';
    else if (belowMinimum) classification = 'waiting for player';
    else if (statusSaysWaiting) classification = 'temporarily stopped';
    else if (normalizedActive || inDeal) classification = state.breakOpen ? 'resumed' : 'active';
    else if (state.breakOpen && input.cleanPreDealBaseline) classification = 'waiting for player';
    else if (input.dealingPossible) classification = 'active';
    var gameBreakToActiveDetected = Boolean(
      state.breakOpen &&
      prior &&
      /temporarily stopped|waiting for player|broken heads-up game/.test(String(prior.classification || '')) &&
      (classification === 'resumed' || classification === 'active')
    );
    if (!state.initialAuthoritativeLifecycle && input.initialAuthoritativeSnapshot === true) {
      state.initialAuthoritativeLifecycle = {
        timestamp: Number(input.timestamp || Date.now()),
        classification: classification,
        normalizedClassification: normalizedClassification || null,
        breakInitializedFromReload: initialReloadBreak,
        cleanPreDealBaseline: Boolean(input.cleanPreDealBaseline),
        activeHandId: input.activeHandId || null
      };
    }

    if (state.breakOpen && activeCount >= 2 && input.cleanPreDealBaseline && !state.postReturnWaitingBaseline) {
      state.postReturnWaitingBaseline = clone(input.currentBoundaryBaseline || null);
    }

    var trace = append(state, 'game-break-state', Object.assign({}, input, {
      classification: classification,
      classificationFlags: classificationFlags(classification),
      verifiedInactiveReason: belowMinimum ? 'insufficient eligible players' : (normalizedInactive ? normalizedLifecycle.reason : (statusSaysWaiting ? 'authoritative paused/stopped/waiting indicator' : null)),
      verifiedActiveReason: classification === 'active' || classification === 'resumed' ? (normalizedActive ? normalizedLifecycle.reason : (inDeal ? 'verified deal state' : 'eligible table is actively dealing')) : null,
      breakStartedOnThisSnapshot: startedBreak || initialReloadBreak,
      breakInitializedFromReload: initialReloadBreak,
      initialAuthoritativeSnapshot: Boolean(input.initialAuthoritativeSnapshot),
      storageHydrationComplete: Boolean(input.storageHydrationComplete),
      gameBreakToActiveDetected: gameBreakToActiveDetected,
      previousLifecycleState: prior && prior.classification || null,
      newLifecycleState: classification,
      previousEpoch: breakEpochBefore,
      newEpoch: state.breakEpoch,
      breakOpen: state.breakOpen,
      resumeObservationRemaining: state.resumeObservationRemaining,
      resumeEpoch: clone(state.resumeEpoch),
      initialAuthoritativeLifecycle: clone(state.initialAuthoritativeLifecycle),
      preBreakBaseline: clone(state.preBreakBaseline),
      postReturnWaitingBaseline: clone(state.postReturnWaitingBaseline)
    }));
    state.lastSnapshot = clone(trace);
    return trace;
  }

  function recordBoundaryEvaluation(state, input) {
    input = input || {};
    var fingerprint = String(input.dealFingerprint || '');
    var belongsToResumeEpoch = state.breakOpen || state.resumeObservationRemaining > 0;
    var completeDeal = input.completeDealSignature === true;
    var newResumeDeal = belongsToResumeEpoch && completeDeal && fingerprint && !state.resumeDealFingerprints.has(fingerprint);
    if (newResumeDeal) {
      state.resumeDealFingerprints.add(fingerprint);
      state.resumeObservationRemaining = Math.max(0, state.resumeObservationRemaining - 1);
    }
    var resumeDealOrdinal = newResumeDeal ? state.resumeDealFingerprints.size : null;
    var trace = append(state, 'resume-boundary-evaluation', Object.assign({}, input, {
      belongsToResumeEpoch: belongsToResumeEpoch,
      resumeDealOrdinal: resumeDealOrdinal,
      resumeObservationRemainingBeforeResult: state.resumeObservationRemaining,
      preBreakBaseline: clone(state.preBreakBaseline),
      postReturnWaitingBaseline: clone(state.postReturnWaitingBaseline)
    }));
    return trace;
  }

  function evaluateResumeBoundary(state, input) {
    input = input || {};
    var epoch = state && state.resumeEpoch;
    if (!epoch || !epoch.armed || epoch.consumed) return false;
    var reloadBreakEpoch = epoch.source === 'reload-broken-baseline';
    var expected = (epoch.expectedPlayerIds || []).map(String).sort();
    var recovered = (input.recoveredEligiblePlayerIds || []).map(String).sort();
    var inHand = (input.inHandPlayerIds || []).map(String);
    var mapped = (input.mappedPlayerIds || []).map(String);
    var holeCardPlayers = (input.holeCardPlayerIds || []).map(String);
    var smallBlind = input.smallBlindPlayerId === null || input.smallBlindPlayerId === undefined ? null : String(input.smallBlindPlayerId);
    var bigBlind = input.bigBlindPlayerId === null || input.bigBlindPlayerId === undefined ? null : String(input.bigBlindPlayerId);
    var actorIds = [input.currentPlayerId, input.playerInTurnId].filter(function (value) { return value !== null && value !== undefined && value !== '' && value !== '<D>'; }).map(String);
    var verifiedCurrentDealIds = inHand.filter(function (id) { return recovered.includes(id) && mapped.includes(id); });
    var checks = {
      armedVerifiedBreakEpoch: true,
      noActiveHand: input.noActiveHand === true,
      twoExpectedPlayers: expected.length === 2,
      eligibleDealSetValid: reloadBreakEpoch ? inHand.length >= 2 && verifiedCurrentDealIds.length === inHand.length : expected.length === 2,
      expectedPlayersRecovered: reloadBreakEpoch
        ? inHand.length >= 2 && verifiedCurrentDealIds.length === inHand.length
        : expected.length === 2 && expected.every(function (id) { return recovered.includes(id) && mapped.includes(id); }),
      currentInHandListVerified: reloadBreakEpoch
        ? inHand.length >= 2 && inHand.every(function (id) { return mapped.includes(id); })
        : expected.length === 2 && expected.every(function (id) { return inHand.includes(id); }),
      blindIdentitiesValid: Boolean(smallBlind && bigBlind && smallBlind !== bigBlind &&
        (reloadBreakEpoch ? inHand.includes(smallBlind) && inHand.includes(bigBlind) : expected.includes(smallBlind) && expected.includes(bigBlind))),
      actorIdentityValid: actorIds.some(function (id) {
        return inHand.includes(id) && (reloadBreakEpoch || expected.includes(id));
      }),
      currentHoleCardsPresent: holeCardPlayers.some(function (id) {
        return inHand.includes(id) && mapped.includes(id) && (reloadBreakEpoch || expected.includes(id));
      }),
      blindCommitmentsValid: input.blindCommitmentsValid !== false,
      dealSpecificTransitionObserved: input.dealSpecificTransitionObserved === true,
      tableActiveOrVerifiedDeal: input.tableActive === true || input.verifiedDealStarted === true,
      lifecycleTransitionVerified: reloadBreakEpoch ? input.lifecycleTransitionVerified === true : true,
      fingerprintChangedFromTerminal: Boolean(input.currentDealFingerprint && String(input.currentDealFingerprint) !== String(epoch.terminalDealFingerprint || ''))
    };
    var requiredChecks = Object.keys(checks).filter(function (key) {
      return !(reloadBreakEpoch && key === 'twoExpectedPlayers');
    });
    var missing = requiredChecks.filter(function (key) { return checks[key] !== true; });
    var activated = missing.length === 0;
    return {
      activated: activated,
      reason: activated
        ? (reloadBreakEpoch ? 'verified first deal after a reload-initialized game-break epoch' : 'verified first deal after a stopped heads-up epoch')
        : 'resume deal signature incomplete: ' + missing.join(', '),
      breakEpoch: epoch.breakEpoch,
      epochSource: epoch.source,
      confidenceBeforeOverride: Number(input.confidenceBeforeOverride || 0),
      requiredConfidence: Number(input.requiredConfidence || 50),
      observedSignals: epoch.observedSignals.concat((input.observedSignals || []).map(String)),
      normalizedBaseline: clone(epoch.normalizedBaseline),
      currentDealFingerprint: String(input.currentDealFingerprint || ''),
      terminalDealFingerprint: String(epoch.terminalDealFingerprint || ''),
      expectedPlayerIds: expected,
      checks: checks,
      missingRequirements: missing
    };
  }

  function consumeResumeBoundary(state, evaluation, timestamp) {
    if (!state || !state.resumeEpoch || !evaluation || evaluation.activated !== true) return false;
    var epoch = state.resumeEpoch;
    if (!epoch.armed || epoch.consumed || Number(evaluation.breakEpoch) !== Number(epoch.breakEpoch)) return false;
    if (String(evaluation.currentDealFingerprint || '') === String(epoch.terminalDealFingerprint || '')) return false;
    epoch.consumed = true;
    epoch.consumedAt = Number(timestamp || Date.now());
    epoch.currentDealFingerprint = String(evaluation.currentDealFingerprint || '');
    state.breakOpen = false;
    return true;
  }

  function closeEpochFromOrdinaryBoundary(state, currentDealFingerprint, timestamp) {
    if (!state || !state.resumeEpoch || !state.resumeEpoch.armed || state.resumeEpoch.consumed) return false;
    var fingerprint = String(currentDealFingerprint || '');
    if (!fingerprint || fingerprint === String(state.resumeEpoch.terminalDealFingerprint || '')) return false;
    state.resumeEpoch.consumed = true;
    state.resumeEpoch.consumedAt = Number(timestamp || Date.now());
    state.resumeEpoch.currentDealFingerprint = fingerprint;
    state.resumeEpoch.consumedReason = 'ordinary boundary accepted before resume override was needed';
    state.breakOpen = false;
    return true;
  }

  function recordSettlementEvaluation(state, input) {
    return append(state, 'settlement-evaluation', Object.assign({}, input || {}, {
      preBreakBaseline: clone(state.preBreakBaseline),
      postReturnWaitingBaseline: clone(state.postReturnWaitingBaseline)
    }));
  }

  function completeSettlementEvaluation(state, traceId, result) {
    var trace = state.traces.find(function (candidate) { return candidate.traceId === traceId; });
    if (!trace) return null;
    trace.finalization = clone(result || {});
    return trace;
  }

  function snapshot(state) {
    return state ? clone(state.traces) : [];
  }

  var api = Object.freeze({
    createState: createState,
    recordSnapshot: recordSnapshot,
    recordBoundaryEvaluation: recordBoundaryEvaluation,
    evaluateResumeBoundary: evaluateResumeBoundary,
    consumeResumeBoundary: consumeResumeBoundary,
    closeEpochFromOrdinaryBoundary: closeEpochFromOrdinaryBoundary,
    recordSettlementEvaluation: recordSettlementEvaluation,
    completeSettlementEvaluation: completeSettlementEvaluation,
    snapshot: snapshot
  });
  root.PokerGameBreakLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
