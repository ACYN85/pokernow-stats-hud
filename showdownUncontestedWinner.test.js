'use strict';

var assert = require('assert');
var reducer = require('./showdownStatsReducer');
var explanations = require('./statExplanation');

function player(playerId, options) {
  options = options || {};
  return {
    playerId: playerId,
    seat: null,
    folded: options.folded === true,
    allIn: options.allIn === true ? true : null,
    sawFlop: options.sawFlop !== false,
    reachedShowdown: options.reachedShowdown === true ? true : options.reachedShowdown === false ? false : null,
    awardTotal: options.awardTotal === undefined ? null : options.awardTotal
  };
}

function action(sequence, playerId, street, type, extra) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence,
    playerId: playerId,
    street: street,
    type: type,
    confidence: 'proven'
  }, extra || {});
}

function settlement(winnerId, options) {
  options = options || {};
  if (options.unresolved) {
    return {
      status: 'unresolved', awards: [], totalsByPlayer: {}, totalAwardAmount: null,
      chopped: null, uncontested: null, sidePotStatus: null, finalStacks: {}, refunds: [], reconciliation: {}
    };
  }
  var amount = options.amount || 300;
  return {
    status: 'known',
    awards: [{ awardId: 'award-' + winnerId, playerId: winnerId, amount: amount, potId: null, boardIndex: null }],
    totalsByPlayer: Object.assign({ A: 0, B: 0 }, (function () { var value = {}; value[winnerId] = amount; return value; }())),
    totalAwardAmount: amount,
    chopped: false,
    uncontested: options.uncontested === undefined ? null : options.uncontested,
    sidePotStatus: options.sidePotStatus === undefined ? null : options.sidePotStatus,
    finalStacks: {},
    refunds: options.refunds || [],
    reconciliation: options.reconciliation || {}
  };
}

function record(id, options) {
  options = options || {};
  var entrants = options.entrants || ['A', 'B'];
  var players = options.players || [player('A'), player('B', { folded: true })];
  return {
    schemaVersion: 1,
    status: 'finalized',
    handIdentity: { handId: id + '-AUTH', lifecycleHandId: id + '-LIFE', gameNumber: null },
    players: players,
    actions: options.actions || [],
    streets: {
      flop: { startedAtSequence: 4, completedBySequence: 20, entrants: entrants.slice(), board: [], actionOrder: [] },
      turn: options.turn === false ? undefined : { startedAtSequence: 20, completedBySequence: 30, entrants: entrants.slice(), board: [], actionOrder: [] },
      river: options.river === false ? undefined : { startedAtSequence: 30, completedBySequence: 40, entrants: entrants.slice(), board: [], actionOrder: [] }
    },
    preflopRoles: {},
    automaticRunout: { detected: options.automaticRunout === true, allInSequence: null, revealSequence: null, streetTransitionSequences: [], postflopActionCount: 0 },
    showdown: {
      detected: options.showdownDetected === undefined ? null : options.showdownDetected,
      revealSequence: null,
      participants: (options.showdownParticipants || []).slice(),
      winners: (options.showdownWinners || []).slice(),
      losers: (options.showdownLosers || []).slice(),
      evidence: options.showdownEvidence || null
    },
    settlement: options.settlement || settlement('A'),
    ambiguities: [],
    provenance: {
      source: 'showdown-uncontested-winner-regression',
      finalizationReason: 'terminal settlement',
      historyComplete: options.historyComplete !== false,
      recovered: false,
      terminalEvidence: true
    }
  };
}

function explain(recordValue, contribution) {
  return explanations.build({
    semanticRecord: recordValue,
    showdownContribution: contribution,
    showdownIntegration: {
      attachmentResults: Object.keys(contribution.players).map(function (playerId) {
        var value = contribution.players[playerId];
        return {
          playerId: playerId,
          attached: value.wtsdOpportunityCount > 0,
          contributionId: 'showdown-stats:1:' + recordValue.handIdentity.lifecycleHandId + ':' + playerId,
          after: {
            sawFlopForWTSD: value.wtsdOpportunityCount,
            wentToShowdown: value.wtsdCount,
            showdownsForWSD: value.showdownOpportunityCount,
            wonMoneyAtShowdown: value.wonMoneyAtShowdownCandidateSupported && value.wonMoneyAtShowdownCandidate === 1 ? 1 : 0
          }
        };
      })
    },
    basicContributionsByPlayer: {}
  });
}

function assertUncontested(id, recordValue) {
  var result = reducer.deriveContribution(recordValue);
  ['A', 'B'].forEach(function (playerId) {
    assert.strictEqual(result.players[playerId].sawFlopForWTSD, 1, id + ' ' + playerId + ' saw-flop denominator');
    assert.strictEqual(result.players[playerId].wentToShowdown, 0, id + ' ' + playerId + ' did not reach a contested showdown');
    assert.strictEqual(result.players[playerId].wtsdOpportunityCount, 1, id + ' ' + playerId + ' WTSD opportunity');
    assert.strictEqual(result.players[playerId].wtsdCount, 0, id + ' ' + playerId + ' WTSD numerator');
    assert.strictEqual(result.players[playerId].showdownOpportunityCount, 0, id + ' ' + playerId + ' has no W$SD denominator');
  });
  var explanation = explain(recordValue, result);
  ['A', 'B'].forEach(function (playerId) {
    assert.strictEqual(explanation.players[playerId].wtsd.semanticContribution, '0/1', id + ' ' + playerId + ' WTSD explanation');
    assert.strictEqual(explanation.players[playerId].wtsd.reasonCode, 'did_not_reach_contested_showdown');
    assert.strictEqual(explanation.players[playerId].wsd.semanticContribution, '0/0', id + ' ' + playerId + ' W$SD explanation');
    assert.strictEqual(explanation.players[playerId].wsd.reasonCode, 'not_in_showdown_denominator');
  });
  return result;
}

// U1: va2ilmuwlvqr shape -- donk, raise, reraise, terminal fold, return, single award.
var u1Record = record('U1', {
  actions: [
    action(1, 'A', 'preflop', 'raise', { isFullRaise: true }),
    action(2, 'B', 'preflop', 'raise', { isFullRaise: true }),
    action(3, 'A', 'preflop', 'call'),
    action(4, 'A', 'flop', 'bet'),
    action(5, 'B', 'flop', 'raise'),
    action(6, 'A', 'flop', 'raise'),
    action(7, 'B', 'flop', 'fold')
  ],
  turn: false,
  river: false,
  settlement: settlement('A', {
    refunds: [{ playerId: 'A', amount: 100, explicit: false, confidence: 'inferred_stack_reconciliation' }]
  })
});
var u1 = assertUncontested('U1', u1Record);
assert.ok(u1.players.A.evidence.showdown.some(function (entry) { return entry.kind === 'complete-uncontested-postflop-terminal'; }));

// U2: a flop bet wins immediately.
assertUncontested('U2', record('U2', {
  actions: [action(1, 'A', 'flop', 'bet'), action(2, 'B', 'flop', 'fold')],
  turn: false,
  river: false
}));

// U3: both see the flop and the hand ends by a turn fold.
assertUncontested('U3', record('U3', {
  actions: [action(1, 'A', 'flop', 'check'), action(2, 'B', 'flop', 'check'), action(3, 'A', 'turn', 'bet'), action(4, 'B', 'turn', 'fold')],
  river: false
}));

// U4: a river fold occurs before any contested showdown.
assertUncontested('U4', record('U4', {
  actions: [action(1, 'A', 'flop', 'check'), action(2, 'B', 'flop', 'check'), action(3, 'A', 'river', 'bet'), action(4, 'B', 'river', 'fold')]
}));

// U5: supported all-in runout/showdown semantics are preserved.
var u5Record = record('U5', {
  players: [player('A', { allIn: true, reachedShowdown: true }), player('B', { allIn: true, reachedShowdown: true })],
  actions: [action(1, 'A', 'preflop', 'raise', { isAllIn: true, isFullRaise: true }), action(2, 'B', 'preflop', 'call', { isAllIn: true })],
  automaticRunout: true,
  showdownDetected: true,
  showdownParticipants: ['A', 'B'],
  showdownWinners: ['A'],
  showdownLosers: ['B'],
  showdownEvidence: { kind: 'visible-hole-card-reveal', playerIds: ['A', 'B'] },
  settlement: settlement('A', { uncontested: false, sidePotStatus: false })
});
var u5 = reducer.deriveContribution(u5Record);
assert.deepStrictEqual([u5.players.A.wtsdCount, u5.players.B.wtsdCount], [1, 1]);
assert.deepStrictEqual([u5.players.A.showdownOpportunityCount, u5.players.B.showdownOpportunityCount], [1, 1]);
assert.deepStrictEqual([u5.players.A.wonMoneyAtShowdownCandidate, u5.players.B.wonMoneyAtShowdownCandidate], [1, 0]);

// U6: a terminal fold without complete settlement cannot classify the non-folding player.
var u6Record = record('U6', {
  actions: [action(1, 'A', 'flop', 'bet'), action(2, 'B', 'flop', 'fold')],
  turn: false,
  river: false,
  settlement: settlement('A', { unresolved: true })
});
var u6 = reducer.deriveContribution(u6Record);
assert.strictEqual(u6.players.A.wentToShowdown, null);
assert.strictEqual(u6.players.A.showdownOpportunityCount, 0);
assert.strictEqual(u6.players.A.wonMoneyAtShowdownCandidate, null);
assert.strictEqual(u6.players.B.wentToShowdown, 0, 'the observed fold remains affirmative negative-showdown evidence for B');

var u6ContradictoryRecord = record('U6-CONTRADICTORY', {
  players: [player('A', { reachedShowdown: true }), player('B', { folded: true, reachedShowdown: true })],
  actions: [action(1, 'A', 'flop', 'bet'), action(2, 'B', 'flop', 'fold')],
  turn: false,
  river: false,
  showdownDetected: true,
  showdownParticipants: ['A', 'B'],
  settlement: settlement('A', { uncontested: true })
});
var u6Contradictory = reducer.deriveContribution(u6ContradictoryRecord);
assert.strictEqual(u6Contradictory.players.A.wentToShowdown, null);
assert.strictEqual(u6Contradictory.players.B.wentToShowdown, null);
assert.ok(u6Contradictory.ambiguities.some(function (entry) { return entry.code === reducer.AMBIGUITY_CODES.SHOWDOWN_CONTEST_UNSUPPORTED; }));

console.log('Showdown uncontested-winner U1-U6 reducer and explanation regressions passed.');
