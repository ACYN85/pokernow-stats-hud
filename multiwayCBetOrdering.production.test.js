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
    players: [player('Moon'), player('nalavo', options.nalavo || {}), player('JP', options.jp || {})],
    entrants: ['Moon', 'nalavo', 'JP'],
    openingAggressor: 'Moon',
    finalAggressor: options.finalAggressor || 'Moon',
    sidePotStatus: options.sidePotStatus,
    actions: [
      action(1, 'preflop', 'Moon', 'raise', { isFullRaise: true }),
      action(2, 'preflop', 'nalavo', 'call'),
      action(3, 'preflop', 'JP', 'call')
    ].concat(flopActions)
  }));
}

function counts(contribution, playerId) {
  var item = contribution.players[playerId];
  return [item.flopCBetMade, item.flopCBetOpportunities, item.foldToFlopCBet, item.foldToFlopCBetOpportunities];
}

var m1 = derive('M1', [
  action(4, 'flop', 'nalavo', 'check'), action(5, 'flop', 'JP', 'check'),
  action(6, 'flop', 'Moon', 'bet'), action(7, 'flop', 'nalavo', 'call'), action(8, 'flop', 'JP', 'call')
]);
assert.deepStrictEqual(counts(m1, 'Moon'), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(m1, 'nalavo'), [0, 0, 0, 1]);
assert.deepStrictEqual(counts(m1, 'JP'), [0, 0, 0, 1]);

var m2 = derive('M2', [
  action(4, 'flop', 'nalavo', 'check'), action(5, 'flop', 'JP', 'check'),
  action(6, 'flop', 'Moon', 'bet'), action(7, 'flop', 'nalavo', 'call'), action(8, 'flop', 'JP', 'fold')
], { jp: { folded: true } });
assert.deepStrictEqual(counts(m2, 'nalavo'), [0, 0, 0, 1]);
assert.deepStrictEqual(counts(m2, 'JP'), [0, 0, 1, 1]);

var m3 = derive('M3', [
  action(4, 'flop', 'nalavo', 'check'), action(5, 'flop', 'JP', 'check'),
  action(6, 'flop', 'Moon', 'bet', { isAllIn: true }), action(7, 'flop', 'nalavo', 'call'), action(8, 'flop', 'JP', 'call'),
  action(9, 'turn', 'JP', 'bet'), action(10, 'turn', 'nalavo', 'fold')
], { nalavo: { folded: true } });
assert.deepStrictEqual(counts(m3, 'Moon'), [1, 1, 0, 0], 'a first qualifying flop jam is a CBet');
assert.deepStrictEqual(counts(m3, 'nalavo'), [0, 0, 0, 1], 'later side-pot fold cannot overwrite the direct call');
assert.deepStrictEqual(counts(m3, 'JP'), [0, 0, 0, 1]);
assert.strictEqual(m3.players.nalavo.foldToFlopCBetDecision.response, 'call');

var m4 = derive('M4', [
  action(4, 'flop', 'nalavo', 'bet', { isAllIn: true }), action(5, 'flop', 'JP', 'call'), action(6, 'flop', 'Moon', 'fold')
]);
assert.deepStrictEqual(counts(m4, 'Moon'), [0, 0, 0, 0], 'a non-aggressor donk jam blocks a conventional CBet opportunity');
assert.strictEqual(m4.hand.priorDonkBettor, 'nalavo');

var m5 = reducer.deriveContribution(fixtures.C9);
['A', 'B', 'C'].forEach(function (playerId) {
  assert.strictEqual(m5.players[playerId].supported, false, 'unresolved short-all-in side-pot eligibility stays unsupported');
  assert.strictEqual(m5.players[playerId].flopCBet.opportunity, null);
});

console.log('Multiway CBet/Fold-to-CBet direct-response ordering M1-M5 passed.');
