'use strict';

var aggregator = require('./careerStatsAggregator.js');
var store = require('./careerContributionStore.js');

var count = Math.max(1, Number(process.argv[2] || 1000));
var playersPerHand = 3;

function elapsed(start) { return Math.round(Number(process.hrtime.bigint() - start) / 100000) / 10; }
function timed(operation) {
  var started = process.hrtime.bigint();
  var value = operation();
  return { value: value, milliseconds: elapsed(started) };
}
function player(id, index) {
  var decisions = {};
  ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (stat, statIndex) {
    decisions[stat] = { opportunity: (index + statIndex) % 2, result: statIndex % 3 === 0 ? 1 : 0, unsupportedReason: null };
  });
  return {
    playerId: id,
    displayName: 'Representative Player ' + id,
    sourceContributionIds: { preflop: 'preflop:v2:representative:' + id, flopCBet: 'flop-cbet:v1:representative:' + id, showdown: 'showdown:v1:representative:' + id },
    counters: Object.assign(aggregator.emptyCounters(), { hands: 1, vpipMade: index % 2, vpipOpportunities: 1, pfrMade: index === 0 ? 1 : 0, pfrOpportunities: 1, postflopAggressiveActions: index + 1, postflopCalls: index, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: index === 0 ? 1 : 0, wsdOpportunities: 1 }),
    decisions: decisions
  };
}
function record(index) {
  var handId = 'benchmark-hand-' + String(index).padStart(8, '0');
  var value = {
    schemaVersion: 1,
    recordType: 'certified-career-hand',
    handKey: 'pokernow|pokernow.com|benchmark-game|' + handId,
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'benchmark-game' },
    authoritativeHandId: handId,
    lifecycleHandIds: ['benchmark-game:socket:' + index.toString(36)],
    finalizedAt: 1800000000000 + index,
    semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 },
    players: [player('P1', 0), player('P2', 1), player('P3', 2)],
    supersedesFingerprint: null
  };
  value.fingerprint = aggregator.fingerprint(value);
  return value;
}

var generated = timed(function () { return Array.from({ length: count }, function (_, index) { return record(index); }); });
var saved = {};
generated.value.forEach(function (value) { saved[store.storageRecordKey(value.handKey, value.fingerprint)] = value; });
var serialized = timed(function () { return JSON.stringify(saved); });
var parsed = timed(function () { return JSON.parse(serialized.value); });
var hydrated = timed(function () { return store.createState(parsed.value, { initializedAt: 1 }); });
var listed = timed(function () { return aggregator.records(hydrated.value.aggregateState); });
var onePlayer = timed(function () { return store.playerStats(hydrated.value, 'P2'); });
var rebuiltPlayer = timed(function () {
  var playerRecords = listed.value.filter(function (value) { return value.players.some(function (entry) { return entry.playerId === 'P2'; }); });
  return aggregator.playerStats(aggregator.createState(playerRecords), 'P2');
});
var rebuiltAll = timed(function () { return aggregator.rebuild(listed.value); });
var cache = store.initializationUpdate(hydrated.value)[store.CACHE_KEY];
var cacheHydration = timed(function () { return JSON.parse(JSON.stringify(cache)); });
var memory = process.memoryUsage();

console.log(JSON.stringify({
  environment: 'Node automated runtime; not a browser timing',
  handCount: count,
  playersPerHand: playersPerHand,
  objectCountApproximation: count * (1 + playersPerHand),
  serializedBytes: Buffer.byteLength(serialized.value, 'utf8'),
  generationMs: generated.milliseconds,
  storageWriteSerializationMs: serialized.milliseconds,
  storageReadParseMs: parsed.milliseconds,
  hydrationAndRebuildMs: hydrated.milliseconds,
  aggregateCacheHydrationMs: cacheHydration.milliseconds,
  listAllRecordsMs: listed.milliseconds,
  cachedOnePlayerLookupMs: onePlayer.milliseconds,
  rebuildOnePlayerMs: rebuiltPlayer.milliseconds,
  rebuildAllPlayersMs: rebuiltAll.milliseconds,
  heapUsedMiB: Math.round(memory.heapUsed / 1048576 * 100) / 100,
  rssMiB: Math.round(memory.rss / 1048576 * 100) / 100,
  ledgerRecordCount: rebuiltAll.value.aggregate.ledgerRecordCount,
  playerCount: Object.keys(rebuiltAll.value.aggregate.players).length
}));
