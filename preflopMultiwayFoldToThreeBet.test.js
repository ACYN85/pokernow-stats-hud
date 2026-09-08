'use strict';

var assert = require('assert');
var reducer = require('./preflopOpportunityReducer.js');

function action(sequence, playerId, type, extra) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence * 10,
    street: 'preflop',
    playerId: playerId,
    type: type,
    subtype: null,
    raiseContext: null,
    amountTo: null,
    minimumRaiseToBefore: 100,
    isAllIn: false,
    isFullRaise: null,
    isShortAllInRaise: false,
    confidence: 'proven'
  }, extra || {});
}

function open(sequence, playerId) {
  return action(sequence, playerId, 'raise', {
    subtype: 'open_raise',
    raiseContext: 'open_raise',
    amountTo: 60,
    minimumRaiseToBefore: 40,
    isFullRaise: true
  });
}

function threeBet(sequence, playerId, extra) {
  return action(sequence, playerId, 'raise', Object.assign({
    subtype: 'three_bet',
    raiseContext: 'three_bet',
    amountTo: 180,
    isFullRaise: true
  }, extra || {}));
}

function call(sequence, playerId) {
  return action(sequence, playerId, 'call', { amountTo: 180 });
}

function fold(sequence, playerId) {
  return action(sequence, playerId, 'fold');
}

function fourBet(sequence, playerId) {
  return action(sequence, playerId, 'raise', {
    subtype: 'raise_after_three_bet',
    raiseContext: 'raise_after_three_bet',
    amountTo: 420,
    minimumRaiseToBefore: 300,
    isFullRaise: true
  });
}

function record(handId, actions) {
  var ids = Array.from(new Set(actions.map(function (entry) { return entry.playerId; })));
  return {
    schemaVersion: 1,
    mode: 'production_shadow',
    status: 'finalized',
    handIdentity: { handId: handId, lifecycleHandId: handId },
    players: ids.map(function (playerId) { return { playerId: playerId, startingStack: 1000 }; }),
    actions: actions,
    preflopRoles: { openingAggressor: 'A' },
    ambiguities: [],
    provenance: { finalizationReason: 'synthetic multiway F3B regression', historyComplete: true, recovered: false }
  };
}

function f3b(contribution, playerId, folded, opportunities, label) {
  var actual = contribution.players[playerId].foldToThreeBet;
  assert.strictEqual(actual.foldCount, folded, label + ' fold count');
  assert.strictEqual(actual.opportunityCount, opportunities, label + ' opportunity count');
  assert.ok(actual.opportunityCount <= 1, label + ' receives at most one direct response');
}

var common = [open(1, 'A'), call(2, 'B'), call(3, 'C'), threeBet(4, 'D')];

var s1 = reducer.deriveContribution(record('S1', common.concat([fold(5, 'A'), call(6, 'B'), fold(7, 'C')])));
f3b(s1, 'A', 1, 1, 'S1 A');
f3b(s1, 'B', 0, 1, 'S1 B');
f3b(s1, 'C', 1, 1, 'S1 C');

var s2 = reducer.deriveContribution(record('S2', common.concat([call(5, 'A'), fold(6, 'B'), call(7, 'C')])));
f3b(s2, 'A', 0, 1, 'S2 A');
f3b(s2, 'B', 1, 1, 'S2 B');
f3b(s2, 'C', 0, 1, 'S2 C');

var s3 = reducer.deriveContribution(record('S3', common.concat([fourBet(5, 'A'), fold(6, 'B'), call(7, 'C')])));
f3b(s3, 'A', 0, 1, 'S3 A directly 4-bets');
f3b(s3, 'B', 0, 0, 'S3 B acts only after the 4-bet');
f3b(s3, 'C', 0, 0, 'S3 C acts only after the 4-bet');

var s4 = reducer.deriveContribution(record('S4', [open(1, 'A'), call(2, 'B'), threeBet(3, 'D'), fold(4, 'A'), fold(5, 'B') ]));
f3b(s4, 'A', 1, 1, 'S4 A');
f3b(s4, 'B', 1, 1, 'S4 B');

var s5 = reducer.deriveContribution(record('S5', [open(1, 'A'), call(2, 'B'), threeBet(3, 'D'), call(4, 'A'), call(5, 'B') ]));
f3b(s5, 'A', 0, 1, 'S5 A');
f3b(s5, 'B', 0, 1, 'S5 B');

var s6 = reducer.deriveContribution(record('S6', [
  open(1, 'A'), call(2, 'B'), call(3, 'C'),
  threeBet(4, 'D', { subtype: 'short_all_in_raise', isAllIn: true, isFullRaise: false, isShortAllInRaise: true, amountTo: 120 }),
  call(5, 'A'), fold(6, 'B'), call(7, 'C')
]));
['A', 'B', 'C', 'D'].forEach(function (playerId) { f3b(s6, playerId, 0, 0, 'S6 ' + playerId); });
assert.strictEqual(s6.hand.validThreeBetSequence, false, 'S6 short raise is not a qualifying 3Bet');

var s7 = reducer.deriveContribution(record('S7', common.concat([
  call(5, 'A'), fourBet(6, 'B'), fold(7, 'C'), fold(8, 'D'), fold(9, 'A')
])));
f3b(s7, 'A', 0, 1, 'S7 A direct call is frozen despite later fold');
f3b(s7, 'B', 0, 1, 'S7 B direct 4-bet');
f3b(s7, 'C', 0, 0, 'S7 C responds only after 4-bet');
f3b(s7, 'D', 0, 0, 'S7 3-bettor');

console.log('Multiway/squeeze Fold-to-3Bet S1-S7 regressions passed.');
