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
    minimumRaiseToBefore: null,
    isAllIn: null,
    isFullRaise: null,
    isShortAllInRaise: null,
    confidence: 'proven'
  }, extra || {});
}

function openRaise(sequence, playerId) {
  return action(sequence, playerId, 'raise', {
    subtype: 'open_raise',
    raiseContext: 'open_raise',
    amountTo: 60,
    minimumRaiseToBefore: 40,
    isFullRaise: true
  });
}

function fullRaise(sequence, playerId, extra) {
  return action(sequence, playerId, 'raise', Object.assign({
    subtype: 'three_bet',
    raiseContext: 'three_bet',
    amountTo: 180,
    minimumRaiseToBefore: 100,
    isFullRaise: true
  }, extra || {}));
}

function decision(sequence, playerId, type, extra) {
  return action(sequence, playerId, type, Object.assign({
    minimumRaiseToBefore: 100
  }, extra || {}));
}

function finalizedRecord(handId, playerIds, actions, options) {
  options = options || {};
  var stacks = options.stacks || {};
  return {
    schemaVersion: 1,
    mode: 'production_shadow',
    status: 'finalized',
    handIdentity: {
      handId: handId,
      lifecycleHandId: options.lifecycleHandId || handId
    },
    players: playerIds.map(function (playerId) {
      return {
        playerId: playerId,
        startingStack: Object.prototype.hasOwnProperty.call(stacks, playerId) ? stacks[playerId] : 1000
      };
    }),
    actions: actions,
    preflopRoles: {
      openingAggressor: options.openingAggressor === undefined
        ? ((actions.find(function (entry) { return entry.raiseContext === 'open_raise'; }) || {}).playerId || null)
        : options.openingAggressor
    },
    ambiguities: options.ambiguities || [],
    provenance: {
      finalizationReason: 'synthetic reducer regression',
      historyComplete: options.historyComplete === undefined ? true : options.historyComplete,
      recovered: options.recovered === true
    }
  };
}

function contributionFor(record) {
  var before = JSON.stringify(record);
  var contribution = reducer.deriveContribution(record);
  assert.strictEqual(JSON.stringify(record), before, record.handIdentity.handId + ' derivation must not mutate its input');
  return contribution;
}

function player(contribution, playerId) {
  assert.ok(contribution.players[playerId], 'missing contribution for ' + playerId);
  return contribution.players[playerId];
}

function hasAmbiguity(contribution, code) {
  return contribution.ambiguities.some(function (entry) {
    return entry.code === code;
  });
}

var validFoldRecord = finalizedRecord('valid-fold', ['O1', 'T1'], [
  openRaise(1, 'O1'),
  fullRaise(2, 'T1'),
  decision(3, 'O1', 'fold')
]);
var validFold = contributionFor(validFoldRecord);
assert.strictEqual(validFold.hand.openRaiser, 'O1');
assert.strictEqual(validFold.hand.threeBettor, 'T1');
assert.strictEqual(validFold.hand.validThreeBetSequence, true);
assert.deepStrictEqual(player(validFold, 'T1').threeBet, {
  opportunity: true,
  made: true,
  opportunityCount: 1,
  madeCount: 1,
  isSqueeze: false,
  reason: 'qualifying_three_bet',
  evidence: player(validFold, 'T1').threeBet.evidence
});
assert.strictEqual(player(validFold, 'O1').foldToThreeBet.opportunity, true);
assert.strictEqual(player(validFold, 'O1').foldToThreeBet.folded, true);
assert.strictEqual(player(validFold, 'O1').foldToThreeBet.response, 'fold');
assert.strictEqual(player(validFold, 'O1').foldToThreeBet.foldCount, 1);
assert.strictEqual(player(validFold, 'T1').foldToThreeBet.opportunity, false, 'the 3-bettor is never eligible for Fold-to-3Bet');

var callRecord = finalizedRecord('call-open', ['O2', 'C2'], [
  openRaise(1, 'O2'),
  decision(2, 'C2', 'call', { amountTo: 60 })
]);
var callContribution = contributionFor(callRecord);
assert.strictEqual(player(callContribution, 'C2').threeBet.opportunity, true);
assert.strictEqual(player(callContribution, 'C2').threeBet.made, false);
assert.strictEqual(player(callContribution, 'C2').threeBet.reason, 'continued_without_three_bet');
assert.strictEqual(callContribution.hand.validThreeBetSequence, false);
assert.strictEqual(player(callContribution, 'O2').foldToThreeBet.opportunity, false);

var squeezeRecord = finalizedRecord('squeeze', ['O3', 'C3', 'S3'], [
  openRaise(1, 'O3'),
  decision(2, 'C3', 'call', { amountTo: 60 }),
  fullRaise(3, 'S3', { subtype: 'squeeze', raiseContext: 'squeeze' }),
  decision(4, 'O3', 'call', { amountTo: 180 }),
  decision(5, 'C3', 'fold')
]);
var squeeze = contributionFor(squeezeRecord);
assert.strictEqual(squeeze.hand.threeBettor, 'S3');
assert.strictEqual(squeeze.hand.isSqueeze, true);
assert.deepStrictEqual(squeeze.hand.interveningCallers, ['C3']);
assert.strictEqual(player(squeeze, 'C3').threeBet.opportunity, true);
assert.strictEqual(player(squeeze, 'C3').threeBet.made, false);
assert.strictEqual(player(squeeze, 'S3').threeBet.made, true);
assert.strictEqual(player(squeeze, 'S3').threeBet.isSqueeze, true);
assert.strictEqual(player(squeeze, 'O3').foldToThreeBet.opportunity, true);
assert.strictEqual(player(squeeze, 'O3').foldToThreeBet.folded, false);
assert.strictEqual(player(squeeze, 'O3').foldToThreeBet.response, 'call');
assert.strictEqual(player(squeeze, 'C3').foldToThreeBet.opportunity, true, 'an entered cold caller receives a direct Fold-to-3Bet opportunity');
assert.strictEqual(player(squeeze, 'C3').foldToThreeBet.foldCount, 1, 'the cold caller folded directly to the qualifying squeeze');

var openerFourBetRecord = finalizedRecord('opener-four-bet', ['O4', 'T4'], [
  openRaise(1, 'O4'),
  fullRaise(2, 'T4'),
  fullRaise(3, 'O4', { subtype: 'raise_after_three_bet', raiseContext: 'raise_after_three_bet', amountTo: 420, minimumRaiseToBefore: 300 })
]);
var openerFourBet = contributionFor(openerFourBetRecord);
assert.strictEqual(openerFourBet.hand.threeBettor, 'T4', 'a later 4Bet must not replace the 3-bettor identity');
assert.strictEqual(player(openerFourBet, 'T4').threeBet.madeCount, 1);
assert.strictEqual(player(openerFourBet, 'O4').foldToThreeBet.opportunity, true);
assert.strictEqual(player(openerFourBet, 'O4').foldToThreeBet.folded, false);
assert.strictEqual(player(openerFourBet, 'O4').foldToThreeBet.response, 'raise');
assert.strictEqual(player(openerFourBet, 'O4').foldToThreeBet.reason, 'opener_four_bet');

var interveningFourBetRecord = finalizedRecord('other-four-bet', ['O5', 'T5', 'X5'], [
  openRaise(1, 'O5'),
  fullRaise(2, 'T5'),
  fullRaise(3, 'X5', { subtype: 'raise_after_three_bet', raiseContext: 'raise_after_three_bet', amountTo: 420, minimumRaiseToBefore: 300 }),
  decision(4, 'O5', 'fold')
]);
var interveningFourBet = contributionFor(interveningFourBetRecord);
assert.strictEqual(interveningFourBet.hand.threeBettor, 'T5');
assert.strictEqual(player(interveningFourBet, 'T5').threeBet.madeCount, 1);
assert.strictEqual(player(interveningFourBet, 'X5').threeBet.opportunity, false, 'a player acting only after the 3Bet boundary receives no 3Bet opportunity');
assert.strictEqual(player(interveningFourBet, 'O5').foldToThreeBet.opportunity, false, 'an intervening full 4Bet freezes the original opener response');
assert.strictEqual(player(interveningFourBet, 'O5').foldToThreeBet.folded, false);
assert.strictEqual(player(interveningFourBet, 'O5').foldToThreeBet.response, null);
assert.strictEqual(player(interveningFourBet, 'O5').foldToThreeBet.reason, 'action_did_not_return_before_four_bet');

var fullAllInRecord = finalizedRecord('full-all-in-three-bet', ['O6', 'A6'], [
  openRaise(1, 'O6'),
  fullRaise(2, 'A6', { isAllIn: true, isFullRaise: true, amountTo: 500 }),
  decision(3, 'O6', 'fold')
]);
var fullAllIn = contributionFor(fullAllInRecord);
assert.strictEqual(player(fullAllIn, 'A6').threeBet.opportunity, true);
assert.strictEqual(player(fullAllIn, 'A6').threeBet.made, true);
assert.strictEqual(player(fullAllIn, 'O6').foldToThreeBet.opportunity, true);
assert.strictEqual(player(fullAllIn, 'O6').foldToThreeBet.folded, true);

var shortAllInRecord = finalizedRecord('short-all-in', ['O7', 'A7'], [
  openRaise(1, 'O7'),
  fullRaise(2, 'A7', {
    subtype: 'short_all_in_raise',
    isAllIn: true,
    isFullRaise: false,
    isShortAllInRaise: true,
    amountTo: 120
  }),
  decision(3, 'O7', 'call', { amountTo: 120 })
]);
var shortAllIn = contributionFor(shortAllInRecord);
assert.strictEqual(shortAllIn.hand.validThreeBetSequence, false);
assert.strictEqual(shortAllIn.hand.threeBettor, null);
assert.strictEqual(player(shortAllIn, 'A7').threeBet.opportunity, null);
assert.strictEqual(player(shortAllIn, 'A7').threeBet.made, null);
assert.strictEqual(player(shortAllIn, 'A7').threeBet.reason, 'short_non_full_raise_opportunity_void');
assert.strictEqual(player(shortAllIn, 'O7').foldToThreeBet.opportunity, null);
assert.strictEqual(player(shortAllIn, 'O7').foldToThreeBet.folded, null);
assert.strictEqual(player(shortAllIn, 'O7').foldToThreeBet.reason, 'short_non_full_reraise_does_not_prove_reopening');
assert.ok(hasAmbiguity(shortAllIn, reducer.AMBIGUITY_CODES.SHORT_ALL_IN_REOPENING_UNKNOWN));

var unknownAllInRecord = finalizedRecord('unknown-all-in', ['O8', 'A8'], [
  openRaise(1, 'O8'),
  fullRaise(2, 'A8', {
    isAllIn: true,
    isFullRaise: null,
    isShortAllInRaise: null,
    amountTo: 150
  }),
  decision(3, 'O8', 'fold')
]);
var unknownAllIn = contributionFor(unknownAllInRecord);
assert.strictEqual(unknownAllIn.hand.validThreeBetSequence, null);
assert.strictEqual(unknownAllIn.hand.threeBettor, null);
assert.strictEqual(player(unknownAllIn, 'A8').threeBet.opportunity, null);
assert.strictEqual(player(unknownAllIn, 'A8').threeBet.reason, 'raise_fullness_unknown');
assert.strictEqual(player(unknownAllIn, 'O8').foldToThreeBet.opportunity, null);
assert.strictEqual(player(unknownAllIn, 'O8').foldToThreeBet.reason, 'reraise_fullness_unknown');
assert.ok(hasAmbiguity(unknownAllIn, reducer.AMBIGUITY_CODES.THREE_BET_CANDIDATE_UNSUPPORTED));

var inactiveBeforeOpenRecord = finalizedRecord('inactive-before-open', ['F9', 'I9', 'O9', 'T9'], [
  decision(1, 'F9', 'fold'),
  decision(2, 'I9', 'partial_call', { isAllIn: true, amountTo: 20 }),
  openRaise(3, 'O9'),
  fullRaise(4, 'T9'),
  decision(5, 'O9', 'fold')
]);
var inactiveBeforeOpen = contributionFor(inactiveBeforeOpenRecord);
['F9', 'I9'].forEach(function (playerId) {
  assert.strictEqual(player(inactiveBeforeOpen, playerId).threeBet.opportunity, false);
  assert.strictEqual(player(inactiveBeforeOpen, playerId).threeBet.opportunityCount, 0);
  assert.strictEqual(player(inactiveBeforeOpen, playerId).threeBet.reason, 'inactive_before_opening_raise');
});
assert.strictEqual(player(inactiveBeforeOpen, 'T9').threeBet.made, true);
assert.strictEqual(player(inactiveBeforeOpen, 'O9').foldToThreeBet.folded, true);

var missingCapacityRecord = finalizedRecord('missing-capacity', ['O10', 'C10'], [
  openRaise(1, 'O10'),
  decision(2, 'C10', 'call', { amountTo: 60, minimumRaiseToBefore: null })
], {
  stacks: { O10: 1000, C10: null }
});
var missingCapacity = contributionFor(missingCapacityRecord);
assert.strictEqual(player(missingCapacity, 'C10').threeBet.opportunity, null);
assert.strictEqual(player(missingCapacity, 'C10').threeBet.made, null);
assert.strictEqual(player(missingCapacity, 'C10').threeBet.reason, 'legal_full_reraise_capacity_unknown');
assert.ok(hasAmbiguity(missingCapacity, reducer.AMBIGUITY_CODES.LEGAL_CAPACITY_UNKNOWN));

var incompleteRecord = finalizedRecord('incomplete-history', ['O11', 'T11'], [
  openRaise(1, 'O11'),
  fullRaise(2, 'T11'),
  decision(3, 'O11', 'fold')
], {
  historyComplete: false
});
var incomplete = contributionFor(incompleteRecord);
Object.keys(incomplete.players).forEach(function (playerId) {
  assert.strictEqual(player(incomplete, playerId).threeBet.opportunity, null);
  assert.strictEqual(player(incomplete, playerId).foldToThreeBet.opportunity, null);
});
assert.ok(hasAmbiguity(incomplete, reducer.AMBIGUITY_CODES.HISTORY_INCOMPLETE));

var recoveredRecord = finalizedRecord('recovered-history', ['O12', 'T12'], [
  openRaise(1, 'O12'),
  fullRaise(2, 'T12'),
  decision(3, 'O12', 'fold')
], {
  recovered: true
});
var recovered = contributionFor(recoveredRecord);
Object.keys(recovered.players).forEach(function (playerId) {
  assert.strictEqual(player(recovered, playerId).threeBet.opportunity, null);
  assert.strictEqual(player(recovered, playerId).foldToThreeBet.opportunity, null);
});
assert.ok(hasAmbiguity(recovered, reducer.AMBIGUITY_CODES.HISTORY_INCOMPLETE));

var mainState = reducer.createState({ maxRecords: 30, maxAttempts: 30 });
var aggregateRecords = [
  validFoldRecord,
  callRecord,
  squeezeRecord,
  openerFourBetRecord,
  interveningFourBetRecord,
  fullAllInRecord,
  shortAllInRecord,
  unknownAllInRecord,
  inactiveBeforeOpenRecord,
  missingCapacityRecord,
  incompleteRecord,
  recoveredRecord
];
aggregateRecords.forEach(function (record) {
  var before = JSON.stringify(record);
  var result = reducer.reduce(mainState, record);
  assert.strictEqual(result.reduced, true, record.handIdentity.handId + ' must reduce once');
  assert.strictEqual(result.duplicate, false);
  assert.strictEqual(JSON.stringify(record), before, record.handIdentity.handId + ' reduction must not mutate its input');
});

var mainInspection = reducer.inspect(mainState);
var aggregate = Object.values(mainInspection.totalsByPlayer).reduce(function (sum, total) {
  sum.threeBetOpportunities += total.threeBet.opportunities;
  sum.threeBets += total.threeBet.made;
  sum.foldToThreeBetOpportunities += total.foldToThreeBet.opportunities;
  sum.foldsToThreeBet += total.foldToThreeBet.folds;
  return sum;
}, {
  threeBetOpportunities: 0,
  threeBets: 0,
  foldToThreeBetOpportunities: 0,
  foldsToThreeBet: 0
});
assert.deepStrictEqual(aggregate, {
  threeBetOpportunities: 8,
  threeBets: 6,
  foldToThreeBetOpportunities: 6,
  foldsToThreeBet: 4
});

var totalsBeforeDuplicate = JSON.stringify(mainInspection.totalsByPlayer);
var recordsBeforeDuplicate = mainInspection.contributionRecords.length;
var duplicate = reducer.reduce(mainState, validFoldRecord);
assert.strictEqual(duplicate.reduced, false);
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(duplicate.previouslyReduced, true);
assert.strictEqual(JSON.stringify(reducer.inspect(mainState).totalsByPlayer), totalsBeforeDuplicate);
assert.strictEqual(reducer.inspect(mainState).contributionRecords.length, recordsBeforeDuplicate);

var aliasDuplicate = finalizedRecord('alternate-authoritative-id', ['O1', 'T1'], validFoldRecord.actions, {
  lifecycleHandId: 'valid-fold',
  openingAggressor: 'O1'
});
assert.strictEqual(reducer.reduce(mainState, aliasDuplicate).duplicate, true, 'either finalized-hand alias must suppress duplicates');

var freshState = reducer.createState();
var afterReset = reducer.reduce(freshState, validFoldRecord);
assert.strictEqual(afterReset.reduced, true, 'a new reducer state models Reset Session');
assert.strictEqual(reducer.inspect(freshState).coverage.reducedHandCount, 1);
assert.strictEqual(reducer.inspect(freshState).totalsByPlayer.T1.threeBet.made, 1);
assert.strictEqual(reducer.inspect(freshState).totalsByPlayer.O1.foldToThreeBet.folds, 1);

var boundedState = reducer.createState({ maxRecords: 2, maxAttempts: 10, maxPlayers: 10 });
for (var boundedIndex = 1; boundedIndex <= 11; boundedIndex += 1) {
  var boundedId = 'bounded-' + boundedIndex;
  var boundedPlayer = 'B' + boundedIndex;
  var boundedRecord = finalizedRecord(boundedId, [boundedPlayer], [
    openRaise(1, boundedPlayer)
  ]);
  assert.strictEqual(reducer.reduce(boundedState, boundedRecord).reduced, true);
}
var boundedInspection = reducer.inspect(boundedState);
assert.strictEqual(boundedInspection.contributionRecords.length, 2);
assert.deepStrictEqual(boundedInspection.contributionRecords.map(function (entry) {
  return entry.handIdentity.handId;
}), ['bounded-10', 'bounded-11']);
assert.strictEqual(boundedInspection.reductionAttempts.length, 10);
assert.strictEqual(Object.keys(boundedInspection.totalsByPlayer).length, 10);
assert.strictEqual(boundedInspection.coverage.playerAggregateEvictions, 1);
assert.strictEqual(boundedInspection.totalsByPlayer.B1, undefined);
assert.ok(boundedInspection.totalsByPlayer.B11);


var limperRecord = finalizedRecord('limper-facing-raise', ['L13', 'O13'], [
  decision(1, 'L13', 'call', { amountTo: 20, minimumRaiseToBefore: 40 }),
  openRaise(2, 'O13'),
  decision(3, 'L13', 'fold', { minimumRaiseToBefore: 100 })
]);
var limperContribution = contributionFor(limperRecord);
assert.strictEqual(player(limperContribution, 'L13').threeBet.opportunity, true, 'a prior limper may receive a supported 3Bet opportunity when action returns');
assert.strictEqual(player(limperContribution, 'L13').threeBet.made, false);

var noOpenerResponseRecord = finalizedRecord('no-opener-response', ['O14', 'T14'], [
  openRaise(1, 'O14'),
  fullRaise(2, 'T14')
]);
var noOpenerResponse = contributionFor(noOpenerResponseRecord);
assert.strictEqual(player(noOpenerResponse, 'T14').threeBet.made, true);
assert.strictEqual(player(noOpenerResponse, 'O14').foldToThreeBet.opportunity, null, 'missing action-return evidence stays outside the Fold-to-3Bet denominator');
assert.strictEqual(player(noOpenerResponse, 'O14').foldToThreeBet.response, 'unknown');
assert.ok(hasAmbiguity(noOpenerResponse, reducer.AMBIGUITY_CODES.OPENER_RESPONSE_UNKNOWN));

var responseFreezeRecord = finalizedRecord('response-freeze', ['O15', 'T15', 'X15'], [
  openRaise(1, 'O15'),
  fullRaise(2, 'T15'),
  decision(3, 'O15', 'call', { amountTo: 180 }),
  fullRaise(4, 'X15', { subtype: 'raise_after_three_bet', raiseContext: 'raise_after_three_bet', amountTo: 420, minimumRaiseToBefore: 300 }),
  decision(5, 'O15', 'fold', { minimumRaiseToBefore: 660 })
]);
var responseFreeze = contributionFor(responseFreezeRecord);
assert.strictEqual(player(responseFreeze, 'O15').foldToThreeBet.opportunity, true);
assert.strictEqual(player(responseFreeze, 'O15').foldToThreeBet.folded, false, 'a later fold after the frozen call response cannot overwrite Fold-to-3Bet');
assert.strictEqual(player(responseFreeze, 'O15').foldToThreeBet.response, 'call');
assert.strictEqual(responseFreeze.hand.threeBettor, 'T15');

var openerShortCallRecord = finalizedRecord('opener-short-call', ['O16', 'T16'], [
  openRaise(1, 'O16'),
  fullRaise(2, 'T16'),
  decision(3, 'O16', 'partial_call', { amountTo: 140, minimumRaiseToBefore: 300, isAllIn: true })
]);
var openerShortCall = contributionFor(openerShortCallRecord);
assert.strictEqual(player(openerShortCall, 'O16').foldToThreeBet.opportunity, true);
assert.strictEqual(player(openerShortCall, 'O16').foldToThreeBet.folded, false);
assert.strictEqual(player(openerShortCall, 'O16').foldToThreeBet.response, 'all-in');
assert.strictEqual(player(openerShortCall, 'O16').foldToThreeBet.responseSubtype, 'short_call');

var notReachedRecord = finalizedRecord('action-not-reached', ['O17', 'T17', 'N17'], [
  openRaise(1, 'O17'),
  fullRaise(2, 'T17'),
  decision(3, 'O17', 'fold')
]);
var notReached = contributionFor(notReachedRecord);
assert.strictEqual(player(notReached, 'N17').threeBet.opportunity, false);
assert.strictEqual(player(notReached, 'N17').threeBet.reason, 'action_not_reached_before_three_bet_or_boundary');

var multipleOpenMarkersRecord = finalizedRecord('multiple-open-markers', ['O18', 'T18'], [
  openRaise(1, 'O18'),
  fullRaise(2, 'T18', { raiseContext: 'open_raise' }),
  decision(3, 'O18', 'fold')
]);
var multipleOpenMarkers = contributionFor(multipleOpenMarkersRecord);
assert.strictEqual(multipleOpenMarkers.hand.validThreeBetSequence, null);
Object.keys(multipleOpenMarkers.players).forEach(function (playerId) {
  assert.strictEqual(player(multipleOpenMarkers, playerId).threeBet.opportunity, null);
  assert.strictEqual(player(multipleOpenMarkers, playerId).foldToThreeBet.opportunity, null);
});
assert.ok(hasAmbiguity(multipleOpenMarkers, reducer.AMBIGUITY_CODES.MALFORMED_PREFLOP_SEQUENCE));

var unsupportedSchemaRecord = finalizedRecord('unsupported-schema', ['O19', 'T19'], [
  openRaise(1, 'O19'),
  fullRaise(2, 'T19'),
  decision(3, 'O19', 'fold')
]);
unsupportedSchemaRecord.schemaVersion = 2;
var unsupportedSchema = contributionFor(unsupportedSchemaRecord);
Object.keys(unsupportedSchema.players).forEach(function (playerId) {
  assert.strictEqual(player(unsupportedSchema, playerId).threeBet.opportunity, null);
  assert.strictEqual(player(unsupportedSchema, playerId).foldToThreeBet.opportunity, null);
});
assert.ok(hasAmbiguity(unsupportedSchema, reducer.AMBIGUITY_CODES.SOURCE_SCHEMA_UNSUPPORTED));

console.log('preflop opportunity reducer: synthetic 3Bet/Fold-to-3Bet decisions, voids, deduplication, bounds, aggregates, reset, and immutability verified');
