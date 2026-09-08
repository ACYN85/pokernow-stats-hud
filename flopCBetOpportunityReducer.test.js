'use strict';

var assert = require('assert');
var fs = require('fs');
var reducer = require('./flopCBetOpportunityReducer');
var fixtures = require('./testSupport/flopCBetOpportunityFixtures');

function derive(name) {
  return reducer.deriveContribution(fixtures[name]);
}

function counts(player) {
  return [
    player.flopCBetMade,
    player.flopCBetOpportunities,
    player.foldToFlopCBet,
    player.foldToFlopCBetOpportunities
  ];
}

function ambiguityCodes(contribution) {
  return contribution.ambiguities.map(function (entry) { return entry.code; });
}

assert.strictEqual(reducer.SCHEMA_VERSION, 1);
assert.strictEqual(reducer.MODE, 'isolated_shadow');

var c1 = derive('C1');
assert.deepStrictEqual(counts(c1.players.A), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(c1.players.B), [0, 0, 1, 1]);
assert.strictEqual(c1.players.B.foldToFlopCBetDecision.response, 'fold');
assert.strictEqual(c1.hand.qualifyingCBet, true);

var c2 = derive('C2');
assert.deepStrictEqual(counts(c2.players.A), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(c2.players.B), [0, 0, 0, 1]);
assert.strictEqual(c2.players.B.foldToFlopCBetDecision.response, 'call');

var c3 = derive('C3');
assert.deepStrictEqual(counts(c3.players.A), [0, 1, 0, 0]);
assert.deepStrictEqual(counts(c3.players.B), [0, 0, 0, 0]);
assert.strictEqual(c3.players.A.flopCBet.opportunity, true);
assert.strictEqual(c3.players.A.flopCBet.made, false);
assert.strictEqual(c3.hand.qualifyingCBet, false);

var c4 = derive('C4');
assert.deepStrictEqual(counts(c4.players.A), [0, 0, 0, 0]);
assert.deepStrictEqual(counts(c4.players.B), [0, 0, 0, 0]);
assert.strictEqual(c4.players.A.flopCBet.opportunity, false);
assert.strictEqual(c4.hand.priorDonkBettor, 'B');
assert.strictEqual(c4.hand.qualifyingCBet, false);

var c5 = derive('C5');
assert.deepStrictEqual(counts(c5.players.A), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(c5.players.B), [0, 0, 1, 1]);
assert.deepStrictEqual(counts(c5.players.C), [0, 0, 0, 1]);
assert.strictEqual(c5.players.B.foldToFlopCBetDecision.response, 'fold');
assert.strictEqual(c5.players.C.foldToFlopCBetDecision.response, 'call');

var c6 = derive('C6');
assert.strictEqual(c6.hand.finalPreflopAggressor, 'B');
assert.deepStrictEqual(counts(c6.players.B), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(c6.players.A), [0, 0, 0, 0]);
assert.strictEqual(c6.players.A.foldToFlopCBetDecision.opportunity, null);
assert.strictEqual(c6.players.A.supported, false);
assert.ok(ambiguityCodes(c6).includes(reducer.AMBIGUITY_CODES.RESPONSE_UNOBSERVED));

var c7 = derive('C7');
assert.strictEqual(c7.hand.finalPreflopAggressor, 'A');
assert.deepStrictEqual(counts(c7.players.A), [1, 1, 0, 0]);
assert.strictEqual(c7.players.B.foldToFlopCBetDecision.opportunity, null);
assert.strictEqual(c7.players.B.supported, false);

var c8 = derive('C8');
assert.deepStrictEqual(counts(c8.players.A), [0, 0, 0, 0]);
assert.deepStrictEqual(counts(c8.players.B), [0, 0, 0, 0]);
assert.strictEqual(c8.players.A.flopCBet.opportunity, false);
assert.strictEqual(c8.players.A.supported, true);
assert.strictEqual(c8.hand.qualifyingCBet, false);

var c9 = derive('C9');
['A', 'B', 'C'].forEach(function (playerId) {
  assert.deepStrictEqual(counts(c9.players[playerId]), [0, 0, 0, 0]);
  assert.strictEqual(c9.players[playerId].supported, false);
  assert.strictEqual(c9.players[playerId].flopCBet.opportunity, null);
  assert.strictEqual(c9.players[playerId].foldToFlopCBetDecision.opportunity, null);
});
assert.ok(ambiguityCodes(c9).includes(reducer.AMBIGUITY_CODES.SIDE_POT_ELIGIBILITY_UNSUPPORTED));

var c10 = derive('C10');
assert.deepStrictEqual(counts(c10.players.A), [1, 1, 0, 0]);
assert.deepStrictEqual(counts(c10.players.B), [0, 0, 0, 1]);
assert.deepStrictEqual(counts(c10.players.C), [0, 0, 0, 0]);
assert.strictEqual(c10.players.B.foldToFlopCBetDecision.response, 'call');
assert.strictEqual(c10.players.C.foldToFlopCBetDecision.opportunity, false);
assert.strictEqual(c10.players.C.supported, true);

var c11 = derive('C11');
['A', 'B'].forEach(function (playerId) {
  assert.deepStrictEqual(counts(c11.players[playerId]), [0, 0, 0, 0]);
  assert.strictEqual(c11.players[playerId].supported, false);
  assert.strictEqual(c11.players[playerId].flopCBet.opportunity, null);
});
assert.ok(ambiguityCodes(c11).includes(reducer.AMBIGUITY_CODES.FLOP_ORDERING_UNSUPPORTED));

function deepRecord(id, preflopActions, finalAggressor, flopActions, options) {
  options = options || {};
  var players = (options.playerIds || ['A', 'B']).map(function (playerId) {
    return fixtures.player(playerId, options.playerDetails && options.playerDetails[playerId]);
  });
  return fixtures.record(id, {
    players: players,
    entrants: options.entrants || (options.playerIds || ['A', 'B']),
    openingAggressor: preflopActions[0].playerId,
    finalAggressor: finalAggressor,
    actions: preflopActions.concat(flopActions),
    sidePotStatus: options.sidePotStatus
  });
}

var fiveBetRecord = deepRecord('CBET-FIVE-BET', [
  fixtures.action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(2, 'preflop', 'B', 'raise', { isFullRaise: true }),
  fixtures.action(3, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(4, 'preflop', 'B', 'raise', { isFullRaise: true }),
  fixtures.action(5, 'preflop', 'A', 'call')
], 'B', [
  fixtures.action(6, 'flop', 'A', 'check'),
  fixtures.action(7, 'flop', 'B', 'bet')
]);
var fiveBet = reducer.deriveContribution(fiveBetRecord);
assert.deepStrictEqual(counts(fiveBet.players.B), [1, 1, 0, 0], 'the 5-bettor owns the CBet without a depth-specific branch');

var arbitraryRaises = [];
for (var raiseIndex = 0; raiseIndex < 8; raiseIndex += 1) {
  arbitraryRaises.push(fixtures.action(raiseIndex + 1, 'preflop', raiseIndex % 2 ? 'B' : 'A', 'raise', { isFullRaise: true }));
}
arbitraryRaises.push(fixtures.action(9, 'preflop', 'A', 'call'));
var arbitraryDepth = reducer.deriveContribution(deepRecord('CBET-ARBITRARY-DEPTH', arbitraryRaises, 'B', [
  fixtures.action(10, 'flop', 'A', 'check'),
  fixtures.action(11, 'flop', 'B', 'bet')
]));
assert.deepStrictEqual(counts(arbitraryDepth.players.B), [1, 1, 0, 0], 'the final qualifying full raiser owns CBet at arbitrary depth');

var multiwayFourBet = reducer.deriveContribution(deepRecord('CBET-MULTIWAY-FOUR-BET', [
  fixtures.action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(2, 'preflop', 'B', 'call'),
  fixtures.action(3, 'preflop', 'C', 'raise', { isFullRaise: true }),
  fixtures.action(4, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(5, 'preflop', 'B', 'call'),
  fixtures.action(6, 'preflop', 'C', 'call')
], 'A', [
  fixtures.action(7, 'flop', 'B', 'check'),
  fixtures.action(8, 'flop', 'C', 'check'),
  fixtures.action(9, 'flop', 'A', 'bet'),
  fixtures.action(10, 'flop', 'B', 'call'),
  fixtures.action(11, 'flop', 'C', 'call')
], { playerIds: ['A', 'B', 'C'] }));
assert.deepStrictEqual(counts(multiwayFourBet.players.A), [1, 1, 0, 0]);

var deepDonk = reducer.deriveContribution(deepRecord('CBET-DEEP-DONK', fiveBetRecord.actions.slice(0, 5), 'B', [
  fixtures.action(6, 'flop', 'A', 'bet'),
  fixtures.action(7, 'flop', 'B', 'fold')
]));
assert.deepStrictEqual(counts(deepDonk.players.B), [0, 0, 0, 0], 'a prior donk still removes the conventional opportunity in a deep pot');

var shortDoesNotReplace = reducer.deriveContribution(deepRecord('CBET-SHORT-DOES-NOT-REPLACE', [
  fixtures.action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(2, 'preflop', 'C', 'raise', { isFullRaise: false, isShortAllInRaise: true, isAllIn: true }),
  fixtures.action(3, 'preflop', 'A', 'call'),
  fixtures.action(4, 'preflop', 'B', 'call')
], 'A', [
  fixtures.action(5, 'flop', 'B', 'check'),
  fixtures.action(6, 'flop', 'A', 'bet'),
  fixtures.action(7, 'flop', 'B', 'call')
], { playerIds: ['A', 'B', 'C'], sidePotStatus: false, playerDetails: { C: { allIn: true } } }));
assert.strictEqual(shortDoesNotReplace.hand.finalPreflopAggressor, 'A');
assert.deepStrictEqual(counts(shortDoesNotReplace.players.A), [1, 1, 0, 0]);

var reopenedAfterShort = reducer.deriveContribution(deepRecord('CBET-REOPENED-AFTER-SHORT', [
  fixtures.action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
  fixtures.action(2, 'preflop', 'C', 'raise', { isFullRaise: false, isShortAllInRaise: true, isAllIn: true }),
  fixtures.action(3, 'preflop', 'B', 'raise', { isFullRaise: true }),
  fixtures.action(4, 'preflop', 'A', 'call')
], 'B', [
  fixtures.action(5, 'flop', 'A', 'check'),
  fixtures.action(6, 'flop', 'B', 'bet'),
  fixtures.action(7, 'flop', 'A', 'call')
], { playerIds: ['A', 'B', 'C'], sidePotStatus: false, playerDetails: { C: { allIn: true } } }));
assert.strictEqual(reopenedAfterShort.hand.finalPreflopAggressor, 'B');
assert.deepStrictEqual(counts(reopenedAfterShort.players.B), [1, 1, 0, 0]);

var state = reducer.createState();
var first = reducer.reduce(state, fixtures.C1);
var duplicate = reducer.reduce(state, fixtures.C1);
assert.strictEqual(first.reduced, true);
assert.strictEqual(duplicate.duplicate, true);
var inspection = reducer.inspect(state);
assert.strictEqual(inspection.coverage.reducedHandCount, 1);
assert.deepStrictEqual(inspection.totalsByPlayer.A, {
  flopCBetMade: 1,
  flopCBetOpportunities: 1,
  foldToFlopCBet: 0,
  foldToFlopCBetOpportunities: 0,
  contributingHands: 1,
  lastHandId: 'C1'
});
assert.deepStrictEqual(inspection.totalsByPlayer.B, {
  flopCBetMade: 0,
  flopCBetOpportunities: 0,
  foldToFlopCBet: 1,
  foldToFlopCBetOpportunities: 1,
  contributingHands: 1,
  lastHandId: 'C1'
});

var seededState = reducer.createState({ finalizedHandIds: ['RESTORED-HAND'] });
var restoredFixture = JSON.parse(JSON.stringify(fixtures.C1));
restoredFixture.handIdentity.handId = 'RESTORED-HAND';
assert.strictEqual(reducer.reduce(seededState, restoredFixture).duplicate, true, 'restored finalized identities seed reducer deduplication');

var attachmentState = reducer.createState();
var lifecycleContribution = JSON.parse(JSON.stringify(c1));
lifecycleContribution.handIdentity = { lifecycleHandId: 'lifecycle-C1', handId: 'C1' };
var finalizedEvents = [
  { eventKey: 'lifecycle-C1:A:dealt', handId: 'lifecycle-C1', playerId: 'A', player: 'Alice', action: 'dealt' },
  { eventKey: 'lifecycle-C1:B:fold', handId: 'lifecycle-C1', playerId: 'B', player: 'Bob', action: 'fold' }
];
var eventsBeforeAttachment = JSON.stringify(finalizedEvents);
var attached = reducer.attach(attachmentState, finalizedEvents, lifecycleContribution);
assert.strictEqual(attached.attachedCount, 2);
assert.strictEqual(attached.duplicateCount, 0);
assert.deepStrictEqual(attached.missingPlayerIds, []);
assert.deepStrictEqual(attached.attachmentResults[0].candidateHandIds, ['lifecycle-C1', 'C1'], 'lifecycle identity is preferred before the authoritative identity');
assert.strictEqual(attached.attachmentResults[0].targetHandId, 'lifecycle-C1');
assert.strictEqual(attached.attachmentResults[0].playerId, 'A');
assert.deepStrictEqual(attached.attachmentResults[0].fields, {
  flopCBetMade: 1,
  flopCBetOpportunities: 1,
  foldToFlopCBet: 0,
  foldToFlopCBetOpportunities: 0,
  supported: true,
  unsupportedReason: null
});
assert.strictEqual(JSON.stringify(finalizedEvents), eventsBeforeAttachment, 'shadow attachment never annotates or mutates authoritative live events');

var duplicateAttachment = reducer.attach(attachmentState, finalizedEvents, lifecycleContribution);
assert.strictEqual(duplicateAttachment.attachedCount, 0);
assert.strictEqual(duplicateAttachment.duplicateCount, 2, 'statistic-specific contribution IDs reject duplicate attachment');

var nameOnlyEvents = [{ handId: 'lifecycle-C1', playerId: 'different-id', player: 'Alice', action: 'dealt' }];
var nameOnlyState = reducer.createState();
var noFuzzyAttachment = reducer.attach(nameOnlyState, nameOnlyEvents, lifecycleContribution);
assert.strictEqual(noFuzzyAttachment.attachedCount, 0, 'display names never substitute for stable player IDs');
assert.deepStrictEqual(noFuzzyAttachment.missingPlayerIds.sort(), ['A', 'B']);

var unsupportedState = reducer.createState();
var unsupportedContribution = JSON.parse(JSON.stringify(c9));
unsupportedContribution.handIdentity = { lifecycleHandId: 'lifecycle-C9', handId: 'C9' };
var unsupportedEvents = ['A', 'B', 'C'].map(function (playerId) {
  return { handId: 'lifecycle-C9', playerId: playerId, player: playerId, action: 'dealt' };
});
var unsupportedAttachment = reducer.attach(unsupportedState, unsupportedEvents, unsupportedContribution);
assert.strictEqual(unsupportedAttachment.attachedCount, 3);
unsupportedAttachment.attachmentResults.forEach(function (record) {
  assert.strictEqual(record.fields.supported, false);
  assert.strictEqual(record.fields.flopCBetOpportunities, 0);
  assert.strictEqual(record.fields.foldToFlopCBetOpportunities, 0);
  assert.ok(record.fields.unsupportedReason, 'unsupported/null state retains an explicit reason');
});

var reducerSource = fs.readFileSync('./flopCBetOpportunityReducer.js', 'utf8');
assert.doesNotMatch(reducerSource, /document\.|chrome\.storage|WebSocket|addEventListener/, 'the shadow reducer adds no DOM, storage, transport, or listener ownership');

console.log('flopCBetOpportunityReducer focused C1-C11 tests passed');
