'use strict';

var assert = require('assert');
var fs = require('fs');
var lifecycle = require('./firstHandLifecycle.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var fixture = JSON.parse(fs.readFileSync('./fixtures/first-hand-startup.json', 'utf8'));

function processFrame(state, frame) {
  if (frame.type === 'lobby') return;
  if (frame.type === 'hand-start') {
    hands.beginHand(state, frame.handId, { activate: true, timestamp: 100 });
    fixture.players.forEach(function (player, index) {
      hands.stageEvent(state, {
        handId: frame.handId,
        playerId: player.playerId,
        player: player.name,
        action: 'blind',
        blindType: player.blindType,
        street: 'preflop',
        amount: index + 1,
        timestamp: 100 + index,
        eventKey: frame.handId + '|blind|' + player.playerId
      }, { playerId: player.playerId, reason: 'captured first-hand blind evidence' });
    });
    return;
  }
  if (frame.type === 'action') {
    hands.stageEvent(state, Object.assign({ eventKey: frame.handId + '|' + frame.action + '|' + frame.playerId }, frame), { playerId: frame.playerId, reason: 'captured first-hand action' });
    return;
  }
  if (frame.type === 'settlement') hands.commitHand(state, frame.handId, 'captured settlement', 200);
}

function replayWithProductionGate(scenario) {
  var gate = lifecycle.create({ buildId: 'test-build', lobbySessionKey: 'test-lobby', startupType: scenario.startupType, startedAt: 1 });
  scenario.beforeStorageReady.forEach(function (frame) { assert.strictEqual(lifecycle.holdFrame(gate, frame, 2).queued, true); });
  var state = hands.createState({ finalizedEvents: [] });
  lifecycle.markReady(gate, { restoredStatsEventCount: 0 }, 3).forEach(function (frame) { processFrame(state, frame); });
  scenario.afterStorageReady.forEach(function (frame) {
    assert.strictEqual(lifecycle.holdFrame(gate, frame, 4).queued, false);
    processFrame(state, frame);
  });
  return { state: state, traces: lifecycle.snapshot(gate) };
}

function replayLegacyOverwrite(scenario) {
  var state = hands.createState({ finalizedEvents: [] });
  scenario.beforeStorageReady.forEach(function (frame) { processFrame(state, frame); });
  state = hands.createState({ finalizedEvents: [] }); // old storage callback overwrote early in-memory lifecycle state
  scenario.afterStorageReady.forEach(function (frame) { processFrame(state, frame); });
  return state;
}

var coldBefore = replayWithProductionGate(fixture.scenarios.coldBeforeFirstHand);
assert.strictEqual(stats.computePlayerStats(coldBefore.state.finalizedEvents, 'PlayerA').handsPlayed, 1, 'cold start immediately before the first deal counts the completed hand');

var legacyLost = replayLegacyOverwrite(fixture.scenarios.coldInitialHandSnapshotPresent);
assert.strictEqual(stats.computePlayerStats(legacyLost.finalizedEvents, 'PlayerA').handsPlayed, 0, 'pre-fix storage replacement reproduces the missing first hand');
var coldPresent = replayWithProductionGate(fixture.scenarios.coldInitialHandSnapshotPresent);
assert.strictEqual(stats.computePlayerStats(coldPresent.state.finalizedEvents, 'PlayerA').handsPlayed, 1, 'queued initial hand snapshot is replayed after restoration and counted');
assert.strictEqual(coldPresent.state.finalizedHandIds.size, 1, 'cold-start first hand is finalized exactly once');

var reset = replayWithProductionGate(fixture.scenarios.firstHandAfterReset);
assert.strictEqual(stats.computePlayerStats(reset.state.finalizedEvents, 'PlayerA').handsPlayed, 1, 'first hand after Reset Session remains counted');

function scenario(framesBefore, framesAfter) {
  return { startupType: 'cold-start', beforeStorageReady: framesBefore || [], afterStorageReady: framesAfter || [] };
}

var activeMidHand = replayWithProductionGate(scenario([{ frameId: 'mid-1', type: 'hand-start', handId: 'mid-hand' }], []));
assert.strictEqual(stats.computePlayerStats(activeMidHand.state.finalizedEvents, 'PlayerA').handsPlayed, 0, 'joining mid-hand does not count an active incomplete hand');
var openedAfterStart = replayWithProductionGate(scenario([{ frameId: 'open-1', type: 'hand-start', handId: 'open-hand' }], []));
assert.strictEqual(openedAfterStart.state.finalizedEvents.length, 0, 'opening after a hand started creates no phantom finalized events');
var reconnect = replayWithProductionGate(scenario([
  { frameId: 'reconnect-1', type: 'hand-start', handId: 'reconnect-hand' },
  { frameId: 'reconnect-2', type: 'hand-start', handId: 'reconnect-hand' }
], [
  { frameId: 'reconnect-3', type: 'settlement', handId: 'reconnect-hand' },
  { frameId: 'reconnect-4', type: 'settlement', handId: 'reconnect-hand' }
]));
assert.strictEqual(stats.computePlayerStats(reconnect.state.finalizedEvents, 'PlayerA').handsPlayed, 1, 'reconnect and duplicate settlement finalize once');
assert.strictEqual(reconnect.state.finalizedEvents.filter(function (event) { return event.player === 'PlayerA'; }).length, 1, 'duplicate initial snapshots do not duplicate participation');
var emptyLobby = replayWithProductionGate(scenario([{ frameId: 'empty-1', type: 'lobby', handId: null }], []));
assert.strictEqual(emptyLobby.state.finalizedEvents.length, 0, 'lobby snapshot with no hand creates no phantom hand');
var unfinished = replayWithProductionGate(scenario([], [{ frameId: 'unfinished-1', type: 'hand-start', handId: 'unfinished-hand' }]));
assert.strictEqual(unfinished.state.finalizedEvents.length, 0, 'active hand is not counted before completion');

var source = fs.readFileSync('./content.js', 'utf8');
var holdIndex = source.indexOf('PokerFirstHandLifecycle.holdFrame(firstHandLifecycle, frame');
var readyIndex = source.indexOf('PokerFirstHandLifecycle.markReady(firstHandLifecycle');
var restoreIndex = source.indexOf('handAccounting = PokerHandFinalization.createState({ finalizedEvents: liveEvents');
var releaseCallIndex = source.lastIndexOf('releaseStartupFramesAfterStorage();');
assert.ok(holdIndex >= 0, 'production websocket handoff gates frames during storage initialization');
assert.ok(readyIndex >= 0, 'production initialization explicitly opens the frame gate');
assert.ok(restoreIndex >= 0 && releaseCallIndex > restoreIndex, 'persisted hand state is restored before queued frames are released');
assert.match(source, /firstHandLifecycleTraces: PokerFirstHandLifecycle\.snapshot\(firstHandLifecycle\)/, 'Copy Diagnostics exports firstHandLifecycleTraces');

console.log('Cold-start first-hand lifecycle and frame-gate production regression passed.');
