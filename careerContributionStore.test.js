'use strict';
var assert = require('assert');
var store = require('./careerContributionStore.js');
var stats = require('./stats.js');
var showdownReducer = require('./showdownStatsReducer.js');
var showdownFixtures = require('./testSupport/showdownStatsFixtures.js');
var preflopReplay = require('./testSupport/captureDerivedPreflopProductionReplay.js');
var preflopFixture = require('./fixtures/capture-derived-preflop/a3-open-coldcall-squeeze-showdown-chop.sanitized.json');
var flopReducer = require('./flopCBetOpportunityReducer.js');
var flopFixtures = require('./testSupport/flopCBetOpportunityFixtures.js');

function event(handId, playerId, player, action, street, extra) {
  return Object.assign({ handId: handId, playerId: playerId, player: player, action: action, street: street, amount: 0, timestamp: 1 }, extra || {});
}
function decision(opportunity, made, reason) { return { opportunity: opportunity, made: made, folded: made, reason: reason || 'fixture' }; }
var events = [
  event('H1', 'A', 'Alice', 'dealt', 'preflop'),
  event('H1', 'B', 'Alex', 'dealt', 'preflop'),
  event('H1', 'A', 'Alice', 'raise', 'preflop', { threeBetMade: 1, threeBetOpportunities: 1, preflopOpportunityContributionId: 'preflop:2:H1:A' }),
  event('H1', 'B', 'Alex', 'call', 'preflop', { foldToThreeBet: 0, foldToThreeBetOpportunities: 1, preflopOpportunityContributionId: 'preflop:2:H1:B' }),
  event('H1', 'A', 'Alice', 'bet', 'flop', { flopCBetMade: 1, flopCBetOpportunities: 1, flopCBetContributionId: 'flop-cbet:1:H1:A' }),
  event('H1', 'B', 'Alex', 'call', 'flop', { foldToFlopCBet: 0, foldToFlopCBetOpportunities: 1, flopCBetContributionId: 'flop-cbet:1:H1:B' }),
  event('H1', 'B', 'Alex', 'call', 'river', { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: 0, showdownStatsContributionId: 'showdown-stats:1:H1:B' }),
  event('H1', 'A', 'Alice', 'check', 'river', { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: 1, showdownStatsContributionId: 'showdown-stats:1:H1:A' })
];
var semantic = {
  schemaVersion: 1, status: 'finalized', handIdentity: { handId: 'H1', lifecycleHandId: 'life-H1' },
  players: [{ playerId: 'A' }, { playerId: 'B' }], provenance: { finalizedAt: 100 }
};
var preflop = { reducerVersion: 2, players: {
  A: { threeBet: decision(true, true), foldToThreeBet: decision(false, false, 'opener_not_facing_three_bet') },
  B: { threeBet: decision(false, false), foldToThreeBet: decision(true, false) }
} };
var flop = { reducerVersion: 1, players: {
  A: { flopCBet: decision(true, true), foldToFlopCBetDecision: decision(false, false, 'cbetter') },
  B: { flopCBet: decision(false, false, 'defender'), foldToFlopCBetDecision: decision(true, false) }
} };
var showdown = { reducerVersion: 1, players: {
  A: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 1, wonMoneyAtShowdownCandidateSupported: true, wonMoneyAtShowdownCandidateReason: 'positive_contested_award' },
  B: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 0, wonMoneyAtShowdownCandidateSupported: true, wonMoneyAtShowdownCandidateReason: 'no_positive_contested_award' }
} };
var record = store.buildCertifiedHandRecord({ namespace: { host: 'pokernow.com', gameId: 'G1' }, authoritativeHandId: 'H1', semanticRecord: semantic, finalizedEvents: events, preflopContribution: preflop, flopCBetContribution: flop, showdownContribution: showdown });
assert.strictEqual(record.handKey, 'pokernow|pokernow.com|G1|H1');
assert.deepStrictEqual(record.lifecycleHandIds, ['life-H1']);
assert.strictEqual(record.players.find(function (p) { return p.playerId === 'A'; }).counters.postflopAggressiveActions, 1);
assert.strictEqual(record.players.find(function (p) { return p.playerId === 'B'; }).counters.postflopCalls, 2);
assert.deepStrictEqual(record.players.find(function (p) { return p.playerId === 'B'; }).decisions.wsd, { opportunity: 1, result: 0, unsupportedReason: null });
assert.strictEqual(record.players.find(function (p) { return p.playerId === 'B'; }).sourceContributionIds.showdown, 'showdown-stats:1:H1:B');

var state = store.createState({}, { initializedAt: 50, buildId: 'career-test' });
assert.strictEqual(state.meta.careerTrackingStartedAt, 50);
assert.strictEqual(store.append(state, record).accepted, true);
assert.strictEqual(store.append(state, record).duplicate, true);
assert.strictEqual(store.playerStats(state, 'A').counters.hands, 1);
assert.deepStrictEqual(store.rebuild(state), store.exactAggregate(state));
var saved = store.append(store.createState({}, { initializedAt: 50 }), record).storageUpdate;
var hydrated = store.createState(saved, { initializedAt: 999 });
assert.strictEqual(store.playerStats(hydrated, 'A').counters.hands, 1, 'immutable record hydrates after reload');
assert.strictEqual(store.append(hydrated, record).duplicate, true, 'replay after hydration cannot double count');
var recordOnly = {}; recordOnly[store.storageRecordKey(record.handKey, record.fingerprint)] = record;
assert.strictEqual(store.playerStats(store.createState(recordOnly), 'A').counters.hands, 1, 'record survives a crash before aggregate-cache persistence and rebuilds deterministically');
var cacheOnly = {}; cacheOnly[store.CACHE_KEY] = saved[store.CACHE_KEY];
assert.strictEqual(store.createState(cacheOnly).aggregateState.aggregate.ledgerRecordCount, 0, 'an aggregate cache without its immutable record cannot invent career history');

var unsupportedEvents = [event('H2', 'A', 'Alice2', 'dealt', 'preflop')];
var unsupportedSemantic = { schemaVersion: 1, status: 'finalized', handIdentity: { handId: 'H2', lifecycleHandId: 'life-H2' }, players: [{ playerId: 'A' }], provenance: { finalizedAt: 200 } };
var unsupported = store.buildCertifiedHandRecord({
  namespace: { host: 'pokernow.com', gameId: 'G1' }, authoritativeHandId: 'H2', semanticRecord: unsupportedSemantic, finalizedEvents: unsupportedEvents,
  preflopContribution: { reducerVersion: 2, players: { A: { threeBet: decision(null, null, 'history_incomplete'), foldToThreeBet: decision(null, null, 'history_incomplete') } } },
  flopCBetContribution: { reducerVersion: 1, players: { A: { flopCBet: decision(null, null, 'history_incomplete'), foldToFlopCBetDecision: decision(null, null, 'history_incomplete') } } },
  showdownContribution: { reducerVersion: 1, players: { A: { sawFlopForWTSD: null, wentToShowdown: null, wonMoneyAtShowdownCandidate: null, wonMoneyAtShowdownCandidateSupported: false, unsupportedReason: 'history_incomplete' } } }
});
assert.strictEqual(unsupported.players[0].decisions.threeBet.opportunity, null);
assert.strictEqual(unsupported.players[0].decisions.threeBet.unsupportedReason, 'history_incomplete');
assert.strictEqual(unsupported.players[0].counters.threeBetOpportunities, 0);
assert.strictEqual(store.append(state, unsupported).accepted, true);
assert.strictEqual(store.playerStats(state, 'A').counters.hands, 2);
assert.strictEqual(store.playerStats(state, 'A').counters.threeBetOpportunities, 1, 'unsupported decision contributes no denominator');

var writerOne = store.createState({}, { initializedAt: 1 });
var writerTwo = store.createState({}, { initializedAt: 1 });
var writerOneUpdate = store.append(writerOne, record).storageUpdate;
var writerTwoUpdate = store.append(writerTwo, unsupported).storageUpdate;
var concurrentStorage = Object.assign({}, writerOneUpdate, writerTwoUpdate);
concurrentStorage[store.storageRecordKey(record.handKey, record.fingerprint)] = record;
var reconciledWriters = store.createState(concurrentStorage);
assert.strictEqual(store.info(reconciledWriters).ledgerRecordCount, 2, 'distinct immutable record keys survive stale concurrent cache/meta writes from separate table tabs');
assert.strictEqual(store.playerStats(reconciledWriters, 'A').counters.hands, 2);
var corruptStorage = {}; var corruptRecord = JSON.parse(JSON.stringify(record)); corruptRecord.schemaVersion = 999; corruptStorage[store.storageRecordKey(record.handKey, record.fingerprint)] = corruptRecord;
var corruptState = store.createState(corruptStorage);
assert.strictEqual(store.info(corruptState).ledgerRecordCount, 0);
assert.strictEqual(store.info(corruptState).rejectedRecordCount, 1, 'unknown durable schema versions fail conservatively without reinterpretation');

var squeezeReplay = preflopReplay.replayFixture(preflopFixture);
var squeezeEvents = stats.applyPreflopContribution(squeezeReplay.finalizationInspection.finalizedEvents, squeezeReplay.contributions[0]).events;
var squeezeRecord = store.buildCertifiedHandRecord({ namespace: { host: 'pokernow.com', gameId: 'SQUEEZE-GAME' }, authoritativeHandId: 'A3-HAND', semanticRecord: squeezeReplay.finalizedRecords[0], finalizedEvents: squeezeEvents, preflopContribution: squeezeReplay.contributions[0] });
var squeezeState = store.createState(); store.append(squeezeState, squeezeRecord);
assert.deepStrictEqual(['P1', 'P2'].map(function (id) { var c = store.playerStats(squeezeState, id).counters; return [c.foldToThreeBet, c.foldToThreeBetOpportunities]; }), [[0, 1], [0, 1]], 'career preserves both opener and cold-caller direct F3B responses from the authoritative fixture');
assert.deepStrictEqual([store.playerStats(squeezeState, 'P3').counters.threeBetMade, store.playerStats(squeezeState, 'P3').counters.threeBetOpportunities], [1, 1]);
var squeezeById = Object.fromEntries(squeezeRecord.players.map(function (player) { return [player.playerId, player]; }));
assert.strictEqual(squeezeById.P3.relational.threeBetTargetPlayerId, 'P1', 'qualifying squeeze preserves its opener target');
assert.strictEqual(squeezeById.P1.relational.foldToThreeBetAggressorPlayerId, 'P3');
assert.strictEqual(squeezeById.P2.relational.foldToThreeBetAggressorPlayerId, 'P3', 'multiway F3B responders preserve the same qualifying three-bettor');

var multiwayFlopContribution = flopReducer.deriveContribution(flopFixtures.C5);
var multiwayFlopEvents = stats.applyFlopCBetContribution(flopFixtures.C5.players.map(function (entry) { return event(flopFixtures.C5.handIdentity.lifecycleHandId, entry.playerId, entry.playerId, 'dealt', 'preflop'); }), multiwayFlopContribution).events;
var multiwayFlopRecord = store.buildCertifiedHandRecord({ namespace: { host: 'pokernow.com', gameId: 'MULTIWAY-FLOP' }, authoritativeHandId: flopFixtures.C5.handIdentity.handId, semanticRecord: flopFixtures.C5, finalizedEvents: multiwayFlopEvents, flopCBetContribution: multiwayFlopContribution });
var multiwayFlopState = store.createState(); store.append(multiwayFlopState, multiwayFlopRecord);
assert.deepStrictEqual([store.playerStats(multiwayFlopState, 'B').counters.foldToFlopCBet, store.playerStats(multiwayFlopState, 'B').counters.foldToFlopCBetOpportunities], [1, 1]);
assert.deepStrictEqual([store.playerStats(multiwayFlopState, 'C').counters.foldToFlopCBet, store.playerStats(multiwayFlopState, 'C').counters.foldToFlopCBetOpportunities], [0, 1], 'career preserves independent multiway FCB fold/call results');
var multiwayById = Object.fromEntries(multiwayFlopRecord.players.map(function (player) { return [player.playerId, player]; }));
assert.deepStrictEqual(multiwayById.A.relational.flopCBetOpponentPlayerIds, ['B', 'C'], 'multiway c-bet context preserves every stable-ID flop opponent');
assert.strictEqual(multiwayById.B.relational.foldToFlopCBetAggressorPlayerId, 'A');
assert.strictEqual(multiwayById.C.relational.foldToFlopCBetAggressorPlayerId, 'A');

assert.throws(function () { store.buildCertifiedHandRecord({ namespace: { host: 'pokernow.com', gameId: 'G1' }, authoritativeHandId: 'G1:socket:synthetic', semanticRecord: semantic, finalizedEvents: events }); }, /authoritative PokerNow hI/);
assert.strictEqual(JSON.stringify(store.exactAggregate(state)).includes('derived'), false, 'aggregate cache contains exact counters only');

function careerFromShowdownFixture(source, gameId) {
  var contribution = showdownReducer.deriveContribution(source);
  var baseEvents = source.players.map(function (entry) { return event(source.handIdentity.lifecycleHandId, entry.playerId, entry.playerId, 'dealt', 'preflop'); });
  var integrated = stats.applyShowdownContribution(baseEvents, contribution).events;
  return store.buildCertifiedHandRecord({
    namespace: { host: 'pokernow.com', gameId: gameId },
    authoritativeHandId: source.handIdentity.handId,
    semanticRecord: source,
    finalizedEvents: integrated,
    showdownContribution: contribution
  });
}
var sidePotRecord = careerFromShowdownFixture(showdownFixtures.S11, 'SIDE-GAME');
var sideState = store.createState();
assert.strictEqual(store.append(sideState, sidePotRecord).accepted, true);
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) {
  var counters = store.playerStats(sideState, id).counters;
  return [counters.wtsdMade, counters.wtsdOpportunities, counters.wsdMade, counters.wsdOpportunities];
}), [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 0, 1]], 'supported main/side-pot winners survive as one hand-level career W$SD result each');
var muckedState = store.createState(); store.append(muckedState, careerFromShowdownFixture(showdownFixtures.S4, 'MUCKED-GAME'));
assert.deepStrictEqual([store.playerStats(muckedState, 'B').counters.wtsdMade, store.playerStats(muckedState, 'B').counters.wtsdOpportunities, store.playerStats(muckedState, 'B').counters.wsdMade, store.playerStats(muckedState, 'B').counters.wsdOpportunities], [1, 1, 0, 1], 'mucked loser persists as WTSD success and W$SD loss');

var chopRecord = careerFromShowdownFixture(showdownFixtures.S13, 'CHOP-GAME');
var chopState = store.createState();
store.append(chopState, chopRecord);
assert.deepStrictEqual(['A', 'B', 'C'].map(function (id) { return store.playerStats(chopState, id).counters.wsdMade; }), [1, 1, 1], 'each positive chopped-pot recipient gets one career W$SD success');

var refundSource = JSON.parse(JSON.stringify(showdownFixtures.S3));
refundSource.handIdentity = { handId: 'REFUND-AUTH', lifecycleHandId: 'REFUND-LIFE', gameNumber: 999 };
refundSource.settlement.awards = [{ awardId: 'pot-to-b', playerId: 'B', amount: 200 }];
refundSource.settlement.totalsByPlayer = { B: 200 };
refundSource.settlement.totalAwardAmount = 200;
refundSource.settlement.refunds = [{ playerId: 'A', amount: 50, kind: 'uncalled_return', explicit: true }];
var refundState = store.createState();
store.append(refundState, careerFromShowdownFixture(refundSource, 'REFUND-GAME'));
assert.deepStrictEqual([store.playerStats(refundState, 'A').counters.wsdMade, store.playerStats(refundState, 'A').counters.wsdOpportunities], [0, 1], 'refund-only money never creates a career W$SD win');
console.log('Career certified contribution bundle, namespace, unsupported, hydration, and immutable replay tests passed.');
