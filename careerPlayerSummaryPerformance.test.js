'use strict';

var assert = require('assert');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var support = require('./testSupport/careerPlayerSummaryHarness.js');
var browserMode = process.argv.includes('--browser');

function record(hand, playerId, options) {
  return fixtures.record('SUMMARY-SCALE', hand, [fixtures.player(playerId, 'Player ' + playerId)], Object.assign({ finalizedAt: 1000 }, options || {}));
}
function measurement(count, operation, sample) {
  var p = sample.probe;
  return {
    players: count, operation: operation,
    historyRetrievals: p.historyRetrievals, playerHistoryRetrievals: p.playerHistoryRetrievals,
    historyRecordsReturned: p.browser ? p.historyRecordsReturned : null,
    memorySelectionScans: p.browser ? null : p.memorySelectionScans,
    aggregateRebuilds: p.aggregateRebuilds, resolutionRecords: p.resolutionRecords,
    serviceCalls: sample.serviceCalls, backendTransactions: p.browser ? p.transactions : null,
    headEnumerations: p.headEnumerations, ms: Math.round(sample.ms * 100) / 100
  };
}
function assertLightweight(sample, count) {
  assert.strictEqual(sample.value.length, count);
  assert.strictEqual(sample.probe.historyRetrievals, 0, 'maintained enumeration never reads immutable histories');
  assert.strictEqual(sample.probe.aggregateRebuilds, 0, 'maintained enumeration never rebuilds aggregates');
  assert.strictEqual(sample.probe.resolutionRecords, 0);
  assert.strictEqual(sample.probe.headEnumerations, 1);
  if (browserMode) assert.strictEqual(sample.probe.transactions, 1, 'one lightweight native snapshot transaction');
}

(async function () {
  var harness = await support.openHarness(browserMode); var measurements = [];
  try {
    for (var count of [100, 500, 1000]) {
      var records = Array.from({ length: count }, (_, i) => record('H' + i, 'P' + i, { finalizedAt: 1000 + i }));
      await harness.seedLegacy(records);
      var backfill = await harness.sampleSummary();
      assert.strictEqual(backfill.value.length, count);
      assert.strictEqual(backfill.probe.historyRetrievals, 1, 'one batched history read for the entire legacy store');
      assert.strictEqual(backfill.probe.playerHistoryRetrievals, 0, 'backfill never performs per-player history queries');
      assert.strictEqual(backfill.probe.aggregateRebuilds, 1);
      assert.strictEqual(backfill.probe.resolutionRecords, count);
      assert.ok(backfill.probe.yields > 0);
      measurements.push(measurement(count, 'legacy backfill + read', backfill));
      // Caches stayed empty throughout backfill: this is a cold-aggregate read.
      assert.strictEqual((await harness.call('careerLedgerInfo')).cacheEntryCount, 0);
      var maintained = await harness.sampleSummary(); assertLightweight(maintained, count);
      assert.deepStrictEqual(maintained.value, backfill.value);
      measurements.push(measurement(count, 'maintained read (cold aggregates)', maintained));
      var warm = await harness.sampleSummary(); assertLightweight(warm, count);
      measurements.push(measurement(count, 'repeated maintained read', warm));

      var newRecord = record('UPDATE', 'P0', { finalizedAt: 5000 });
      var update = await harness.sampleSummary('append', [newRecord]);
      assert.strictEqual(update.value.accepted, true);
      assert.strictEqual(update.probe.playerHistoryRetrievals, 1);
      assert.strictEqual(update.probe.historyRetrievals, 2, 'normal append has only its existing hand check and affected-player lookup');
      if (browserMode) assert.deepStrictEqual(update.probe.headWrites, ['P0']);
      measurements.push(measurement(count, 'append one player', update));
      var updatedRead = await harness.sampleSummary(); assertLightweight(updatedRead, count);
      assert.strictEqual(updatedRead.value.find(row => row.playerId === 'P0').hands, 2);
      assert.deepStrictEqual(updatedRead.value.filter(row => row.playerId !== 'P0'), maintained.value.filter(row => row.playerId !== 'P0'));
      measurements.push(measurement(count, 'read after append', updatedRead));

      var successor = record('H0', 'P0', { finalizedAt: 6000, supersedesFingerprint: records[0].fingerprint, semanticVersions: { preflop: 3 } });
      var supersession = await harness.sampleSummary('append', [successor]);
      assert.strictEqual(supersession.value.supersession, true);
      assert.strictEqual(supersession.probe.playerHistoryRetrievals, 1);
      assert.strictEqual(supersession.probe.historyRetrievals, 2, 'normal supersession does not add per-hand context lookups');
      measurements.push(measurement(count, 'supersede one player', supersession));
      var supersededRead = await harness.sampleSummary(); assertLightweight(supersededRead, count);
      assert.strictEqual(supersededRead.value.find(row => row.playerId === 'P0').hands, 2);
      assert.strictEqual(supersededRead.value.find(row => row.playerId === 'P0').lastSeenAt, 6000);
      measurements.push(measurement(count, 'read after supersession', supersededRead));

      var fork = record('H0', 'P0', { finalizedAt: 7000, supersedesFingerprint: records[0].fingerprint, semanticVersions: { flopCBet: 2 } });
      var conflict = await harness.sampleSummary('append', [fork]);
      assert.strictEqual(conflict.value.conflict, true);
      assert.strictEqual(conflict.probe.playerHistoryRetrievals, 0);
      measurements.push(measurement(count, 'reject conflicting successor', conflict));
      await harness.seedLegacy(records.concat([successor, fork]));
      var quarantine = await harness.sampleSummary();
      assert.strictEqual(quarantine.value.length, count - 1, 'only P0 loses its active aggregate in the ambiguous fixture');
      assert.strictEqual(quarantine.probe.historyRetrievals, 1);
      assert.strictEqual(quarantine.probe.aggregateRebuilds, 1);
      measurements.push(measurement(count, 'legacy quarantine backfill + read', quarantine));
      var quarantineRead = await harness.sampleSummary(); assertLightweight(quarantineRead, count - 1);
      measurements.push(measurement(count, 'read after quarantine backfill', quarantineRead));

      var restore = await harness.sampleSummary('replaceCareerRecords', [records, { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1 }]);
      assert.strictEqual(restore.value.replaced, true);
      measurements.push(measurement(count, 'restore + rebuild/verify', restore));
      var restoredRead = await harness.sampleSummary(); assertLightweight(restoredRead, count);
      assert.deepStrictEqual(restoredRead.value.map(row => Object.assign({}, row, { revision: 0 })), backfill.value.map(row => Object.assign({}, row, { revision: 0 })), 'restore revisions follow the existing canonical replacement sequence');
      measurements.push(measurement(count, 'read after restore', restoredRead));
    }
    console.log(JSON.stringify({ environment: harness.environment, measurements: measurements }, null, 2));
    console.log('Career summary 100/500/1000-player scaling passed; timings are informational synthetic measurements.');
  } finally { await harness.close(); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
