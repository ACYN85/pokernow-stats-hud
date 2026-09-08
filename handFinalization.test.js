'use strict';

var assert = require('assert');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var ids = { PlayerA: 'p1', PlayerB: 'p2', Zoe: 'p3' };
var decisions = hands.deriveParticipants({
  allPlayerIds: [ids.PlayerA, ids.PlayerB, ids.Zoe],
  inHandPlayerIds: [ids.PlayerA, ids.Zoe],
  blindPlayerIds: [],
  holeCardPlayerIds: [],
  actionPlayerIds: [],
  statusByPlayer: { p1: { inHand: true }, p2: { sittingOut: true }, p3: { inHand: true } }
});
assert.deepStrictEqual(decisions.filter(function (item) { return item.included; }).map(function (item) { return item.playerId; }), [ids.PlayerA, ids.Zoe]);
assert.strictEqual(decisions.find(function (item) { return item.playerId === ids.PlayerB; }).included, false, 'mapped/seated PlayerB must not be dealt in without in-hand evidence');

var state = hands.createState();
hands.beginHand(state, 'hand-1', { activate: true, timestamp: 1000 });
decisions.filter(function (item) { return item.included; }).forEach(function (item) {
  var name = item.playerId === ids.PlayerA ? 'PlayerA' : 'Zoe';
  hands.addParticipant(state, 'hand-1', { playerId: item.playerId, name: name, evidence: item.evidence.join('; '), timestamp: 1000 });
});
hands.stageEvent(state, { handId: 'hand-1', player: 'PlayerA', action: 'raise', street: 'preflop', amount: 6, timestamp: 1100 }, { playerId: ids.PlayerA, reason: 'verified raise action' });
hands.stageEvent(state, { handId: 'hand-1', player: 'Zoe', action: 'call', street: 'preflop', amount: 4, timestamp: 1200 }, { playerId: ids.Zoe, reason: 'verified call action' });

assert.strictEqual(stats.computePlayerStats(state.finalizedEvents, 'PlayerA').handsPlayed, 0, 'active first hand must not affect displayed Hands');
assert.strictEqual(stats.computePlayerStats(state.finalizedEvents, 'PlayerA').vpip, 0, 'active raise must not affect displayed VPIP');

var committed = hands.commitHand(state, 'hand-1', 'settlement/gameResult', 1500);
assert.strictEqual(committed.committed, true);
assert.deepStrictEqual({ hands: stats.computePlayerStats(state.finalizedEvents, 'PlayerA').handsPlayed, vpip: stats.computePlayerStats(state.finalizedEvents, 'PlayerA').vpip, pfr: stats.computePlayerStats(state.finalizedEvents, 'PlayerA').pfr }, { hands: 1, vpip: 100, pfr: 100 });
assert.deepStrictEqual({ hands: stats.computePlayerStats(state.finalizedEvents, 'Zoe').handsPlayed, vpip: stats.computePlayerStats(state.finalizedEvents, 'Zoe').vpip, pfr: stats.computePlayerStats(state.finalizedEvents, 'Zoe').pfr }, { hands: 1, vpip: 100, pfr: 0 });
assert.strictEqual(stats.computePlayerStats(state.finalizedEvents, 'PlayerB').handsPlayed, 0, 'inactive PlayerB must not gain a hand');
assert.strictEqual(hands.commitHand(state, 'hand-1', 'duplicate settlement', 1600).duplicate, true, 'duplicate boundary must not finalize twice');

hands.beginHand(state, 'hand-1', { activate: false, timestamp: 1700 });
hands.addParticipant(state, 'hand-1', { playerId: ids.PlayerA, name: 'PlayerA', evidence: 'Full Log dealt-in roster', timestamp: 1700 });
hands.addParticipant(state, 'hand-1', { playerId: ids.Zoe, name: 'Zoe', evidence: 'Full Log dealt-in roster', timestamp: 1700 });
hands.stageEvent(state, { handId: 'hand-1', player: 'PlayerA', action: 'raise', street: 'preflop', amount: 6, timestamp: 1710 }, { playerId: ids.PlayerA, reason: 'Full Log action' });
hands.stageEvent(state, { handId: 'hand-1', player: 'Zoe', action: 'call', street: 'preflop', amount: 4, timestamp: 1720 }, { playerId: ids.Zoe, reason: 'Full Log action' });
var reconciled = hands.commitHand(state, 'hand-1', 'Full Log reconciliation', 1750);
assert.strictEqual(reconciled.duplicate, true, 'identical Full Log history must merge without duplicating finalized events');
assert.strictEqual(stats.computePlayerStats(state.finalizedEvents, 'PlayerA').handsPlayed, 1);

hands.beginHand(state, 'hand-2', { activate: true, timestamp: 2000 });
hands.stageEvent(state, { handId: 'hand-2', player: 'PlayerA', action: 'check', street: 'flop', amount: 0, timestamp: 2100 }, { playerId: ids.PlayerA, reason: 'verified check action' });
var nextBoundary = hands.beginHand(state, 'hand-3', { activate: true, timestamp: 2500 });
assert.strictEqual(nextBoundary.priorResult.committed, true, 'next distinct boundary must finalize the prior active hand');
assert.strictEqual(stats.computePlayerStats(state.finalizedEvents, 'PlayerA').handsPlayed, 2);

var refreshState = hands.createState();
hands.beginHand(refreshState, 'refresh-incomplete', { activate: true, timestamp: 3000 });
hands.stageEvent(refreshState, { handId: 'refresh-incomplete', player: 'PlayerA', action: 'raise', street: 'preflop', amount: 8, timestamp: 3100 }, { playerId: ids.PlayerA, reason: 'verified raise action' });
var recovered = hands.createState({ finalizedEvents: refreshState.finalizedEvents, activeHand: hands.serializeActiveHand(refreshState) });
var afterRefreshBoundary = hands.beginHand(recovered, 'post-refresh-hand', { activate: true, timestamp: 4000 });
assert.strictEqual(afterRefreshBoundary.priorResult.discarded, true, 'unobserved recovered incomplete hand must not be finalized');
assert.strictEqual(recovered.finalizedEvents.length, 0);

console.log('Finalized-hand accounting and evidence-based participant tests passed.');
