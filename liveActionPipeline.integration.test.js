'use strict';

var assert = require('assert');
var fixture = require('./fixtures/synthetic-tb-two-player-hand.json');
var production = require('./liveActionPipeline.js');
var stats = require('./stats.js');

var handId = 'production-live-fixture-hand';
var state = production.createState({ handId: handId, street: 'preflop', maxPatchDistance: 8, maxWindowMs: 5000 });
var previousSnapshot = null;
var emitted = [];
var lifecycle = [];
var pendingAfterRaise = null;
var patchIndexAfterRaise = null;

fixture.patches.forEach(function (sourcePatch) {
  var players = {};
  Object.keys(sourcePatch.stacks).forEach(function (playerId) { players[playerId] = { stack: sourcePatch.stacks[playerId] }; });
  var currentSnapshot = {
    players: players,
    tB: sourcePatch.tB,
    cPI: sourcePatch.cPI,
    pITT: sourcePatch.pITT,
    cRPI: sourcePatch.cRPI,
    bBPI: fixture.bigBlindPlayerId,
    sBPI: fixture.smallBlindPlayerId
  };
  var incomingPatch = sourcePatch.settlement ? { gameResult: { fixture: { gained: 1 } } } : currentSnapshot;
  var result = production.handleMergedPatch(state, previousSnapshot, currentSnapshot, {
    recordId: sourcePatch.recordId,
    timestamp: sourcePatch.timestamp,
    incomingPatch: incomingPatch,
    handId: handId,
    street: 'preflop',
    newHand: sourcePatch.recordId === 7 || sourcePatch.recordId === 9
  });
  assert.strictEqual(result.handled, true, 'production handler should normalize record ' + sourcePatch.recordId);
  assert.strictEqual(result.invariant.valid, true, 'candidate lifecycle invariant must hold at record ' + sourcePatch.recordId);
  assert.deepStrictEqual(result.normalized.tB, sourcePatch.tB, 'live normalized tB should match record ' + sourcePatch.recordId);
  emitted = emitted.concat(result.inference.events);
  lifecycle = lifecycle.concat(result.lifecycle);
  if (sourcePatch.recordId === 8) {
    pendingAfterRaise = result.pendingCount;
    patchIndexAfterRaise = state.tracker.patchIndex;
    var heartbeat = production.handleMergedPatch(state, currentSnapshot, { now: sourcePatch.timestamp + 10 }, {
      recordId: 'heartbeat',
      timestamp: sourcePatch.timestamp + 10,
      incomingPatch: { now: sourcePatch.timestamp + 10 },
      handId: handId,
      street: 'preflop',
      newHand: false
    });
    assert.strictEqual(heartbeat.handled, false, 'heartbeat without merged tB is not an action patch');
    assert.strictEqual(heartbeat.pendingCount, 1, 'heartbeat must retain the pending raise');
    assert.strictEqual(state.tracker.patchIndex, patchIndexAfterRaise, 'heartbeat must not age the pending action window');
  }
  previousSnapshot = currentSnapshot;
});

assert.strictEqual(pendingAfterRaise, 1, 'raise candidate should be pending after its first tB change');
assert.strictEqual(state.tracker.pending.length, 0, 'every production candidate must reach a terminal state');
var compact = emitted.map(function (event) { return { playerId: event.playerId, action: event.action, street: event.street, amount: event.amount }; });
assert.deepStrictEqual(compact, fixture.expectedActions, 'production live handler must reproduce captured replay actions');

var created = lifecycle.filter(function (item) { return item.kind === 'created'; });
var terminal = lifecycle.filter(function (item) { return item.kind === 'confirmed' || item.kind === 'rejected' || item.kind === 'expired'; });
assert.ok(created.length >= 6, 'money actions should enter the pending lifecycle');
created.forEach(function (item) {
  assert.ok(terminal.some(function (end) { return end.sourceRecordId === item.sourceRecordId && end.playerId === item.playerId; }), 'candidate from record ' + item.sourceRecordId + ' must terminate');
});
assert.ok(state.lifecycle.some(function (item) { return item.kind === 'hand-boundary-deduplicated'; }), 'duplicate same-hand boundary must not reset pending state');

var handEvents = [
  { handId: handId, player: 'playerA', action: 'blind', street: 'preflop', amount: 1, timestamp: fixture.patches[0].timestamp },
  { handId: handId, player: 'playerB', action: 'blind', street: 'preflop', amount: 2, timestamp: fixture.patches[0].timestamp }
].concat(emitted.map(function (event) {
  return { handId: handId, player: fixture.players[event.playerId], action: event.action, street: event.street, amount: event.amount, timestamp: event.timestamp };
}));
var playerA = stats.computePlayerStats(handEvents, 'playerA');
var playerB = stats.computePlayerStats(handEvents, 'playerB');
assert.deepStrictEqual({ hands: playerA.handsPlayed, vpip: playerA.vpip, pfr: playerA.pfr }, { hands: 1, vpip: 100, pfr: 100 });
assert.deepStrictEqual({ hands: playerB.handsPlayed, vpip: playerB.vpip, pfr: playerB.pfr }, { hands: 1, vpip: 100, pfr: 0 });

var shortState = production.createState({ handId: 'short-hand-1', street: 'preflop', maxPatchDistance: 8, maxWindowMs: 5000 });
var blindSnapshot = {
  players: { 'P1': { stack: 100 }, 'P3': { stack: 100 } },
  tB: { 'P1': 1, 'P3': 2 },
  cPI: 'P1', pITT: 'P1', cRPI: [],
  sBPI: 'P1', bBPI: 'P3'
};
production.handleMergedPatch(shortState, null, blindSnapshot, { recordId: 1, timestamp: 1000, incomingPatch: blindSnapshot, handId: 'short-hand-1', street: 'preflop', newHand: true });
var raiseSnapshot = JSON.parse(JSON.stringify(blindSnapshot));
raiseSnapshot.tB['P1'] = 6;
raiseSnapshot.cRPI = ['P1'];
var shortRaise = production.handleMergedPatch(shortState, blindSnapshot, raiseSnapshot, { recordId: 2, timestamp: 1500, incomingPatch: raiseSnapshot, handId: 'short-hand-1', street: 'preflop', newHand: false });
assert.strictEqual(shortRaise.pendingCount, 1, 'short hand should contain one pending raise');
var nextHandSnapshot = JSON.parse(JSON.stringify(blindSnapshot));
var handEnded = production.handleMergedPatch(shortState, raiseSnapshot, nextHandSnapshot, { recordId: 3, timestamp: 1800, incomingPatch: nextHandSnapshot, handId: 'short-hand-2', street: 'preflop', newHand: true });
assert.strictEqual(handEnded.pendingCount, 0, 'new hand boundary must terminate the prior pending action');
assert.ok(handEnded.lifecycle.some(function (item) { return item.kind === 'rejected' && item.codeBranch === 'handleMergedPatch:new-hand-reset'; }), 'early hand end must produce an explicit rejected lifecycle record');
assert.strictEqual(handEnded.invariant.valid, true);
assert.deepStrictEqual(handEnded.invariant, { created: 1, pending: 0, confirmed: 0, rejected: 1, expired: 0, valid: true });

var foldState = production.createState({ handId: 'fold-hand', street: 'preflop' });
production.handleMergedPatch(foldState, null, blindSnapshot, { recordId: 1, timestamp: 2000, incomingPatch: blindSnapshot, handId: 'fold-hand', street: 'preflop', newHand: true });
var foldSnapshot = JSON.parse(JSON.stringify(blindSnapshot));
foldSnapshot.tB['P1'] = 'fold';
foldSnapshot.cRPI = ['P1'];
var folded = production.handleMergedPatch(foldState, blindSnapshot, foldSnapshot, { recordId: 2, timestamp: 2200, incomingPatch: foldSnapshot, handId: 'fold-hand', street: 'preflop', newHand: false });
assert.deepStrictEqual(folded.inference.events.map(function (event) { return event.action; }), ['fold']);
assert.deepStrictEqual(folded.invariant, { created: 1, pending: 0, confirmed: 1, rejected: 0, expired: 0, valid: true });

var lostState = production.createState({ handId: 'lost-hand', street: 'preflop' });
production.handleMergedPatch(lostState, null, blindSnapshot, { recordId: 1, timestamp: 3000, incomingPatch: blindSnapshot, handId: 'lost-hand', street: 'preflop', newHand: true });
var lostRaise = production.handleMergedPatch(lostState, blindSnapshot, raiseSnapshot, { recordId: 2, timestamp: 3200, incomingPatch: raiseSnapshot, handId: 'lost-hand', street: 'preflop', newHand: false });
assert.strictEqual(lostRaise.pendingCount, 1);
lostState.tracker.pending = [];
var lostAudit = production.handleMergedPatch(lostState, raiseSnapshot, raiseSnapshot, { recordId: 3, timestamp: 3300, incomingPatch: { now: 3300 }, handId: 'lost-hand', street: 'preflop', newHand: false });
assert.ok(lostAudit.invariantViolations.some(function (violation) { return violation.kind === 'invariant-violation' && violation.codeBranch === 'handleMergedPatch:post-process-ledger-audit'; }), 'silently removed candidate must trigger a lost-candidate invariant violation');

console.log('Production live-action pipeline integration replay passed.');
