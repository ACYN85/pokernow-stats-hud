'use strict';

var assert = require('assert');
var fixture = require('./fixtures/synthetic-tb-two-player-hand.json');
var inference = require('./actionInference.js');
var stats = require('./stats.js');

var tracker = inference.createTbTracker({ street: 'preflop', maxPatchDistance: 8, maxWindowMs: 5000 });
var emitted = [];
var resultsByRecord = {};
fixture.patches.forEach(function (sourcePatch) {
  var players = {};
  Object.keys(sourcePatch.stacks).forEach(function (playerId) { players[playerId] = { stack: sourcePatch.stacks[playerId] }; });
  var result = inference.processTbPatch(tracker, {
    recordId: sourcePatch.recordId,
    timestamp: sourcePatch.timestamp,
    players: players,
    tB: sourcePatch.tB,
    cPI: sourcePatch.cPI,
    pITT: sourcePatch.pITT,
    cRPI: sourcePatch.cRPI,
    bBPI: fixture.bigBlindPlayerId,
    sBPI: fixture.smallBlindPlayerId,
    settlement: sourcePatch.settlement
  });
  resultsByRecord[sourcePatch.recordId] = {
    events: result.events.map(function (event) { return Object.assign({}, event); }),
    pending: result.state.pending.map(function (pending) { return Object.assign({}, pending); })
  };
  emitted = emitted.concat(result.events);
});

assert.strictEqual(resultsByRecord[8].events.length, 0, 'first raise-to tB change must remain pending');
assert.strictEqual(resultsByRecord[8].pending[0].action, 'raise');
assert.strictEqual(resultsByRecord[11].events.length, 0, 'matching tB response must remain pending before stack settlement');
assert.strictEqual(resultsByRecord[12].events.length, 2, 'later batch stack deductions must resolve raise and call together');
assert.strictEqual(resultsByRecord[32].events.length, 0, 'simultaneous settlement stack changes must not emit actions');

var compact = emitted.map(function (event) { return { playerId: event.playerId, action: event.action, street: event.street, amount: event.amount }; });
assert.deepStrictEqual(compact, fixture.expectedActions);
assert.strictEqual(tracker.pending.length, 0, 'all real action candidates should resolve');
assert.strictEqual(tracker.schemaConfirmed, true, 'the delayed preflop stack batch should confirm tB semantics');

var handEvents = [
  { handId: 'fixture-hand', player: 'playerA', action: 'blind', street: 'preflop', amount: 1, timestamp: fixture.patches[0].timestamp },
  { handId: 'fixture-hand', player: 'playerB', action: 'blind', street: 'preflop', amount: 2, timestamp: fixture.patches[0].timestamp }
].concat(emitted.map(function (event) {
  return { handId: 'fixture-hand', player: fixture.players[event.playerId], action: event.action, street: event.street, amount: event.amount, timestamp: event.timestamp };
}));
var playerA = stats.computePlayerStats(handEvents, 'playerA');
var playerB = stats.computePlayerStats(handEvents, 'playerB');
assert.deepStrictEqual({ hands: playerA.handsPlayed, vpip: playerA.vpip, pfr: playerA.pfr }, { hands: 1, vpip: 100, pfr: 100 });
assert.deepStrictEqual({ hands: playerB.handsPlayed, vpip: playerB.vpip, pfr: playerB.pfr }, { hands: 1, vpip: 100, pfr: 0 });

console.log('PokerNow tB synthetic-sequence replay passed.');
