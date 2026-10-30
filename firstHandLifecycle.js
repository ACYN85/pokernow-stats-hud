/* Startup frame gate and bounded first-hand lifecycle diagnostics. */
(function (root) {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function createTrace(state, startupType, details, timestamp) {
    var at = Number(timestamp || Date.now());
    var trace = {
      buildId: state.buildId,
      lobbySessionKey: state.lobbySessionKey,
      startupType: startupType,
      timestamps: { traceStartedAt: at },
      firstObservedHandId: null,
      previousHandId: null,
      initialization: [],
      stateSnapshots: [],
      activeHandCreation: [],
      boundaryDecisions: [],
      emittedEvents: [],
      stagedEvents: [],
      finalizedEvents: [],
      finalizationDecisions: [],
      dedupeState: [],
      mappingReadiness: [],
      statsIncrements: [],
      finalDisplayedHandCount: 0,
      records: []
    };
    state.currentTrace = trace;
    state.traces.push(trace);
    if (state.traces.length > 10) state.traces.shift();
    record(state, 'initialization', Object.assign({ event: 'trace started' }, details || {}), at);
    return trace;
  }

  function create(options) {
    options = options || {};
    var state = {
      buildId: String(options.buildId || 'unknown-build'),
      lobbySessionKey: String(options.lobbySessionKey || 'unknown-session'),
      ready: false,
      queuedFrames: [],
      traces: [],
      currentTrace: null
    };
    createTrace(state, options.startupType || 'cold-start', options.details || {}, options.startedAt);
    return state;
  }

  function record(state, category, details, timestamp) {
    if (!state || !state.currentTrace) return null;
    var trace = state.currentTrace;
    if (trace.completedAt) return null;
    var at = Number(timestamp || Date.now());
    var payload = clone(details || {});
    var entry = { timestamp: at, isoTime: new Date(at).toISOString(), category: category, details: payload };
    trace.records.push(entry);
    if (trace.records.length > 250) trace.records.shift();
    if (Array.isArray(trace[category])) {
      trace[category].push(entry);
      if (trace[category].length > 80) trace[category].shift();
    }
    if (payload && payload.handId && !trace.firstObservedHandId) trace.firstObservedHandId = String(payload.handId);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'previousHandId')) trace.previousHandId = payload.previousHandId === null || payload.previousHandId === undefined ? null : String(payload.previousHandId);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'displayedHands')) trace.finalDisplayedHandCount = Number(payload.displayedHands || 0);
    if (payload && payload.timestampName) trace.timestamps[String(payload.timestampName)] = at;
    if (payload && payload.traceComplete) {
      trace.completedAt = at;
      trace.timestamps.traceCompletedAt = at;
    }
    return entry;
  }

  function holdFrame(state, frame, timestamp) {
    if (!state || state.ready) return { queued: false, queuedCount: 0 };
    state.queuedFrames.push(frame);
    record(state, 'initialization', {
      event: 'websocket frame queued until storage initialization completes',
      frameId: frame && frame.frameId || null,
      direction: frame && frame.direction || null,
      queuedCount: state.queuedFrames.length,
      timestampName: state.queuedFrames.length === 1 ? 'firstFrameQueuedAt' : null
    }, timestamp);
    return { queued: true, queuedCount: state.queuedFrames.length };
  }

  function markReady(state, details, timestamp) {
    if (!state) return [];
    if (state.ready) return [];
    state.ready = true;
    var queued = state.queuedFrames.splice(0);
    record(state, 'initialization', Object.assign({
      event: 'storage initialization complete; queued frames released in capture order',
      queuedFrameCount: queued.length,
      timestampName: 'storageReadyAt'
    }, details || {}), timestamp);
    return queued;
  }

  function startResetTrace(state, details, timestamp) {
    if (!state) return null;
    return createTrace(state, 'reset-session', details || {}, timestamp);
  }

  function observedBlindPostingTransition(input) {
    input = input || {};
    var before = input.previous, current = input.current, patch = input.patch;
    function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
    function pair(value, a, b) { return Array.isArray(value) && value.length === 2 && value[0] === a && value[1] === b; }
    function id(value) { return typeof value === 'string' && value && value !== '<D>'; }
    function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
    // Source stacks may include uncollected wagers. A real zero-wager waiting
    // baseline followed by the two forced posts is independent deal evidence;
    // neither a stack deduction nor private hole-card access is required.
    if (input.eventName !== 'gC' || !object(before) || !object(current) || !object(patch) || patch.r ||
        !pair(before.gT, 0, 0) || !pair(current.gT, 1, 0) || !pair(patch.gT, 1, 0) ||
        !Array.isArray(before.iHPI) || before.iHPI.length || before.pot !== 0 || current.pot !== 0 ||
        !object(before.tB) || Object.keys(before.tB).length || !object(current.tB) || !object(patch.tB) ||
        !id(current.hI) || patch.hI !== current.hI || before.hI === current.hI ||
        !Number.isSafeInteger(current.gN) || current.gN < 1 ||
        !Array.isArray(patch.iHPI) || !Array.isArray(current.iHPI) || current.iHPI.length < 2 ||
        patch.iHPI.length !== current.iHPI.length || patch.iHPI.some(function (p, i) { return p !== current.iHPI[i]; }) ||
        !current.iHPI.every(id) || new Set(current.iHPI).size !== current.iHPI.length) return false;
    var smallId = current.sBPI, bigId = current.bBPI, small = current.tB[smallId], big = current.tB[bigId];
    if (!id(smallId) || !id(bigId) || smallId === bigId || !current.iHPI.includes(smallId) || !current.iHPI.includes(bigId) ||
        !positive(small) || !positive(big) || big < small ||
        Object.keys(current.tB).length !== 2 || Object.keys(patch.tB).length !== 2 || patch.tB[smallId] !== small || patch.tB[bigId] !== big ||
        current.smallBlind !== undefined && current.smallBlind !== small || current.bigBlind !== undefined && current.bigBlind !== big) return false;
    return { verified: true, source: 'observed waiting-to-forced-posts transition', smallBlindPlayerId: smallId, bigBlindPlayerId: bigId, smallBlind: small, bigBlind: big };
  }

  function evaluateColdStartBoundaryOverride(input) {
    input = input || {};
    var requiredConfidence = Number(input.requiredConfidence || 50);
    var verifiedPlayerIds = Array.isArray(input.verifiedPlayerIds) ? input.verifiedPlayerIds.map(String) : [];
    var inHandPlayerIds = Array.isArray(input.inHandPlayerIds) ? input.inHandPlayerIds.map(String) : [];
    function presentPlayer(value) {
      return value !== null && value !== undefined && value !== '' && value !== '<D>' && verifiedPlayerIds.includes(String(value));
    }
    var completeInHandList = inHandPlayerIds.length >= 2 && inHandPlayerIds.every(function (playerId) { return verifiedPlayerIds.includes(playerId); });
    var initialAcquisition = input.lifecycleAcquisitionPending === true ||
      input.startupType === 'cold-start' && input.noFinalizedHands === true && input.noPreviousHandCommitted === true;
    var forcedBlindDeal = input.forcedBlindDeal && input.forcedBlindDeal.verified === true;
    var completeDealSignature = initialAcquisition &&
      input.noActiveHand === true &&
      input.mappedPlayersVerified === true &&
      (input.holeCardsDetected === true || forcedBlindDeal) &&
      input.observedPreDealBaseline === true &&
      completeInHandList &&
      presentPlayer(input.smallBlindPlayerId) &&
      presentPlayer(input.bigBlindPlayerId) &&
      String(input.smallBlindPlayerId) !== String(input.bigBlindPlayerId) &&
      presentPlayer(input.currentPlayerId) &&
      presentPlayer(input.playerInTurnId);
    if (!completeDealSignature) return false;
    return {
      activated: true,
      lifecycleAcquisition: input.lifecycleAcquisitionPending === true,
      reason: (input.lifecycleAcquisitionPending === true ? 'verified deal signature after lifecycle rearm' : 'verified cold-start deal signature') + (forcedBlindDeal && !input.holeCardsDetected ? ' from observed forced posts' : ''),
      confidenceBeforeOverride: Number(input.confidenceBeforeOverride || 0),
      requiredConfidence: requiredConfidence,
      observedSignals: [
        input.lifecycleAcquisitionPending === true ? 'pending lifecycle boundary acquisition' : 'cold-start lifecycle',
        'no active hand',
        'mapped players verified',
        input.holeCardsDetected ? 'hole cards detected' : 'waiting baseline followed by verified forced-blind posts',
        'pre-deal baseline observed',
        'iHPI present',
        'sBPI present',
        'bBPI present',
        'cPI present',
        'pITT present'
      ].concat(Array.isArray(input.observedSignals) ? input.observedSignals.map(String) : [])
    };
  }

  function snapshot(state) {
    return state ? clone(state.traces) : [];
  }

  var api = Object.freeze({ create: create, record: record, holdFrame: holdFrame, markReady: markReady, startResetTrace: startResetTrace, observedBlindPostingTransition: observedBlindPostingTransition, evaluateColdStartBoundaryOverride: evaluateColdStartBoundaryOverride, snapshot: snapshot });
  root.PokerFirstHandLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
