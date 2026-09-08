'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var store = require('./careerContributionStore.js');
var indexedStore = require('./careerIndexedStore.js');

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
  var handId = 'capacity-hand-' + String(index).padStart(8, '0');
  var value = {
    schemaVersion: 1,
    recordType: 'certified-career-hand',
    handKey: 'pokernow|pokernow.com|capacity-game|' + handId,
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'capacity-game' },
    authoritativeHandId: handId,
    lifecycleHandIds: ['capacity-game:socket:' + index.toString(36)],
    finalizedAt: 1800000000000 + index,
    semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 },
    players: [player('P1', 0), player('P2', 1), player('P3', 2)],
    supersedesFingerprint: null
  };
  value.fingerprint = aggregator.fingerprint(value);
  return value;
}
function itemBytes(value) {
  var key = store.storageRecordKey(value.handKey, value.fingerprint);
  return Buffer.byteLength(key, 'utf8') + Buffer.byteLength(JSON.stringify(value), 'utf8');
}

var sample = Array.from({ length: 1000 }, function (_, index) { return record(index); });
assert.ok(sample.every(function (value) { return aggregator.validateRecord(value) === null; }));
var bytes1000 = sample.reduce(function (sum, value) { return sum + itemBytes(value); }, 0);
var averageBytes = Math.round(bytes1000 / sample.length);
var indexedBytes1000 = sample.reduce(function (sum, value, index) { return sum + Buffer.byteLength(JSON.stringify(indexedStore.recordWrapper(value, index + 1)), 'utf8'); }, 0);
var indexedAverageBytes = Math.round(indexedBytes1000 / sample.length);
var measurement = {
  representativePlayersPerHand: 3,
  averageBytesPerHandRecord: averageBytes,
  averageIndexedEnvelopeBytesPerHand: indexedAverageBytes,
  indexedEnvelopeSavingsPercent: Math.round((1 - indexedAverageBytes / averageBytes) * 1000) / 10,
  bytesAt1000Hands: bytes1000,
  estimatedBytesAt10000Hands: averageBytes * 10000,
  estimatedBytesAt100000Hands: averageBytes * 100000,
  estimatedMiBAt1000Hands: Math.round((bytes1000 / 1048576) * 100) / 100,
  estimatedMiBAt10000Hands: Math.round((averageBytes * 10000 / 1048576) * 100) / 100,
  estimatedMiBAt100000Hands: Math.round((averageBytes * 100000 / 1048576) * 100) / 100
};
assert.ok(measurement.bytesAt1000Hands < 10 * 1024 * 1024, '1,000 representative three-player hands fit below the ordinary chrome.storage.local quota');
assert.ok(measurement.estimatedBytesAt100000Hands > 10 * 1024 * 1024, 'long-lived career history demonstrably requires unlimitedStorage');
assert.strictEqual(require('./manifest.json').permissions.includes('unlimitedStorage'), true, 'capacity foundation requests Chrome local-storage quota exemption');
console.log('Career storage capacity measurement passed: ' + JSON.stringify(measurement));
