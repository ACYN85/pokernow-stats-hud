'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var indexed = require('./careerIndexedStore.js');

var count = Math.max(1, Number(process.argv[2] || 100000));
function elapsed(start) { return Math.round(Number(process.hrtime.bigint() - start) / 100000) / 10; }
function player(id, index) {
  return { playerId: id, displayName: 'Player ' + id, counters: Object.assign(aggregator.emptyCounters(), { hands: 1, vpipMade: index % 2, vpipOpportunities: 1, pfrMade: index % 3 === 0 ? 1 : 0, pfrOpportunities: 1 }), decisions: {} };
}
function record(index) {
  var hand = 'scale-' + String(index).padStart(8, '0');
  var value = { schemaVersion: 1, recordType: 'certified-career-hand', handKey: 'pokernow|pokernow.com|scale|' + hand, namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'scale' }, authoritativeHandId: hand, lifecycleHandIds: [], finalizedAt: 1800000000000 + index, semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 }, players: [player('P' + (index % 100), index)], supersedesFingerprint: null };
  value.fingerprint = aggregator.fingerprint(value); return value;
}

var generateStarted = process.hrtime.bigint();
var records = new Array(count); var fingerprints = new Set(); var playerIndex = new Map();
for (var index = 0; index < count; index += 1) {
  var value = record(index); records[index] = value;
  assert.strictEqual(fingerprints.has(value.fingerprint), false, 'physical fingerprint collision at ' + index);
  fingerprints.add(value.fingerprint);
  var id = value.players[0].playerId; if (!playerIndex.has(id)) playerIndex.set(id, []); playerIndex.get(id).push(value);
}
var generationMs = elapsed(generateStarted);
var rebuildStarted = process.hrtime.bigint();
var rebuilt = aggregator.rebuild(records);
var rebuildMs = elapsed(rebuildStarted);
assert.strictEqual(rebuilt.aggregate.ledgerRecordCount, count);
assert.strictEqual(rebuilt.rejectedRecords.length, 0);
var lookupStarted = process.hrtime.bigint();
var onePlayer = aggregator.playerStats(aggregator.createState(playerIndex.get('P42')), 'P42');
var indexedPlayerLookupMs = elapsed(lookupStarted);
assert.strictEqual(onePlayer.counters.hands, Math.floor((count + 57) / 100));
var duplicateState = aggregator.createState([records[0]]);
assert.strictEqual(aggregator.append(duplicateState, records[0]).duplicate, true);
var old = records[1]; var corrected = JSON.parse(JSON.stringify(old)); corrected.players[0].counters.hands = 2; corrected.players[0].counters.vpipOpportunities = 2; corrected.semanticVersions.preflop = 3; corrected.supersedesFingerprint = old.fingerprint; corrected.fingerprint = aggregator.fingerprint(corrected);
var correction = aggregator.rebuild([old, corrected]);
assert.strictEqual(correction.aggregate.ledgerRecordCount, 1); assert.strictEqual(correction.aggregate.players[old.players[0].playerId].counters.hands, 2);
var wrappersBytes = records.slice(0, Math.min(count, 1000)).reduce(function (sum, value, position) { return sum + Buffer.byteLength(JSON.stringify(indexed.recordWrapper(value, position + 1))); }, 0);
var memory = process.memoryUsage();
console.log(JSON.stringify({ environment: 'Node dedicated slow benchmark; not browser precision', handCount: count, stablePlayerCount: playerIndex.size, uniqueHandKeys: count, uniqueFingerprints: fingerprints.size, generationAndIndexMs: generationMs, deterministicFullRebuildMs: rebuildMs, indexedOnePlayerRecordCount: playerIndex.get('P42').length, indexedOnePlayerRebuildMs: indexedPlayerLookupMs, averageIndexedEnvelopeBytes: Math.round(wrappersBytes / Math.min(count, 1000)), heapUsedMiB: Math.round(memory.heapUsed / 1048576 * 100) / 100, rssMiB: Math.round(memory.rss / 1048576 * 100) / 100, duplicateIdempotent: true, supersessionActiveTipVerified: true }));
