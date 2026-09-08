'use strict';

/*
 * Test-only replay seam for privacy-sanitized capture-derived preflop fixtures.
 * This utility is intentionally absent from manifest.json.
 */

var tbTrace = require('../tbTrace.js');
var liveActionPipeline = require('../liveActionPipeline.js');
var handFinalization = require('../handFinalization.js');
var semanticHandLedger = require('../semanticHandLedger.js');
var preflopOpportunityReducer = require('../preflopOpportunityReducer.js');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeIngress(rawPayload) {
  try {
    return tbTrace.decodeSocketIoEventFrame(rawPayload);
  } catch (_error) {
    return null;
  }
}

function phaseToStreet(gT) {
  var phase = Array.isArray(gT) ? Number(gT[1]) : NaN;
  if (phase === 0) return 'preflop';
  if (phase === 1) return 'flop';
  if (phase === 2) return 'turn';
  if (phase === 3) return 'river';
  if (phase === 5) return 'terminal';
  return 'unknown';
}

function authoritativeHandId(state) {
  return state && typeof state.hI === 'string' && state.hI !== '<D>'
    ? state.hI
    : null;
}

function participantIds(state) {
  var ids = new Set();
  (Array.isArray(state && state.iHPI) ? state.iHPI : []).forEach(function (id) {
    if (typeof id === 'string' && id !== '<D>') ids.add(id);
  });
  [state && state.sBPI, state && state.bBPI].forEach(function (id) {
    if (typeof id === 'string' && id !== '<D>') ids.add(id);
  });
  return Array.from(ids);
}

function addParticipants(state, handId, snapshot, timestamp) {
  participantIds(snapshot).forEach(function (playerId) {
    handFinalization.addParticipant(state, handId, {
      playerId: playerId,
      name: playerId,
      evidence: 'sanitized authoritative in-hand/blind identity',
      timestamp: timestamp
    });
  });
}

function stageInferredEvents(state, handId, inference, frameId) {
  var events = inference && inference.events || [];
  events.forEach(function (event, index) {
    handFinalization.stageEvent(state, {
      eventKey: [handId, frameId, index, event.playerId, event.action, event.amount].join('|'),
      handId: handId,
      playerId: event.playerId,
      player: event.playerId,
      action: event.action,
      street: event.street,
      amount: event.amount,
      timestamp: event.timestamp
    }, {
      playerId: event.playerId,
      reason: 'production live-action inference'
    });
  });
}

function isTerminalSettlement(state, patch) {
  return phaseToStreet(state && state.gT) === 'terminal' &&
    isObject(patch && patch.gameResult);
}

function createReplayState(targetHandId) {
  return {
    targetHandId: targetHandId,
    mergedState: null,
    priorAuthoritativeHandId: null,
    pipelineState: liveActionPipeline.createState({
      handId: targetHandId,
      street: 'preflop',
      schemaConfirmed: true
    }),
    finalizationState: handFinalization.createState({ finalizedEvents: [] }),
    ledgerState: semanticHandLedger.createState({
      maxRecords: 8,
      maxObservationsPerHand: 240,
      maxAttempts: 32
    }),
    reducerState: preflopOpportunityReducer.createState({
      maxRecords: 8,
      maxAttempts: 32,
      maxPlayers: 16
    }),
    ingress: {
      total: 0,
      decoded: 0,
      malformedOrControl: 0,
      unrelated: 0,
      stateFrames: 0
    },
    pipelineResults: [],
    commitResults: [],
    ledgerResults: [],
    reducerResults: [],
    finalizedRecords: [],
    contributions: []
  };
}

function processFrame(state, frame) {
  state.ingress.total += 1;
  var decoded = decodeIngress(frame.rawPayload);
  if (!decoded) {
    state.ingress.malformedOrControl += 1;
    return;
  }
  state.ingress.decoded += 1;

  var patch = null;
  var initialSnapshot = false;
  if (frame.direction === 'incoming' && decoded.eventName === 'registered' &&
      isObject(decoded.payload) && isObject(decoded.payload.gameState)) {
    patch = clone(decoded.payload.gameState);
    state.mergedState = clone(patch);
    initialSnapshot = true;
  } else if (frame.direction === 'incoming' && decoded.eventName === 'gC' &&
      isObject(decoded.payload)) {
    patch = clone(decoded.payload);
    state.mergedState = tbTrace.mergeSnapshot(state.mergedState, patch);
  } else {
    state.ingress.unrelated += 1;
    return;
  }
  state.ingress.stateFrames += 1;

  var current = clone(state.mergedState);
  var previous = initialSnapshot ? null : clone(state.previousMergedState);
  var currentHandId = authoritativeHandId(current);
  var previousHandId = state.priorAuthoritativeHandId;
  var timestamp = Number(frame.sequence) * 1000;
  var isNewHand = Boolean(currentHandId && currentHandId !== previousHandId);
  var pipelineResult = liveActionPipeline.handleMergedPatch(
    state.pipelineState,
    previous,
    current,
    {
      recordId: frame.sequence,
      timestamp: timestamp,
      incomingPatch: patch,
      handId: currentHandId,
      street: phaseToStreet(current.gT),
      newHand: isNewHand
    }
  );
  state.pipelineResults.push(pipelineResult);

  if (currentHandId === state.targetHandId) {
    if (!state.finalizationState.stagedHands[currentHandId] &&
        !state.finalizationState.finalizedHandIds.has(currentHandId)) {
      handFinalization.beginHand(state.finalizationState, currentHandId, {
        timestamp: timestamp,
        activate: true
      });
      addParticipants(state.finalizationState, currentHandId, current, timestamp);
    }
    if (state.finalizationState.stagedHands[currentHandId]) {
      addParticipants(state.finalizationState, currentHandId, current, timestamp);
      stageInferredEvents(
        state.finalizationState,
        currentHandId,
        pipelineResult.inference,
        frame.sequence
      );
    }

    semanticHandLedger.observe(state.ledgerState, {
      handId: currentHandId,
      authoritativeHandId: currentHandId,
      previousHandId: previousHandId === currentHandId ? currentHandId : null,
      previousAuthoritativeHandId: previousHandId,
      sameHand: previousHandId === currentHandId,
      frameId: frame.sequence,
      timestamp: timestamp,
      eventName: decoded.eventName,
      previousState: previous,
      currentState: current,
      patch: patch,
      recovered: false,
      historyComplete: true
    });

    if (isTerminalSettlement(current, patch)) {
      var commit = handFinalization.commitHand(
        state.finalizationState,
        currentHandId,
        'authoritative terminal settlement',
        timestamp
      );
      state.commitResults.push(commit);
      if (commit.committed || commit.duplicate) {
        var ledgerResult = semanticHandLedger.finalize(
          state.ledgerState,
          currentHandId,
          {
            reason: 'authoritative terminal settlement',
            nextAuthoritativeHandId: null,
            timestamp: timestamp,
            fallbackHand: commit.hand || null
          }
        );
        state.ledgerResults.push(ledgerResult);
        if (ledgerResult.finalized) {
          state.finalizedRecords.push(ledgerResult.record);
          var reduced = preflopOpportunityReducer.reduce(
            state.reducerState,
            ledgerResult.record
          );
          state.reducerResults.push(reduced);
          if (reduced.reduced) state.contributions.push(reduced.contribution);
        }
      }
    }
  }

  state.previousMergedState = current;
  if (currentHandId) state.priorAuthoritativeHandId = currentHandId;
}

function replayFixture(fixture, options) {
  options = options || {};
  if (!fixture || !fixture.scenario || !Array.isArray(fixture.frames)) {
    throw new TypeError('A sanitized authoritative fixture is required.');
  }
  var state = createReplayState(fixture.scenario.targetHandId);
  var frames = fixture.frames.slice();
  if (options.prefixNoise) {
    frames.unshift(
      { sequence: -2, direction: 'incoming', rawPayload: '2' },
      { sequence: -1, direction: 'incoming', rawPayload: '42[not-json' },
      { sequence: 0, direction: 'incoming', rawPayload: '42["unrelated",{"safe":true}]' }
    );
  }
  if (options.duplicateTerminal) {
    var terminal = frames.find(function (frame) {
      var decoded = decodeIngress(frame.rawPayload);
      var payload = decoded && decoded.eventName === 'gC' ? decoded.payload : null;
      return payload && isObject(payload.gameResult);
    });
    if (terminal) {
      var insertionIndex = frames.indexOf(terminal) + 1;
      frames.splice(insertionIndex, 0, Object.assign({}, terminal, {
        sequence: Number(terminal.sequence) + 0.5
      }));
    }
  }
  frames.forEach(function (frame) { processFrame(state, frame); });
  return {
    ingress: clone(state.ingress),
    pipelineResults: state.pipelineResults,
    commitResults: clone(state.commitResults),
    ledgerResults: clone(state.ledgerResults),
    reducerResults: clone(state.reducerResults),
    finalizedRecords: clone(state.finalizedRecords),
    contributions: clone(state.contributions),
    finalizationInspection: {
      finalizedHandIds: Array.from(state.finalizationState.finalizedHandIds),
      finalizedEvents: clone(state.finalizationState.finalizedEvents)
    },
    ledgerInspection: semanticHandLedger.inspect(state.ledgerState),
    reducerInspection: preflopOpportunityReducer.inspect(state.reducerState)
  };
}

module.exports = Object.freeze({
  decodeIngress: decodeIngress,
  replayFixture: replayFixture
});
