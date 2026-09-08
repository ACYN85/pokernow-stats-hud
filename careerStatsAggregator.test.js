'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');

function player(playerId, displayName, counters) {
  return { playerId: playerId, displayName: displayName, counters: Object.assign(aggregator.emptyCounters(), counters || {}), decisions: {} };
}
function record(gameId, handId, players, finalizedAt, versions) {
  var value = {
    schemaVersion: 1,
    recordType: 'certified-career-hand',
    handKey: ['pokernow', 'pokernow.com', gameId, handId].join('|'),
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: gameId },
    authoritativeHandId: handId,
    lifecycleHandIds: ['life-' + handId],
    finalizedAt: finalizedAt,
    semanticVersions: versions || { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 },
    players: players,
    supersedesFingerprint: null
  };
  value.fingerprint = aggregator.fingerprint(value);
  return value;
}

var h1 = record('G1', 'H1', [
  player('A', 'Alice', { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrMade: 1, pfrOpportunities: 1, postflopAggressiveActions: 2, threeBetMade: 1, threeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 }),
  player('B', 'Alex', { hands: 1, vpipOpportunities: 1, pfrOpportunities: 1, postflopCalls: 2, foldToThreeBet: 1, foldToThreeBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, wtsdOpportunities: 1 })
], 100);
var h2 = record('G1', 'H2', [
  player('A', 'Alice2', { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrOpportunities: 1, postflopAggressiveActions: 1, postflopCalls: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdOpportunities: 1 }),
  player('C', 'Alex', { hands: 1 })
], 200);
var state = aggregator.createState();
assert.strictEqual(aggregator.append(state, h1).accepted, true);
assert.strictEqual(aggregator.append(state, h1).duplicate, true, 'exact replay is idempotent');
assert.strictEqual(aggregator.append(state, h2).accepted, true);
var alice = aggregator.playerStats(state, 'A');
assert.strictEqual(alice.latestDisplayName, 'Alice2', 'stable ID retains one career across a name change');
assert.deepStrictEqual(alice.counters, Object.assign(aggregator.emptyCounters(), {
  hands: 2, vpipMade: 2, vpipOpportunities: 2, pfrMade: 1, pfrOpportunities: 2,
  postflopAggressiveActions: 3, postflopCalls: 1, threeBetMade: 1, threeBetOpportunities: 1,
  flopCBetMade: 1, flopCBetOpportunities: 1, wtsdMade: 2, wtsdOpportunities: 2,
  wsdMade: 1, wsdOpportunities: 2
}));
assert.strictEqual(alice.derived.af, 3);
assert.strictEqual(aggregator.playerStats(state, 'B').latestDisplayName, 'Alex');
assert.strictEqual(aggregator.playerStats(state, 'C').latestDisplayName, 'Alex');
assert.notDeepStrictEqual(aggregator.playerStats(state, 'B').counters, aggregator.playerStats(state, 'C').counters, 'duplicate display names never merge stable IDs');

var rebuilt = aggregator.rebuild(aggregator.records(state));
assert.deepStrictEqual(rebuilt.aggregate, aggregator.exactAggregate(state), 'incremental aggregation exactly equals full replay');
var conflict = JSON.parse(JSON.stringify(h1));
conflict.players[0].counters.hands = 2;
conflict.fingerprint = aggregator.fingerprint(Object.assign({}, conflict, { fingerprint: undefined }));
assert.strictEqual(aggregator.append(state, conflict).conflict, true, 'same durable hand key cannot be overwritten');
var aliasReplay = JSON.parse(JSON.stringify(h2));
aliasReplay.lifecycleHandIds = ['different-reload-alias'];
aliasReplay.finalizedAt = 999;
aliasReplay.players.forEach(function (entry) { entry.displayName = 'renamed presentation'; entry.sourceContributionIds = { preflop: 'volatile', flopCBet: 'volatile', showdown: 'volatile' }; });
aliasReplay.fingerprint = aggregator.fingerprint(aliasReplay);
assert.strictEqual(aliasReplay.fingerprint, h2.fingerprint, 'volatile lifecycle and presentation metadata do not alter the semantic fingerprint');
assert.strictEqual(aggregator.append(state, aliasReplay).duplicate, true, 'same hI under a new lifecycle alias is a duplicate, not a conflict');

var walk = record('G1', 'WALK', [player('A', 'Alice2', { hands: 1 })], 300);
assert.strictEqual(aggregator.append(state, walk).accepted, true);
assert.strictEqual(aggregator.playerStats(state, 'A').counters.hands, 3);
assert.strictEqual(aggregator.playerStats(state, 'A').counters.vpipOpportunities, 2, 'BB walk adds a hand without VPIP opportunity');
assert.strictEqual(aggregator.playerStats(state, 'A').counters.pfrOpportunities, 2, 'BB walk adds a hand without PFR opportunity');

var infinity = aggregator.createState([record('G2', 'INF', [player('I', 'Infinity', { hands: 1, postflopAggressiveActions: 2 })], 1)]);
assert.strictEqual(aggregator.playerStats(infinity, 'I').derived.af, Infinity);
var zeroAf = aggregator.createState([record('G2', 'ZERO', [player('Z', 'Zero', { hands: 1, postflopCalls: 2 })], 1)]);
assert.strictEqual(aggregator.playerStats(zeroAf, 'Z').derived.af, 0);

var unknown = record('G3', 'UNKNOWN', [player('U', 'Unknown', { hands: 1 })], 1, { core: 1, preflop: 999, flopCBet: 1, showdown: 1, sourceLedger: 1 });
unknown.fingerprint = aggregator.fingerprint(Object.assign({}, unknown, { fingerprint: undefined }));
var conservative = aggregator.rebuild([unknown]);
assert.strictEqual(conservative.aggregate.ledgerRecordCount, 0);
assert.ok(/unsupported semantic version/.test(conservative.rejectedRecords[0].reason));

assert.strictEqual(JSON.stringify(aggregator.exactAggregate(state)).includes('percentage'), false, 'authoritative aggregate stores no percentages');
console.log('Career deterministic aggregator, identity, BB walk, AF, replay, conflict, and version tests passed.');
