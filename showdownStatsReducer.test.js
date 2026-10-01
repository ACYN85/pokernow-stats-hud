'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var reducer = require('./showdownStatsReducer');
var fixtures = require('./testSupport/showdownStatsFixtures');
var authoritativeReplay = require('./testSupport/captureDerivedPreflopProductionReplay');

function derive(name) {
  var before = JSON.stringify(fixtures[name]);
  var contribution = reducer.deriveContribution(fixtures[name]);
  assert.strictEqual(JSON.stringify(fixtures[name]), before, name + ' input remains immutable');
  return contribution;
}

function summary(player) {
  return {
    sawFlop: player.sawFlopForWTSD,
    showdown: player.wentToShowdown,
    outcome: player.showdownOutcome,
    gross: player.showdownGrossAward,
    eligible: player.potsEligible,
    won: player.potsWon,
    tied: player.potsTied,
    lost: player.potsLost
  };
}

function codes(contribution) {
  return contribution.ambiguities.map(function (entry) { return entry.code; });
}

assert.strictEqual(reducer.SCHEMA_VERSION, 1);
assert.strictEqual(reducer.MODE, 'isolated_shadow');

var s1 = derive('S1');
assert.deepStrictEqual(summary(s1.players.B), { sawFlop: 1, showdown: 0, outcome: null, gross: null, eligible: null, won: null, tied: null, lost: null });
assert.strictEqual(s1.players.B.wtsdOpportunityCount, 1);
assert.strictEqual(s1.players.B.wtsdCount, 0);
assert.strictEqual(s1.players.B.showdownOpportunityCount, 0);

var s2 = derive('S2');
assert.strictEqual(s2.players.B.sawFlopForWTSD, 1);
assert.strictEqual(s2.players.B.wentToShowdown, 0);

var s3 = derive('S3');
assert.deepStrictEqual(summary(s3.players.A), { sawFlop: 1, showdown: 1, outcome: 'win', gross: 200, eligible: 1, won: 1, tied: 0, lost: 0 });
assert.deepStrictEqual(summary(s3.players.B), { sawFlop: 1, showdown: 1, outcome: 'loss', gross: 0, eligible: 1, won: 0, tied: 0, lost: 1 });
assert.deepStrictEqual([s3.players.A.wonMoneyAtShowdownCandidate, s3.players.B.wonMoneyAtShowdownCandidate], [1, 0]);

var s4 = derive('S4');
assert.strictEqual(fixtures.S4.showdown.participants.includes('B'), false, 'the mucked fixture does not pretend the losing cards were exposed');
assert.strictEqual(fixtures.S4.players.find(function (player) { return player.playerId === 'B'; }).reachedShowdown, true, 'the finalized semantic fixture supplies independent terminal membership');
assert.strictEqual(s4.players.B.wentToShowdown, 1);
assert.strictEqual(s4.players.B.showdownOutcome, 'loss');
assert.ok(s4.players.B.evidence.showdown.some(function (entry) { return entry.kind === 'explicit-mucked-or-unshown-participant'; }));

var s5 = derive('S5');
assert.strictEqual(s5.players.A.wtsdOpportunityCount, 1);
assert.strictEqual(s5.players.B.wtsdOpportunityCount, 1);
assert.strictEqual(s5.players.A.wentToShowdown, 0);
assert.strictEqual(s5.players.B.wentToShowdown, 0);
assert.strictEqual(s5.players.A.showdownOpportunityCount, 0);
assert.strictEqual(s5.players.B.showdownOpportunityCount, 0);

var s6 = derive('S6');
assert.strictEqual(s6.players.A.wentToShowdown, 1);
assert.strictEqual(s6.players.B.wentToShowdown, 1);
assert.strictEqual(s6.players.A.showdownOutcome, 'loss');
assert.strictEqual(s6.players.B.showdownOutcome, 'win');

var s7 = derive('S7');
assert.strictEqual(fixtures.S7.automaticRunout.detected, true);
assert.strictEqual(s7.players.A.sawFlopForWTSD, 1);
assert.strictEqual(s7.players.B.sawFlopForWTSD, 1);
assert.strictEqual(s7.players.A.wentToShowdown, 1);
assert.strictEqual(s7.players.B.wentToShowdown, 1);
assert.strictEqual(s7.players.B.showdownOutcome, 'win');

var s8 = derive('S8');
assert.strictEqual(fixtures.S8.automaticRunout.detected, true);
assert.strictEqual(s8.players.A.wentToShowdown, 1);
assert.strictEqual(s8.players.B.wentToShowdown, 1);
assert.strictEqual(s8.players.A.showdownOutcome, 'win');

var s9 = derive('S9');
assert.strictEqual(s9.players.A.showdownOutcome, 'tie');
assert.strictEqual(s9.players.B.showdownOutcome, 'tie');
assert.strictEqual(s9.players.A.showdownGrossAward, 100);
assert.strictEqual(s9.players.B.showdownGrossAward, 100);
assert.strictEqual(s9.players.A.potsTied, 1);
assert.strictEqual(s9.players.A.potsWon, 0, 'a tie is retained rather than silently becoming a strict win');

var s10 = derive('S10');
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return s10.players[id].wentToShowdown; }), [1, 1, 1]);
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return s10.players[id].showdownOutcome; }), ['win', 'loss', 'loss']);

var s11 = derive('S11');
assert.strictEqual(s11.hand.potModel, 'explicit_pots');
assert.strictEqual(s11.players.A.showdownOutcome, 'win', 'main-pot winner not eligible for the side pot has one supported win');
assert.strictEqual(s11.players.B.showdownOutcome, 'mixed', 'side-pot winner also lost the main pot');
assert.strictEqual(s11.players.C.showdownOutcome, 'loss');
assert.deepStrictEqual([s11.players.B.potsEligible, s11.players.B.potsWon, s11.players.B.potsLost], [2, 1, 1]);

var s12 = derive('S12');
assert.strictEqual(s12.players.B.showdownOutcome, 'mixed');
assert.strictEqual(s12.players.B.showdownGrossAward, 150);
assert.strictEqual(s12.players.B.potsWon, 1);
assert.strictEqual(s12.players.B.potsLost, 1);

var s13 = derive('S13');
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return s13.players[id].showdownOutcome; }), ['tie', 'tie', 'tie']);
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return s13.players[id].showdownGrossAward; }), [101, 100, 100]);
assert.strictEqual(s13.players.A.showdownGrossAward, 101, 'unequal shares remain exact and are not converted to 0.5');

var s14 = derive('S14');
assert.strictEqual(s14.players.A.showdownGrossAward, 400, 'the 50-chip return is excluded from the gross showdown award');
assert.strictEqual(s14.players.A.showdownNetResult, 200, 'exact full-hand reconciliation supports net result');
assert.strictEqual(s14.players.B.showdownNetResult, -200);
assert.strictEqual(fixtures.S14.settlement.refunds[0].amount, 50);
assert.deepStrictEqual([s14.players.A.contestedGrossAward, s14.players.A.excludedReturnAmount, s14.players.A.wonMoneyAtShowdownCandidate], [400, 50, 1]);

var incompleteSidePotRecord = JSON.parse(JSON.stringify(fixtures.S11));
incompleteSidePotRecord.handIdentity = { handId: 'INCOMPLETE-SIDE-POT-AUTH', lifecycleHandId: 'INCOMPLETE-SIDE-POT-LIFE', gameNumber: 111 };
incompleteSidePotRecord.settlement.pots[1].awards = [];
var incompleteSidePot = reducer.deriveContribution(incompleteSidePotRecord);
['A', 'B', 'C'].forEach(function (playerId) {
  assert.strictEqual(incompleteSidePot.players[playerId].wonMoneyAtShowdownCandidate, null);
  assert.strictEqual(incompleteSidePot.players[playerId].wonMoneyAtShowdownCandidateSupported, false);
});
assert.ok(codes(incompleteSidePot).includes(reducer.AMBIGUITY_CODES.POT_ELIGIBILITY_UNSUPPORTED), 'explicit incomplete side-pot settlement remains unsupported');

var multipleAwardsRecord = JSON.parse(JSON.stringify(fixtures.S11));
multipleAwardsRecord.handIdentity = { handId: 'MULTIPLE-AWARDS-AUTH', lifecycleHandId: 'MULTIPLE-AWARDS-LIFE', gameNumber: 112 };
multipleAwardsRecord.settlement.awards = [
  { awardId: 'main-to-b', playerId: 'B', amount: 300, potId: 'main' },
  { awardId: 'side-to-b', playerId: 'B', amount: 200, potId: 'side' }
];
multipleAwardsRecord.settlement.totalsByPlayer = { B: 500 };
multipleAwardsRecord.settlement.totalAwardAmount = 500;
multipleAwardsRecord.settlement.pots[0].awards = [{ playerId: 'B', amount: 300 }];
multipleAwardsRecord.settlement.pots[1].awards = [{ playerId: 'B', amount: 200 }];
var multipleAwards = reducer.deriveContribution(multipleAwardsRecord);
assert.deepStrictEqual([
  multipleAwards.players.B.wonMoneyAtShowdownCandidate,
  multipleAwards.players.B.showdownGrossAward,
  multipleAwards.players.B.potsWon,
  multipleAwards.players.B.showdownOpportunityCount
], [1, 500, 2, 1], 'multiple positive contested awards still produce one hand-level W$SD success');

var mainWinSideLossRecord = JSON.parse(JSON.stringify(fixtures.S11));
mainWinSideLossRecord.handIdentity = { handId: 'MAIN-WIN-SIDE-LOSS-AUTH', lifecycleHandId: 'MAIN-WIN-SIDE-LOSS-LIFE', gameNumber: 113 };
mainWinSideLossRecord.settlement.awards = [
  { awardId: 'main-to-b', playerId: 'B', amount: 300, potId: 'main' },
  { awardId: 'side-to-c', playerId: 'C', amount: 200, potId: 'side' }
];
mainWinSideLossRecord.settlement.totalsByPlayer = { B: 300, C: 200 };
mainWinSideLossRecord.settlement.totalAwardAmount = 500;
mainWinSideLossRecord.settlement.pots[0].awards = [{ playerId: 'B', amount: 300 }];
mainWinSideLossRecord.settlement.pots[1].awards = [{ playerId: 'C', amount: 200 }];
var mainWinSideLoss = reducer.deriveContribution(mainWinSideLossRecord);
assert.strictEqual(mainWinSideLoss.players.B.showdownOutcome, 'mixed');
assert.strictEqual(mainWinSideLoss.players.B.wonMoneyAtShowdownCandidate, 1, 'winning the main pot and losing the side pot remains a hand-level W$SD success');

var refundOnlyLoserRecord = JSON.parse(JSON.stringify(fixtures.S3));
refundOnlyLoserRecord.handIdentity = { handId: 'REFUND-ONLY-LOSER-AUTH', lifecycleHandId: 'REFUND-ONLY-LOSER-LIFE', gameNumber: 114 };
refundOnlyLoserRecord.settlement.awards = [{ awardId: 'pot-to-b', playerId: 'B', amount: 200 }];
refundOnlyLoserRecord.settlement.totalsByPlayer = { B: 200 };
refundOnlyLoserRecord.settlement.totalAwardAmount = 200;
refundOnlyLoserRecord.settlement.refunds = [{ playerId: 'A', amount: 50, kind: 'uncalled_return' }];
var refundOnlyLoser = reducer.deriveContribution(refundOnlyLoserRecord);
assert.deepStrictEqual([
  refundOnlyLoser.players.A.wonMoneyAtShowdownCandidate,
  refundOnlyLoser.players.A.contestedGrossAward,
  refundOnlyLoser.players.A.excludedReturnAmount
], [0, 0, 50], 'refund-only money never becomes a W$SD win');

// Independent side-pot certification matrix: reverse winners, same-player wins,
// chopped main/side pots, folded-player eligibility, and hand-level W$SD remain exact.
function sidePotVariant(id, configure) {
  var value = JSON.parse(JSON.stringify(fixtures.S11));
  value.handIdentity = { handId: id + '-AUTH', lifecycleHandId: id + '-LIFE', gameNumber: 200 };
  configure(value);
  value.settlement.totalsByPlayer = value.settlement.awards.reduce(function (totals, award) {
    totals[award.playerId] = (totals[award.playerId] || 0) + award.amount;
    return totals;
  }, {});
  value.settlement.totalAwardAmount = value.settlement.awards.reduce(function (sum, award) { return sum + award.amount; }, 0);
  return reducer.deriveContribution(value);
}

var reverseWinners = sidePotVariant('SIDE-REVERSE-WINNERS', function (value) {
  value.settlement.awards = [{ awardId: 'main-b', playerId: 'B', amount: 300, potId: 'main' }, { awardId: 'side-a', playerId: 'A', amount: 200, potId: 'side' }];
  value.settlement.pots = [
    { potId: 'main', amount: 300, eligiblePlayerIds: ['A', 'B', 'C'], awards: [{ playerId: 'B', amount: 300 }] },
    { potId: 'side', amount: 200, eligiblePlayerIds: ['A', 'C'], awards: [{ playerId: 'A', amount: 200 }] }
  ];
});
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return reverseWinners.players[id].wonMoneyAtShowdownCandidate; }), [1, 1, 0], 'main winner B and side winner A each receive one hand-level W$SD win');
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return reverseWinners.players[id].showdownOutcome; }), ['mixed', 'win', 'loss']);

var oneWinsBoth = sidePotVariant('SIDE-ONE-WINS-BOTH', function (value) {
  value.settlement.awards = [{ awardId: 'main-b', playerId: 'B', amount: 300, potId: 'main' }, { awardId: 'side-b', playerId: 'B', amount: 200, potId: 'side' }];
  value.settlement.pots[0].awards = [{ playerId: 'B', amount: 300 }];
  value.settlement.pots[1].awards = [{ playerId: 'B', amount: 200 }];
});
assert.deepStrictEqual([oneWinsBoth.players.B.wonMoneyAtShowdownCandidate, oneWinsBoth.players.B.potsWon, oneWinsBoth.players.B.showdownOpportunityCount], [1, 2, 1], 'winning multiple pots remains one W$SD success');

var choppedMain = sidePotVariant('SIDE-CHOPPED-MAIN', function (value) {
  value.settlement.awards = [{ awardId: 'main-a', playerId: 'A', amount: 150, potId: 'main' }, { awardId: 'main-b', playerId: 'B', amount: 150, potId: 'main' }, { awardId: 'side-b', playerId: 'B', amount: 200, potId: 'side' }];
  value.settlement.pots[0].awards = [{ playerId: 'A', amount: 150 }, { playerId: 'B', amount: 150 }];
  value.settlement.pots[1].awards = [{ playerId: 'B', amount: 200 }];
});
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return choppedMain.players[id].wonMoneyAtShowdownCandidate; }), [1, 1, 0], 'chopped-main recipients each receive a binary hand-level W$SD win');
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return choppedMain.players[id].showdownOutcome; }), ['tie', 'mixed', 'loss']);

var choppedSide = sidePotVariant('SIDE-CHOPPED-SIDE', function (value) {
  value.settlement.awards = [{ awardId: 'main-a', playerId: 'A', amount: 300, potId: 'main' }, { awardId: 'side-b', playerId: 'B', amount: 100, potId: 'side' }, { awardId: 'side-c', playerId: 'C', amount: 100, potId: 'side' }];
  value.settlement.pots[0].awards = [{ playerId: 'A', amount: 300 }];
  value.settlement.pots[1].awards = [{ playerId: 'B', amount: 100 }, { playerId: 'C', amount: 100 }];
});
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return choppedSide.players[id].wonMoneyAtShowdownCandidate; }), [1, 1, 1], 'chopped-side recipients and main winner each receive one W$SD win');
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return choppedSide.players[id].showdownOutcome; }), ['win', 'mixed', 'mixed']);

var foldedIneligible = JSON.parse(JSON.stringify(fixtures.S10));
foldedIneligible.handIdentity = { handId: 'SIDE-FOLDED-INELIGIBLE-AUTH', lifecycleHandId: 'SIDE-FOLDED-INELIGIBLE-LIFE', gameNumber: 201 };
foldedIneligible.players.find(function (player) { return player.playerId === 'C'; }).folded = true;
foldedIneligible.players.find(function (player) { return player.playerId === 'C'; }).reachedShowdown = false;
foldedIneligible.showdown.participants = ['A', 'B'];
foldedIneligible.actions.push({ sequence: 99, sourceSequence: 99, street: 'river', playerId: 'C', type: 'fold', confidence: 'direct' });
foldedIneligible.settlement = JSON.parse(JSON.stringify(fixtures.S3.settlement));
var foldedResult = reducer.deriveContribution(foldedIneligible);
assert.deepStrictEqual([foldedResult.players.C.wentToShowdown, foldedResult.players.C.wonMoneyAtShowdownCandidateSupported], [0, false], 'a folded player remains outside later contested-pot eligibility');

assert.deepStrictEqual([
  s10.players.A.wonMoneyAtShowdownCandidate,
  s11.players.A.wonMoneyAtShowdownCandidate,
  reverseWinners.players.B.wonMoneyAtShowdownCandidate,
  oneWinsBoth.players.B.wonMoneyAtShowdownCandidate,
  choppedMain.players.A.wonMoneyAtShowdownCandidate,
  choppedSide.players.B.wonMoneyAtShowdownCandidate,
  refundOnlyLoser.players.A.wonMoneyAtShowdownCandidate,
  s14.players.A.wonMoneyAtShowdownCandidate,
  incompleteSidePot.players.A.wonMoneyAtShowdownCandidate,
  foldedResult.players.C.wonMoneyAtShowdownCandidate,
  s11.players.B.potsEligible,
  multipleAwards.players.B.showdownOpportunityCount
], [1, 1, 1, 1, 1, 1, 0, 1, null, null, 2, 1], 'side-pot certification matrix preserves winner, refund, unsupported, eligibility, and exactly-once contracts');

var s15 = derive('S15');
assert.strictEqual(s15.players.A.sawFlopForWTSD, 0);
assert.strictEqual(s15.players.B.sawFlopForWTSD, 0);
assert.strictEqual(s15.players.A.wtsdOpportunityCount, 0);
assert.strictEqual(s15.players.B.showdownOpportunityCount, 0);

var s16 = derive('S16');
assert.strictEqual(s16.players.B.sawFlopForWTSD, 1);
assert.strictEqual(s16.players.B.wentToShowdown, 0);

var s17 = derive('S17');
assert.strictEqual(s17.players.A.sawFlopForWTSD, null);
assert.strictEqual(s17.players.A.wentToShowdown, null);
assert.strictEqual(s17.players.B.sawFlopForWTSD, null);
assert.ok(codes(s17).includes(reducer.AMBIGUITY_CODES.ACTION_ORDER_UNSUPPORTED));

var s18 = derive('S18');
assert.strictEqual(s18.players.A.wentToShowdown, 1);
assert.strictEqual(s18.players.B.wentToShowdown, 1);
assert.strictEqual(s18.players.A.showdownOutcome, 'unsupported');
assert.strictEqual(s18.players.A.showdownGrossAward, null);
assert.strictEqual(s18.players.A.outcomeSupported, false);
assert.strictEqual(s18.players.A.wonMoneyAtShowdownCandidate, null);
assert.strictEqual(s18.players.A.wonMoneyAtShowdownCandidateSupported, false);
assert.ok(codes(s18).includes(reducer.AMBIGUITY_CODES.SETTLEMENT_UNRESOLVED));

var s19 = derive('S19');
assert.strictEqual(s19.hand.duplicateAwardRecordsIgnored, 1);
assert.strictEqual(s19.players.A.showdownGrossAward, 200, 'duplicate award evidence is not summed twice');
assert.strictEqual(s19.players.A.showdownOutcome, 'win');
assert.ok(codes(s19).includes(reducer.AMBIGUITY_CODES.DUPLICATE_AWARD_RECORD));

var s20 = derive('S20');
assert.deepStrictEqual(s20.handIdentity, { handId: 'S20-AUTHORITATIVE-HAND', lifecycleHandId: 'S20-LIFECYCLE-HAND', gameNumber: 20 });
assert.strictEqual(s20.players.B.showdownOutcome, 'win');

var state = reducer.createState();
var first = reducer.reduce(state, fixtures.S20);
var duplicate = reducer.reduce(state, fixtures.S20);
assert.strictEqual(first.reduced, true);
assert.strictEqual(duplicate.duplicate, true);
var lifecycleAliasReplay = JSON.parse(JSON.stringify(fixtures.S20));
lifecycleAliasReplay.handIdentity.handId = 'DIFFERENT-AUTHORITATIVE-ID';
assert.strictEqual(reducer.reduce(state, lifecycleAliasReplay).duplicate, true, 'an exact lifecycle identity alias prevents duplicate reduction');
var merelySimilar = JSON.parse(JSON.stringify(fixtures.S20));
merelySimilar.handIdentity.handId = 'S20-AUTHORITATIVE-HAND-OTHER';
merelySimilar.handIdentity.lifecycleHandId = 'S20-LIFECYCLE-HAND-OTHER';
assert.strictEqual(reducer.reduce(state, merelySimilar).reduced, true, 'similar strings are not fuzzy-matched');
var inspection = reducer.inspect(state);
assert.strictEqual(inspection.coverage.reducedHandCount, 2);
assert.strictEqual(inspection.totalsByPlayer.B.wtsdOpportunities, 2);
assert.strictEqual(inspection.totalsByPlayer.B.wentToShowdown, 2);
assert.strictEqual(inspection.totalsByPlayer.B.outcomes.win, 2);
assert.strictEqual(inspection.totalsByPlayer.B.wonMoneyAtShowdownCandidates, 2);
assert.strictEqual(inspection.totalsByPlayer.B.wonMoneyAtShowdownCandidateOpportunities, 2);

var associationEvents = [{ handId: fixtures.S20.handIdentity.lifecycleHandId, playerId: 'A', action: 'check' }, { handId: fixtures.S20.handIdentity.lifecycleHandId, playerId: 'B', action: 'check' }];
var associationBefore = JSON.stringify(associationEvents);
var associationState = reducer.createState({ maxAttachments: 10 });
var associationContribution = reducer.deriveContribution(fixtures.S20);
var association = reducer.attach(associationState, associationEvents, associationContribution);
assert.strictEqual(association.attachedCount, 2);
assert.strictEqual(association.duplicateCount, 0);
assert.deepStrictEqual(association.attachmentResults[0].candidateHandIds, [fixtures.S20.handIdentity.lifecycleHandId, fixtures.S20.handIdentity.handId]);
assert.strictEqual(JSON.stringify(associationEvents), associationBefore, 'shadow association never annotates authoritative events');
assert.strictEqual(reducer.attach(associationState, associationEvents, associationContribution).duplicateCount, 2, 'duplicate association is rejected');

var boundedState = reducer.createState({ maxRecords: 1, maxAttempts: 10 });
reducer.reduce(boundedState, fixtures.S1);
reducer.reduce(boundedState, fixtures.S2);
assert.strictEqual(reducer.inspect(boundedState).contributionRecords.length, 1, 'contribution inspection remains bounded');

var boundedIdentityState = reducer.createState({ maxIdentityAliases: 10 });
for (var identityIndex = 0; identityIndex < 12; identityIndex += 1) {
  var identityFixture = JSON.parse(JSON.stringify(fixtures.S1));
  identityFixture.handIdentity.handId = 'BOUNDED-AUTH-' + identityIndex;
  identityFixture.handIdentity.lifecycleHandId = 'BOUNDED-LIFE-' + identityIndex;
  reducer.reduce(boundedIdentityState, identityFixture);
}
var boundedIdentityInspection = reducer.inspect(boundedIdentityState);
assert.strictEqual(boundedIdentityInspection.coverage.trackedIdentityAliasCount, 10);
assert.strictEqual(boundedIdentityInspection.coverage.identityAliasEvictions, 14, 'two aliases per hand are evicted FIFO at the exact configured maximum');

var outsideMembershipAward = JSON.parse(JSON.stringify(fixtures.S10));
outsideMembershipAward.players.find(function (player) { return player.playerId === 'C'; }).reachedShowdown = false;
outsideMembershipAward.showdown.participants = ['A', 'B'];
outsideMembershipAward.settlement.awards = [{ awardId: 'outside', playerId: 'C', amount: 300, potId: null, boardIndex: null }];
outsideMembershipAward.settlement.totalsByPlayer = { C: 300 };
var rejectedOutsideAward = reducer.deriveContribution(outsideMembershipAward);
assert.strictEqual(rejectedOutsideAward.players.A.showdownOutcome, 'unsupported', 'an award outside supported showdown membership cannot create a monetary outcome');
assert.ok(codes(rejectedOutsideAward).includes(reducer.AMBIGUITY_CODES.SETTLEMENT_AWARD_UNSUPPORTED));

function authoritativeRecord(fileName) {
  var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'capture-derived-preflop', fileName), 'utf8'));
  var replay = authoritativeReplay.replayFixture(fixture);
  return replay.finalizedRecords.find(function (record) { return record.handIdentity.handId === fixture.scenario.targetHandId; });
}

var authoritativeA3 = reducer.deriveContribution(authoritativeRecord('a3-open-coldcall-squeeze-showdown-chop.sanitized.json'));
assert.deepStrictEqual(Object.keys(authoritativeA3.players).map(function (id) { return authoritativeA3.players[id].wentToShowdown; }), [1, 1, 1]);
assert.strictEqual(authoritativeA3.players.P1.showdownGrossAward, 330);
assert.strictEqual(authoritativeA3.players.P3.showdownGrossAward, 330);
assert.strictEqual(authoritativeA3.players.P2.showdownGrossAward, 0);
assert.deepStrictEqual([authoritativeA3.players.P1.wonMoneyAtShowdownCandidate, authoritativeA3.players.P2.wonMoneyAtShowdownCandidate, authoritativeA3.players.P3.wonMoneyAtShowdownCandidate], [1, 0, 1]);
assert.ok(Object.keys(authoritativeA3.players).every(function (id) { return authoritativeA3.players[id].showdownOutcome === 'unsupported'; }), 'A3 aggregate awards remain unsupported for rich pot outcome because pot identity is absent');
assert.ok(codes(authoritativeA3).includes(reducer.AMBIGUITY_CODES.POT_ELIGIBILITY_UNSUPPORTED));

var authoritativeA4 = reducer.deriveContribution(authoritativeRecord('a4-short-nonfull-allin-runout-chop.sanitized.json'));
assert.strictEqual(authoritativeA4.hand.automaticRunout, true);
assert.strictEqual(authoritativeA4.players.P1.wentToShowdown, 1);
assert.strictEqual(authoritativeA4.players.P3.wentToShowdown, 1);
assert.strictEqual(authoritativeA4.players.P2.sawFlopForWTSD, 0);
assert.strictEqual(authoritativeA4.players.P1.showdownOutcome, 'unsupported');

var authoritativeA6 = reducer.deriveContribution(authoritativeRecord('a6-full-allin-3bet-call-runout.sanitized.json'));
assert.strictEqual(authoritativeA6.hand.automaticRunout, true);
assert.strictEqual(authoritativeA6.players.P1.wentToShowdown, 1);
assert.strictEqual(authoritativeA6.players.P2.wentToShowdown, 1);
assert.strictEqual(authoritativeA6.players.P2.showdownGrossAward, 440);
assert.deepStrictEqual([authoritativeA6.players.P1.wonMoneyAtShowdownCandidate, authoritativeA6.players.P2.wonMoneyAtShowdownCandidate], [0, 1]);
assert.strictEqual(authoritativeA6.players.P2.showdownOutcome, 'unsupported', 'a clear aggregate award does not silently invent missing pot/board semantics');

var source = fs.readFileSync('./showdownStatsReducer.js', 'utf8');
var manifest = fs.readFileSync('./manifest.json', 'utf8');
var content = fs.readFileSync('./content.js', 'utf8');
var hud = fs.readFileSync('./hud.css', 'utf8');
assert.doesNotMatch(source, /document\.|chrome\.storage|WebSocket|addEventListener|querySelector/, 'the isolated reducer owns no DOM, storage, transport, or listeners');
assert.ok(manifest.includes('showdownStatsReducer.js'), 'the shadow reducer is packaged in the isolated production world');
assert.ok(content.includes("['PokerShowdownStatsReducer', globalThis.PokerShowdownStatsReducer, 'showdownStatsReducer.js']"), 'Stage 1.4 requires the exact showdown reducer global');
assert.ok(content.includes('PokerShowdownStatsReducer.reduce(showdownStatsState, semanticResult.record)'), 'content invokes the reducer only from semantic finalization');
var ui = ['overlayStats.js', 'leaderboardStats.js', 'seatOverlay.js', 'settingsUi.js', 'statTooltip.js', 'popup.js'].map(function (file) { return fs.readFileSync(file, 'utf8'); }).join('\n');
assert.match(ui, /\bWTSD\b/);
assert.match(ui, /W\$SD/);
assert.doesNotMatch(source, /PokerOverlayStats|PokerSeatOverlay|PokerLeaderboardStats/, 'the reducer remains isolated from visible presentation');
assert.ok(content.includes('globalThis.PokerNowRuntimeScope.buildId'), 'content consumes the shared runtime Build ID');

console.log('Isolated showdown reducer S1-S20, authoritative-ledger audit, deduplication, bounds, and production neutrality tests passed.');
