'use strict';

var assert = require('assert');
var fs = require('fs');
var tbTrace = require('./tbTrace.js');
var lifecycleSignal = require('./pokerNowLifecycleSignal.js');
var hostControl = require('./hostControlTrace.js');
var runtime = require('./hudRuntimeStatus.js');
var hands = require('./handFinalization.js');

function activeState() {
  var state = runtime.createState({ timestamp: 1 });
  runtime.reconcile(state, {
    timestamp: 2,
    socketHookInstalled: true,
    socketHookStatusObserved: true,
    transportDisconnected: false,
    freshGameState: true,
    tableStatus: 'inProgress',
    tableClassification: 'active',
    eligiblePlayerCount: 3,
    gamePaused: false,
    gameStopped: false,
    gameBroken: false,
    waitingToStart: false
  });
  return state;
}

function applyControl(state, signal, timestamp) {
  return runtime.reconcile(state, {
    timestamp: timestamp,
    tableClassification: signal.classification === 'paused' ? 'paused' : 'resumed',
    lifecycleConfidence: signal.confidence,
    lifecycleEvidence: { authoritativeSocketControl: signal },
    gamePaused: signal.classification === 'paused',
    authoritativePauseState: signal.classification,
    authoritativePauseEvidence: signal,
    freshGameState: true
  });
}

var pausePacket = tbTrace.decodeSocketIoEventFrame(
  '42["tableLifecycle",{"message":"The room owner paused the game.","status":"inProgress"}]'
);
var pauseSignal = lifecycleSignal.authoritativeControl(pausePacket.eventName, pausePacket.payload, 'incoming');
assert.ok(pauseSignal, 'the incoming room-owner lifecycle notification is retained independently of poker actions');
assert.strictEqual(pauseSignal.classification, 'paused');
assert.strictEqual(pauseSignal.confidence, 'authoritative');
assert.deepStrictEqual(pauseSignal.evidencePaths, ['$.message']);
assert.strictEqual(lifecycleSignal.authoritativeControl('action', { type: 'CALL' }, 'incoming'), null, 'ordinary poker actions cannot become lifecycle controls');
assert.strictEqual(lifecycleSignal.authoritativeControl('tableLifecycle', pausePacket.payload, 'outgoing'), null, 'remote lifecycle normalization only owns server-relayed frames');

var live = activeState();
assert.strictEqual(live.displayedStatus, 'live', 'connected active game is Live');
assert.strictEqual(applyControl(live, pauseSignal, 3).status, 'live-socket', 'authoritative room-owner pause displays Paused');

var transitionCountAfterPause = live.transitionCount;
for (var trafficIndex = 0; trafficIndex < 3; trafficIndex += 1) {
  assert.strictEqual(runtime.reconcile(live, {
    timestamp: 4 + trafficIndex,
    freshGameState: true,
    tableStatus: 'inProgress',
    tableClassification: 'active',
    eligiblePlayerCount: 3,
    gamePaused: false,
    lifecycleEvidence: {
      staleDealFields: {
        iHPI: ['P1', 'P2', 'P3'],
        cards: ['SYNTHETIC_CARD_1', 'SYNTHETIC_CARD_2'],
        dealerID: 'P1',
        sBPI: 'P2',
        bBPI: 'P3'
      }
    }
  }).status, 'live-socket', 'ordinary game-state traffic and stale deal fields cannot clear verified pause');
}
assert.strictEqual(live.transitionCount, transitionCountAfterPause, 'duplicate and activity frames do not flicker the paused status');

var localTrace = hostControl.createState();
var localPause = hostControl.record(localTrace, {
  frameId: 'local-pause',
  direction: 'outgoing',
  eventName: 'action',
  payload: { type: 'UP' },
  localUserPlayerId: 'owner-1',
  tableOwnerPlayerId: 'owner-1'
});
assert.strictEqual(localPause.recognizedCommand, 'pause');
var localPauseApplication = hostControl.applyRecognizedCommand(localTrace, localPause, 3);
var local = activeState();
assert.strictEqual(runtime.reconcile(local, {
  timestamp: 3,
  tableClassification: 'paused',
  gamePaused: true,
  authoritativePauseState: localPauseApplication.nextState,
  authoritativePauseEvidence: localPauseApplication.evidence,
  localLifecycleCommand: localTrace.activeLocalCommand
}).status, 'live-socket', 'verified outgoing owner UP uses the authoritative paused presentation');

var reload = runtime.createState({ timestamp: 10 });
runtime.reconcile(reload, {
  timestamp: 11,
  socketHookInstalled: true,
  socketHookStatusObserved: true,
  transportDisconnected: false
});
assert.strictEqual(reload.displayedStatus, 'initializing', 'reload waits for authoritative hydration');
applyControl(reload, pauseSignal, 12);
assert.strictEqual(reload.displayedStatus, 'live-socket', 'an incoming authoritative pause control resolves reconnect state directly');
runtime.reconcile(reload, {
  timestamp: 13,
  freshGameState: true,
  tableStatus: 'inProgress',
  tableClassification: 'active',
  eligiblePlayerCount: 3,
  gamePaused: false
});
assert.strictEqual(reload.displayedStatus, 'live-socket', 'authoritative paused hydration wins over cached inProgress state');

var resumePacket = tbTrace.decodeSocketIoEventFrame(
  '42["tableLifecycle",{"message":"The room owner resumed the game.","status":"inProgress"}]'
);
var resumeSignal = lifecycleSignal.authoritativeControl(resumePacket.eventName, resumePacket.payload, 'incoming');
assert.ok(resumeSignal);
assert.strictEqual(resumeSignal.classification, 'resumed');
assert.strictEqual(applyControl(live, resumeSignal, 20).status, 'live', 'verified authoritative resume clears the paused latch');

applyControl(live, pauseSignal, 21);
assert.strictEqual(runtime.reconcile(live, {
  timestamp: 22,
  tableStatus: 'stopped',
  tableClassification: 'broken heads-up game',
  gamePaused: false,
  gameStopped: true,
  gameBroken: true,
  freshGameState: true
}).status, 'waiting', 'a full break remains higher precedence than pause');
runtime.reconcile(live, { timestamp: 23, transportDisconnected: true });
assert.strictEqual(live.displayedStatus, 'disconnected', 'disconnect remains higher precedence than paused/broken state');
runtime.reconcile(live, { timestamp: 24, transportDisconnected: false, socketHookInstalled: true });
assert.strictEqual(live.displayedStatus, 'initializing', 'reconnect remains Connecting until fresh authoritative state arrives');

['live', 'live-socket', 'waiting', 'disconnected', 'initializing'].forEach(function (status) {
  var presentation = runtime.presentation(status);
  assert.ok(presentation.label);
  assert.ok(presentation.note);
});
assert.strictEqual(runtime.presentation('live-socket').label, 'Paused');
assert.match(runtime.presentation('live-socket').note, /paused/i);
assert.doesNotMatch(runtime.presentation('live-socket').note, /actively running/i);

var accounting = hands.createState({ finalizedEvents: [] });
hands.beginHand(accounting, 'H-PAUSE-SAFETY', { activate: true, timestamp: 1 });
hands.addParticipant(accounting, 'H-PAUSE-SAFETY', { playerId: 'P1', name: 'one', evidence: 'fixture', timestamp: 1 });
var accountingBefore = JSON.stringify(hands.serializeActiveHand(accounting));
var finalizedBefore = accounting.finalizedEvents.length;
applyControl(activeState(), pauseSignal, 30);
assert.strictEqual(JSON.stringify(hands.serializeActiveHand(accounting)), accountingBefore, 'status selection cannot mutate the active hand');
assert.strictEqual(accounting.finalizedEvents.length, finalizedBefore, 'status selection cannot commit statistics');

var content = fs.readFileSync('./content.js', 'utf8');
var persistStart = content.indexOf('function persistRecognizedHostCommand');
var persistEnd = content.indexOf('function recordOutgoingHostControl', persistStart);
var persistFunction = content.slice(persistStart, persistEnd);
assert.ok(persistStart >= 0 && persistEnd > persistStart);
assert.ok(persistFunction.indexOf('reconcileHudRuntimeStatus({') < persistFunction.indexOf('if (active) {'), 'a valid host Pause updates runtime status before optional hand metadata persistence');
assert.ok(persistFunction.includes('else persistHostControlState(completePersistence)'), 'authoritative Pause persists independently between hands');
assert.ok(content.includes('reconcileAuthoritativeSocketLifecycleControl(frame, packet)'), 'incoming room-owner controls reach the same runtime mapper');
assert.ok(content.includes('[HUD PAUSE STATUS TRACE]'), 'gated production pause diagnostics are installed');
assert.ok(content.includes('pauseStatusTraces: cloneJson(pauseStatusTraces)'), 'Copy Diagnostics includes bounded pause status records');
assert.ok(content.includes('var presentation = hudRuntimePresentation(result.status)'), 'badge and footer trace the same centralized presentation');

console.log('Production authoritative pause propagation, latch precedence, reload, rendering, and side-effect tests passed.');
