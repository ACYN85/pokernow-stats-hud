'use strict';

var assert = require('assert');
var fs = require('fs');
var handLogDom = require('./handLogDom.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var accounting = hands.createState({ finalizedEvents: [] });

function stage(handId, player, action, street, amount, ordinal) {
  hands.stageEvent(accounting, {
    handId: handId,
    playerId: player.toLowerCase(),
    player: player,
    action: action,
    street: street,
    amount: amount || 0,
    timestamp: ordinal,
    eventKey: ['live-websocket', handId, player, action, street, ordinal].join('|')
  }, { playerId: player.toLowerCase(), reason: 'verified live WebSocket participant/action' });
}

function commitLiveHand(number, events) {
  var handId = 'table:socket:hand-' + number;
  hands.beginHand(accounting, handId, { activate: true, timestamp: number * 1000 });
  stage(handId, 'PlayerA', 'blind', 'preflop', 10, number * 1000 + 1);
  stage(handId, 'PlayerB', 'blind', 'preflop', 20, number * 1000 + 2);
  events.forEach(function (event, index) {
    stage(handId, event.player, event.action, event.street, event.amount, number * 1000 + 10 + index);
  });
  var result = hands.commitHand(accounting, handId, 'live WebSocket settlement/gameResult', number * 1000 + 99);
  assert.strictEqual(result.committed, true, 'live Hand ' + number + ' commits once');
}

function displayedStats() {
  return {
    PlayerA: stats.computePlayerStats(accounting.finalizedEvents, 'PlayerA'),
    PlayerB: stats.computePlayerStats(accounting.finalizedEvents, 'PlayerB')
  };
}

commitLiveHand(1, [
  { player: 'PlayerA', action: 'raise', street: 'preflop', amount: 60 },
  { player: 'PlayerB', action: 'call', street: 'preflop', amount: 40 },
  { player: 'PlayerA', action: 'bet', street: 'flop', amount: 40 },
  { player: 'PlayerB', action: 'call', street: 'flop', amount: 40 }
]);
commitLiveHand(2, [
  { player: 'PlayerB', action: 'raise', street: 'preflop', amount: 60 },
  { player: 'PlayerA', action: 'fold', street: 'preflop', amount: 0 }
]);
commitLiveHand(3, [
  { player: 'PlayerA', action: 'check', street: 'flop', amount: 0 },
  { player: 'PlayerB', action: 'check', street: 'flop', amount: 0 }
]);

var baseline = displayedStats();
assert.strictEqual(baseline.PlayerA.handsPlayed, 3);
assert.strictEqual(baseline.PlayerB.handsPlayed, 3);

var domState = handLogDom.createState();
var observer1 = handLogDom.installObserver(domState, 'modal-container-a', 10000);
assert.strictEqual(observer1.installed, true);
assert.strictEqual(observer1.installationCount, 1);
var sameObserver = handLogDom.installObserver(domState, 'modal-container-a', 10001);
assert.strictEqual(sameObserver.installed, false, 'reselecting the same container is idempotent');
assert.strictEqual(sameObserver.observerId, observer1.observerId);

function trace(input) {
  var record = handLogDom.classifyMutation(domState, Object.assign({
    observerInstanceId: domState.activeObserverId,
    observerInstallationCount: domState.installationCount,
    containerId: domState.activeContainerId,
    timestamp: 11000
  }, input));
  var ownership = handLogDom.statsOwnershipDecision();
  assert.strictEqual(ownership.mutateStats, false);
  assert.strictEqual(ownership.commitAttempted, false);
  assert.match(ownership.reason, /display\/history-only/);
  assert.strictEqual(record.resultingCommitAttempt.attempted, false);
  assert.deepStrictEqual(displayedStats(), baseline, 'Full Log navigation cannot mutate Hands, VPIP, PFR, or AF');
  return record;
}

var latestFingerprint = 'hand-3-ending-and-actions';
assert.strictEqual(trace({ nodeId: 'row-latest-a', textFingerprint: latestFingerprint, parsedPokerNowHandId: 'real-hand-3', firstRender: true }).renderClassification, 'first-render');
assert.strictEqual(trace({ nodeId: 'row-old-2', textFingerprint: 'hand-2-history', parsedPokerNowHandId: 'real-hand-2' }).renderClassification, 'lazy-render');
assert.strictEqual(trace({ nodeId: 'row-old-1', textFingerprint: 'hand-1-history', parsedPokerNowHandId: 'real-hand-1' }).renderClassification, 'lazy-render');
assert.strictEqual(trace({ nodeId: 'row-old-1', textFingerprint: 'hand-1-history', parsedPokerNowHandId: 'real-hand-1', removed: true }).renderClassification, 'virtualized-row-unmount');
assert.strictEqual(trace({ nodeId: 'row-latest-b', textFingerprint: latestFingerprint, parsedPokerNowHandId: 'real-hand-3' }).renderClassification, 'virtualized-row-remount');
assert.strictEqual(trace({ nodeId: 'row-old-2', textFingerprint: latestFingerprint, parsedPokerNowHandId: 'real-hand-3', characterData: true }).renderClassification, 'recycled-dom-node');

var observer2 = handLogDom.installObserver(domState, 'modal-container-b', 12000);
assert.strictEqual(observer2.installed, true);
assert.strictEqual(observer2.containerReplacement, true);
assert.strictEqual(observer2.previousObserverId, observer1.observerId);
assert.strictEqual(domState.activeObserverId, observer2.observerId, 'container replacement leaves exactly one active observer identity');
assert.strictEqual(trace({ nodeId: 'modal-container-b', textFingerprint: 'replacement-container', containerReplacement: true }).renderClassification, 'container-replacement');

assert.strictEqual(handLogDom.disconnectObserver(domState, observer2.observerId), true, 'modal close disconnects the active observer');
assert.strictEqual(domState.activeObserverId, null);
var observer3 = handLogDom.installObserver(domState, 'modal-container-c', 13000);
assert.strictEqual(observer3.installationCount, 3, 'modal reopen installs one new observer');
assert.strictEqual(handLogDom.installObserver(domState, 'modal-container-c', 13001).installed, false, 'repeat discovery does not overlap observers');
trace({ nodeId: 'row-reopen-1', textFingerprint: 'hand-1-history', parsedPokerNowHandId: 'real-hand-1', firstRender: true });

commitLiveHand(4, [
  { player: 'PlayerA', action: 'call', street: 'preflop', amount: 10 },
  { player: 'PlayerB', action: 'check', street: 'preflop', amount: 0 }
]);
var afterHand4 = displayedStats();
assert.strictEqual(afterHand4.PlayerA.handsPlayed, 4, 'Hand 4 counts exactly once through WebSocket');
assert.strictEqual(afterHand4.PlayerB.handsPlayed, 4, 'Hand 4 counts exactly once through WebSocket');
baseline = afterHand4;
trace({ nodeId: 'row-hand-4', textFingerprint: 'hand-4-ending-and-actions', parsedPokerNowHandId: 'real-hand-4' });
trace({ nodeId: 'row-hand-4-remount', textFingerprint: 'hand-4-ending-and-actions', parsedPokerNowHandId: 'real-hand-4' });

var traces = handLogDom.snapshot(domState);
assert.ok(traces.length >= 10);
assert.ok(traces.every(function (record) {
  return record.sourceClassification === 'full-log-display-history' &&
    record.actualNewLiveLogLine === false &&
    record.resultingCommitAttempt.attempted === false;
}), 'all initial, lazy, remounted, recycled, replacement, and appended log rows are display-only');

var source = fs.readFileSync('./content.js', 'utf8');
var ownershipGate = source.indexOf("if (source === 'full-log') {");
var parsedEventGate = source.indexOf('if (!parsed.event)', ownershipGate);
assert.ok(ownershipGate >= 0 && parsedEventGate > ownershipGate, 'Full Log ownership is decided before parser state lines can reach hand accounting');
assert.match(source.slice(ownershipGate, parsedEventGate), /return \{ parsed: parsed, ownershipDecision: ownershipDecision \};/, 'Full Log always returns at the ownership boundary');
assert.match(source, /handLogDomMutationTraces: PokerHandLogDom\.snapshot\(handLogDomState\)/, 'Copy Diagnostics exports handLogDomMutationTraces');
assert.doesNotMatch(source.slice(source.indexOf('function processLogText'), source.indexOf('function handLogContainerIdentity')), /reconcileSocketHandId/, 'Full Log text processing cannot rename a socket hand');

console.log('Virtualized Full Log display-only ownership production regression passed.');
