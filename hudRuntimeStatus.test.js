'use strict';

var assert = require('assert');
var runtime = require('./hudRuntimeStatus.js');

function activePatch(state, timestamp, overrides) {
  return runtime.reconcile(state, Object.assign({
    timestamp: timestamp,
    tableStatus: 'inProgress',
    tableClassification: 'active',
    eligiblePlayerCount: 2,
    socketHookInstalled: true,
    framesCaptured: 10,
    packetsDecoded: 7,
    gameStatePatchesMerged: 3,
    freshGameState: true,
    activeHandPresent: false
  }, overrides || {}));
}

function waitingPatch(state, timestamp, overrides) {
  return runtime.reconcile(state, Object.assign({
    timestamp: timestamp,
    tableStatus: 'waitingForPlayer',
    tableClassification: 'waiting for player',
    eligiblePlayerCount: 1,
    socketHookInstalled: true,
    freshGameState: true,
    activeHandPresent: false
  }, overrides || {}));
}

function pausedPatch(state, timestamp, overrides) {
  return runtime.reconcile(state, Object.assign({
    timestamp: timestamp,
    tableStatus: 'paused',
    tableClassification: 'temporarily stopped',
    gamePaused: true,
    gameStopped: false,
    gameBroken: false,
    waitingToStart: false,
    eligiblePlayerCount: 2,
    socketHookInstalled: true,
    freshGameState: true,
    activeHandPresent: true
  }, overrides || {}));
}

var activeColdLoad = runtime.createState({ timestamp: 1 });
assert.strictEqual(activePatch(activeColdLoad, 2).status, 'live', 'active cold load becomes Live');
assert.strictEqual(activeColdLoad.activeHandPresent, false, 'an active hand is not required for live status');
assert.strictEqual(activePatch(activeColdLoad, 3, { activeHandPresent: false }).status, 'live', 'between hands remains Live');

var lifecycleTransitions = runtime.createState({ timestamp: 10 });
assert.strictEqual(pausedPatch(lifecycleTransitions, 11).status, 'live-socket', 'paused cold load with a connected socket shows Paused');
assert.strictEqual(runtime.reconcile(lifecycleTransitions, { timestamp: 12, framesCaptured: 30, packetsDecoded: 20 }).status, 'live-socket', 'tracking counters alone do not change the paused presentation');
assert.strictEqual(activePatch(lifecycleTransitions, 13, { tableClassification: 'resumed', gamePaused: false }).status, 'live', 'fresh verified resume changes Paused to Live');
assert.strictEqual(activePatch(lifecycleTransitions, 14, { activeHandPresent: false }).status, 'live', 'absence of activeHand between hands does not force Waiting');
assert.strictEqual(pausedPatch(lifecycleTransitions, 15).status, 'live-socket', 'active to paused changes Live to Paused');
assert.strictEqual(waitingPatch(lifecycleTransitions, 16, { tableStatus: 'stopped', tableClassification: 'broken heads-up game', gamePaused: false, gameStopped: true }).status, 'waiting', 'paused or active to break changes the label to Waiting');
assert.strictEqual(activePatch(lifecycleTransitions, 17, { tableClassification: 'resumed', gameStopped: false, waitingToStart: false }).status, 'live', 'break to active changes Waiting to Live');
assert.strictEqual(lifecycleTransitions.resumedAfterWaiting, true);

var staleFrames = runtime.createState({ timestamp: 20 });
runtime.reconcile(staleFrames, { timestamp: 21, socketHookInstalled: true, framesCaptured: 99, packetsDecoded: 88, tableStatus: 'inProgress', tableClassification: 'active', eligiblePlayerCount: 2 });
assert.strictEqual(staleFrames.displayedStatus, 'initializing', 'stale historic counters without a fresh merged patch cannot produce Live');

runtime.reconcile(activeColdLoad, { timestamp: 30, transportDisconnected: true });
assert.strictEqual(activeColdLoad.displayedStatus, 'disconnected', 'genuine transport loss cannot display Live');
runtime.reconcile(activeColdLoad, { timestamp: 31, transportDisconnected: false, socketHookInstalled: true });
assert.strictEqual(activeColdLoad.displayedStatus, 'initializing', 'socket reopen waits for new authoritative game state');
assert.strictEqual(activePatch(activeColdLoad, 32).status, 'live');

var beforeSnapshot = runtime.snapshot(lifecycleTransitions);
var afterSnapshot = runtime.snapshot(lifecycleTransitions);
assert.deepStrictEqual(afterSnapshot, beforeSnapshot, 'DOM recovery and routine renders read status without mutating it');
assert.strictEqual(lifecycleTransitions.duplicateStatusListenerPreventions, 0, 'status derivation installs no listener or timer');

console.log('HUD runtime status cold-load, paused-reload, resume, cycles, freshness, and disconnect tests passed.');
