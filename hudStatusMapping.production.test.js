'use strict';

var assert = require('assert');
var fs = require('fs');
var runtime = require('./hudRuntimeStatus.js');

function connectedState(condition) {
  var state = runtime.createState({ timestamp: 1 });
  runtime.reconcile(state, Object.assign({
    timestamp: 2,
    socketHookInstalled: true,
    socketHookStatusObserved: true,
    transportDisconnected: false,
    freshGameState: true,
    eligiblePlayerCount: 3,
    waitingToStart: false,
    gamePaused: false,
    gameStopped: false,
    gameBroken: false
  }, condition || {}));
  return state;
}

var active = connectedState({ tableStatus: 'inProgress', tableClassification: 'active' });
assert.strictEqual(active.displayedStatus, 'live');
assert.strictEqual(runtime.presentation(active.displayedStatus).label, 'Live');

var paused = connectedState({ tableStatus: 'paused', tableClassification: 'temporarily stopped', gamePaused: true });
assert.strictEqual(paused.displayedStatus, 'live-socket');
assert.strictEqual(runtime.presentation(paused.displayedStatus).label, 'Paused');

[
  { tableStatus: 'waitingForPlayer', tableClassification: 'waiting for player', waitingToStart: true },
  { tableStatus: 'stopped', tableClassification: 'temporarily stopped', gameStopped: true },
  { tableStatus: 'inProgress', tableClassification: 'broken heads-up game', gameBroken: true }
].forEach(function (condition) {
  var waiting = connectedState(condition);
  assert.strictEqual(waiting.displayedStatus, 'waiting');
  assert.strictEqual(runtime.presentation(waiting.displayedStatus).label, 'Waiting');
});

[active, paused, connectedState({ tableStatus: 'waitingForPlayer', tableClassification: 'waiting for player' })].forEach(function (state) {
  runtime.reconcile(state, { timestamp: 3, transportDisconnected: true });
  assert.strictEqual(state.displayedStatus, 'disconnected', 'disconnection outranks stale active, paused, or waiting lifecycle state');
  assert.strictEqual(runtime.presentation(state.displayedStatus).label, 'Disconnected');
});

var transitions = connectedState({ tableStatus: 'inProgress', tableClassification: 'active' });
assert.strictEqual(transitions.displayedStatus, 'live');
runtime.reconcile(transitions, { timestamp: 3, tableStatus: 'paused', tableClassification: 'temporarily stopped', gamePaused: true, gameStopped: false, gameBroken: false });
assert.strictEqual(transitions.displayedStatus, 'live-socket');
runtime.reconcile(transitions, { timestamp: 4, tableStatus: 'inProgress', tableClassification: 'active', gamePaused: false });
assert.strictEqual(transitions.displayedStatus, 'live');
runtime.reconcile(transitions, { timestamp: 5, tableStatus: 'waitingForPlayer', tableClassification: 'waiting for player', waitingToStart: true });
assert.strictEqual(transitions.displayedStatus, 'waiting');
runtime.reconcile(transitions, { timestamp: 6, tableStatus: 'inProgress', tableClassification: 'resumed', waitingToStart: false });
assert.strictEqual(transitions.displayedStatus, 'live');
var transitionsBeforeReplay = transitions.transitionCount;
var replay = runtime.reconcile(transitions, { timestamp: 7, tableStatus: 'inProgress', tableClassification: 'resumed', freshGameState: true });
assert.strictEqual(replay.changed, false);
assert.strictEqual(transitions.transitionCount, transitionsBeforeReplay, 'replayed identical state causes no status flicker');

var overlapping = connectedState({
  tableStatus: 'paused',
  tableClassification: 'broken heads-up game',
  gamePaused: true,
  gameBroken: true
});
assert.strictEqual(overlapping.displayedStatus, 'waiting', 'full break has precedence over pause');

var connecting = runtime.createState({ timestamp: 1 });
runtime.reconcile(connecting, { timestamp: 2, socketHookInstalled: true, socketHookStatusObserved: true, transportDisconnected: false });
assert.strictEqual(connecting.displayedStatus, 'initializing');
assert.strictEqual(runtime.presentation(connecting.displayedStatus).label, 'Connecting\u2026');
var unavailable = runtime.createState({ timestamp: 1 });
runtime.reconcile(unavailable, { timestamp: 2, socketHookInstalled: false, socketHookStatusObserved: true });
assert.strictEqual(unavailable.displayedStatus, 'disconnected');

var pureState = connectedState({ tableStatus: 'inProgress', tableClassification: 'active' });
var beforePureDerive = runtime.snapshot(pureState);
assert.strictEqual(runtime.derive(pureState, { tableStatus: 'paused', tableClassification: 'temporarily stopped', gamePaused: true }).status, 'live-socket');
assert.deepStrictEqual(runtime.snapshot(pureState), beforePureDerive, 'pure status selection cannot mutate lifecycle or socket state');

var runtimeSource = fs.readFileSync('./hudRuntimeStatus.js', 'utf8');
var contentSource = fs.readFileSync('./content.js', 'utf8');
assert.doesNotMatch(runtimeSource, /beginHand|commitHand|finalizeStatsHand|PokerStats|Full Log|consumeResumeBoundary/, 'status selection has no lifecycle/stat ownership');
assert.match(contentSource, /return PokerHudRuntimeStatus\.presentation\(status\)/, 'primary renderer uses the centralized presentation mapping');
assert.doesNotMatch(contentSource, /data\.liveSource === 'full-log' \? 'LIVE LOG'/, 'Full Log cannot replace the primary game-status label');
assert.match(contentSource, /socketHookStatusObserved: true/, 'hook availability is explicitly represented for status selection');

console.log('Primary HUD socket/game-status mapping and transition tests passed.');
