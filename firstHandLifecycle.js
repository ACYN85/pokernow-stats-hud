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
    var completeDealSignature = initialAcquisition &&
      input.noActiveHand === true &&
      input.mappedPlayersVerified === true &&
      input.holeCardsDetected === true &&
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
      reason: input.lifecycleAcquisitionPending === true ? 'verified deal signature after lifecycle rearm' : 'verified cold-start deal signature',
      confidenceBeforeOverride: Number(input.confidenceBeforeOverride || 0),
      requiredConfidence: requiredConfidence,
      observedSignals: [
        input.lifecycleAcquisitionPending === true ? 'pending lifecycle boundary acquisition' : 'cold-start lifecycle',
        'no active hand',
        'mapped players verified',
        'hole cards detected',
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

  var api = Object.freeze({ create: create, record: record, holdFrame: holdFrame, markReady: markReady, startResetTrace: startResetTrace, evaluateColdStartBoundaryOverride: evaluateColdStartBoundaryOverride, snapshot: snapshot });
  root.PokerFirstHandLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
