'use strict';

var assert = require('assert');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');
var overlays = require('./seatOverlay.js');

var state = hands.createState();
var hudFinalizedEvents = state.finalizedEvents;

hands.beginHand(state, 'af-call-hand', { activate: true, timestamp: 1000 });
hands.stageEvent(state, {
  handId: 'af-call-hand', playerId: 'p1', player: 'PlayerA',
  action: 'call', street: 'flop', amount: 4, timestamp: 1100
}, { playerId: 'p1', reason: 'verified production call action' });
assert.strictEqual(hands.commitHand(state, 'af-call-hand', 'settlement/gameResult', 1200).committed, true);

hands.beginHand(state, 'af-aggression-hand', { activate: true, timestamp: 2000 });
hands.stageEvent(state, {
  handId: 'af-aggression-hand', playerId: 'p1', player: 'PlayerA',
  action: 'bet', street: 'flop', amount: 6, timestamp: 2100
}, { playerId: 'p1', reason: 'verified production bet action' });
hands.stageEvent(state, {
  handId: 'af-aggression-hand', playerId: 'p1', player: 'PlayerA',
  action: 'raise', street: 'turn', amount: 14, timestamp: 2200
}, { playerId: 'p1', reason: 'verified production raise action' });
assert.strictEqual(hands.commitHand(state, 'af-aggression-hand', 'next distinct hand began', 2300).committed, true);

assert.strictEqual(state.finalizedEvents, hudFinalizedEvents, 'finalization must preserve the HUD projection array identity');
var result = stats.computePlayerStats(hudFinalizedEvents, 'PlayerA');
assert.deepStrictEqual({
  calls: result.afDetails.calls,
  bets: result.afDetails.bets,
  raises: result.afDetails.raises,
  af: result.af,
  display: result.afDetails.display
}, { calls: 1, bets: 1, raises: 1, af: 2, display: '2.0' });
assert.match(overlays.compactStatsLabel(result), /AF 2\.0 \| 3B --- \| F3B ---/, 'seat overlay must retain finite finalized AF before appended compact preflop fields');

console.log('Finalized production AF ownership regression test passed.');
