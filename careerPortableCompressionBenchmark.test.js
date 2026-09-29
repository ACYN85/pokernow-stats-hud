'use strict';

var assert = require('assert');
var Aggregator = require('./careerStatsAggregator.js');
var Backup = require('./careerBackup.js');
var Portable = require('./careerPortableFile.js');

function player(id, seat, hand) {
  var decisions = {};
  ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (key, index) { decisions[key] = { opportunity: (hand + seat + index) % 2, result: (hand + index) % 3 ? 0 : 1, unsupportedReason: null }; });
  return {
    playerId: id, displayName: 'Representative Player ' + id,
    sourceContributionIds: { preflop: 'preflop:v2:' + id, flopCBet: 'flop-cbet:v1:' + id, showdown: 'showdown:v1:' + id },
    counters: Object.assign(Aggregator.emptyCounters(), { hands: 1, vpipMade: (hand + seat) % 2, vpipOpportunities: 1, pfrMade: hand % 3 === seat ? 1 : 0, pfrOpportunities: 1, postflopAggressiveActions: seat + 1, postflopCalls: seat, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: seat === 0 ? 1 : 0, wsdOpportunities: 1 }),
    decisions: decisions
  };
}
function record(index) {
  var handId = 'portable-scale-' + String(index).padStart(8, '0');
  var value = {
    schemaVersion: 1, recordType: 'certified-career-hand', handKey: 'pokernow|pokernow.com|portable-scale|' + handId,
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'portable-scale' }, authoritativeHandId: handId,
    lifecycleHandIds: ['portable-scale:socket:' + index.toString(36)], finalizedAt: 1800000000000 + index,
    semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 },
    players: [player('P1', 0, index), player('P2', 1, index), player('P3', 2, index)], supersedesFingerprint: null
  };
  value.fingerprint = Aggregator.fingerprint(value);
  return value;
}
function elapsed(started) { return Math.round((performance.now() - started) * 100) / 100; }

(async function () {
  var measurements = [];
  for (var size of [100, 1000, 5000, 10000]) {
    var records = Array.from({ length: size }, function (_, index) { return record(index); });
    var started = performance.now();
    var backup = await Backup.createBackup({
      careerStorageSchemaVersion: Aggregator.STORAGE_SCHEMA_VERSION, recordSchemaVersion: 1, aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      metadata: { careerTrackingStartedAt: 1800000000000, careerSchemaInitializedAt: 1800000000000, initializedByBuildId: 'portable-scale-benchmark', firstAcceptedHandKey: records[0].handKey, firstAcceptedAt: records[0].finalizedAt, latestAcceptedAt: records[records.length - 1].finalizedAt },
      records: records
    }, require('crypto').webcrypto);
    var backupCreationMs = elapsed(started);
    var prettyBytes = Buffer.byteLength(JSON.stringify(backup, null, 2) + '\n');
    var compactBytes = Buffer.byteLength(Portable.compactBackupText(backup));
    started = performance.now();
    var compressed = await Portable.compressBackup(backup);
    var compressionMs = elapsed(started);
    var blob = new Blob([compressed.bytes]);
    started = performance.now();
    var decoded = await Portable.readBackupFile(blob);
    var decompressionAndParseMs = elapsed(started);
    started = performance.now();
    var validated = await Backup.validateBackup(decoded.backup, require('crypto').webcrypto);
    var validationMs = elapsed(started);
    assert.strictEqual(validated.summary.payloadDigest, backup.integrity.payloadDigest);
    assert.ok(compressed.compressedBytes < compactBytes * 0.2, 'gzip materially reduces the ' + size + '-hand fixture');
    measurements.push({ logicalHands: size, prettyBytes: prettyBytes, compactBytes: compactBytes, compressedBytes: compressed.compressedBytes, prettyToGzipRatio: Math.round(prettyBytes / compressed.compressedBytes * 100) / 100, prettyBytesPerHand: Math.round(prettyBytes / size), compressedBytesPerHand: Math.round(compressed.compressedBytes / size), backupCreationMs: backupCreationMs, compressionMs: compressionMs, decompressionAndParseMs: decompressionAndParseMs, validationMs: validationMs });
  }
  console.log('Career portable compression benchmark passed: ' + JSON.stringify(measurements));
})().catch(function (error) { console.error(error); process.exitCode = 1; });
