'use strict';

var assert = require('assert');
var reducer = require('./flopCBetOpportunityReducer.js');
var fixtures = require('./testSupport/flopCBetOpportunityFixtures.js');

var action = fixtures.action;
var player = fixtures.player;
var record = fixtures.record;

function derive(id, flopActions, options) {
  options = options || {};
  return reducer.deriveContribution(record(id, {
    players: [player('PlayerC'), player('PlayerA', options.playerA || {}), player('PlayerB', options.playerB || {})],
    entrants: ['PlayerC', 'PlayerA', 'PlayerB'],
    openingAggressor: 'PlayerC',
    finalAggressor: options.finalAggressor || 'PlayerC',
    sidePotStatus: options.sidePotStatus,
    actions: [
      action(1, 'preflop', 'PlayerC', 'raise', { isFullRaise: true }),
      action(2, 'preflop', 'PlayerA', 'call'),
      action(3, 'preflop', 'PlayerB', 'call')
    ].concat(flopActions)
  }));
}

function counts(contribution, playerId) {
  var item = contribution.players[playerId];
  return [item.flopCBetMade, item.flopCBetOpportunities, item.foldToFlopCBet, item.foldToFlopCBetOpportunities];
}

var m1 = derive('M1', [
  action(4, 'flop', 'PlayerA', 'check'), action(5, 'flop', 'PlayerB', 'check'),
  action(6, 'flop', 'PlayerC', 'bet'), action(7, 'flop', 'PlayerA', 'call'), action(8, 'flop', 'PlayerB', 'call')
]);
assert.deepStrictEqual(counts(m1, 'PlayerC'), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(m1, 'PlayerA'), [0, 0, 0, 1]);
assert.deepStrictEqual(counts(m1, 'PlayerB'), [0, 0, 0, 1]);

var m2 = derive('M2', [
  action(4, 'flop', 'PlayerA', 'check'), action(5, 'flop', 'PlayerB', 'check'),
  action(6, 'flop', 'PlayerC', 'bet'), action(7, 'flop', 'PlayerA', 'call'), action(8, 'flop', 'PlayerB', 'fold')
], { playerB: { folded: true } });
assert.deepStrictEqual(counts(m2, 'PlayerA'), [0, 0, 0, 1]);
assert.deepStrictEqual(counts(m2, 'PlayerB'), [0, 0, 1, 1]);

var m3 = derive('M3', [
  action(4, 'flop', 'PlayerA', 'check'), action(5, 'flop', 'PlayerB', 'check'),
  action(6, 'flop', 'PlayerC', 'bet', { isAllIn: true }), action(7, 'flop', 'PlayerA', 'call'), action(8, 'flop', 'PlayerB', 'call'),
  action(9, 'turn', 'PlayerB', 'bet'), action(10, 'turn', 'PlayerA', 'fold')
], { playerA: { folded: true } });
assert.deepStrictEqual(counts(m3, 'PlayerC'), [1, 1, 0, 0], 'a first qualifying flop jam is a CBet');
assert.deepStrictEqual(counts(m3, 'PlayerA'), [0, 0, 0, 1], 'later side-pot fold cannot overwrite the direct call');
assert.deepStrictEqual(counts(m3, 'PlayerB'), [0, 0, 0, 1]);
assert.strictEqual(m3.players.PlayerA.foldToFlopCBetDecision.response, 'call');

var m4 = derive('M4', [
  action(4, 'flop', 'PlayerA', 'bet', { isAllIn: true }), action(5, 'flop', 'PlayerB', 'call'), action(6, 'flop', 'PlayerC', 'fold')
]);
assert.deepStrictEqual(counts(m4, 'PlayerC'), [0, 0, 0, 0], 'a non-aggressor donk jam blocks a conventional CBet opportunity');
assert.strictEqual(m4.hand.priorDonkBettor, 'PlayerA');

var m5 = reducer.deriveContribution(fixtures.C9);
['A', 'B', 'C'].forEach(function (playerId) {
  assert.strictEqual(m5.players[playerId].supported, false, 'unresolved short-all-in side-pot eligibility stays unsupported');
  assert.strictEqual(m5.players[playerId].flopCBet.opportunity, null);
});

console.log('Multiway CBet/Fold-to-CBet direct-response ordering M1-M5 passed.');
