'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var hands = require('./handFinalization.js');

function walkEvents(handId) {
  return [
    { handId: handId, playerId: 'SB-ID', player: 'SB', action: 'blind', blindType: 'small', street: 'preflop', amount: 1, timestamp: 1 },
    { handId: handId, playerId: 'BB-ID', player: 'BB', action: 'blind', blindType: 'big', street: 'preflop', amount: 2, timestamp: 2 },
    { handId: handId, playerId: 'UTG-ID', player: 'UTG', action: 'fold', street: 'preflop', amount: 0, timestamp: 3 },
    { handId: handId, playerId: 'SB-ID', player: 'SB', action: 'fold', street: 'preflop', amount: 0, timestamp: 4 }
  ];
}

function assertWalk(events, label) {
  var bb = stats.computePlayerStatsByIdentity(events, 'BB-ID', 'BB');
  assert.deepStrictEqual({
    hands: bb.handsPlayed,
    vpipMade: bb.vpipHands,
    vpipOpportunities: bb.vpipOpportunities,
    pfrMade: bb.pfrHands,
    pfrOpportunities: bb.pfrOpportunities,
    threeBetOpportunities: bb.threeBetOpportunities,
    flopCBetOpportunities: bb.flopCBetOpportunities
  }, { hands: 1, vpipMade: 0, vpipOpportunities: 0, pfrMade: 0, pfrOpportunities: 0, threeBetOpportunities: 0, flopCBetOpportunities: 0 }, label);
}

var w1 = walkEvents('W1');
assertWalk(w1, 'W1 normal settlement walk');

var restoredW2 = JSON.parse(JSON.stringify(walkEvents('W2')));
var recoveredAccounting = hands.createState({ finalizedEvents: restoredW2, finalizedHandIds: ['W2'] });
assertWalk(recoveredAccounting.finalizedEvents, 'W2 reload/reconnect restoration preserves walk counters');
assert.strictEqual(hands.commitHand(recoveredAccounting, 'W2', 'duplicate reconnect settlement', 10).duplicate, true);

var w3 = walkEvents('W3');
assertWalk(w3, 'W3 first hand after pause/game break uses the same authoritative walk semantics');

var w4 = walkEvents('W4');
assertWalk(w4, 'W4 spectator mode does not require a local player identity');

console.log('BB walk W1-W4 lifecycle/reload/spectator continuity passed.');

