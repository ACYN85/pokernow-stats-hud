'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var backupApi = require('./careerBackup.js');
var indexed = require('./careerIndexedStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function exportShape(records, label) {
  records = records.slice();
  return {
    careerStorageSchemaVersion: indexed.STORAGE_SCHEMA_VERSION,
    recordSchemaVersion: aggregator.RECORD_SCHEMA_VERSION,
    aggregateSchemaVersion: aggregator.AGGREGATE_SCHEMA_VERSION,
    metadata: {
      careerTrackingStartedAt: 1,
      careerSchemaInitializedAt: 2,
      initializedByBuildId: label,
      firstAcceptedHandKey: records.length ? records[0].handKey : null,
      firstAcceptedAt: records.length ? Math.min.apply(Math, records.map(function (record) { return record.finalizedAt; })) : null,
      latestAcceptedAt: records.length ? Math.max.apply(Math, records.map(function (record) { return record.finalizedAt; })) : null
    },
    records: records
  };
}

async function validated(records, label) {
  return backupApi.validateBackup(await backupApi.createBackup(exportShape(records, label)));
}

function syntheticRecords(count, prefix) {
  return Array.from({ length: count }, function (_, index) {
    return fixtures.record('IMPORT-PERF', prefix + '-' + String(index).padStart(5, '0'), [
      fixtures.player('perf-a', 'Perf A', { vpipMade: index % 2, pfrMade: index % 3 === 0 ? 1 : 0 }),
      fixtures.player('perf-b', 'Perf B', { vpipMade: index % 4 === 0 ? 1 : 0 })
    ], { finalizedAt: 1000 + index });
  });
}

(async function () {
  var complex = fixtures.complexRecords();
  var localRecords = complex.slice(0, 4);
  var importedRecords = complex.slice(2);
  var local = await validated(localRecords, 'local');
  var imported = await validated(importedRecords, 'imported');
  var plan = backupApi.mergeValidatedBackups(local, imported);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.summary, {
    importedLogicalHandCount: new Set(importedRecords.map(function (record) { return record.handKey; })).size,
    importedPhysicalRecordCount: importedRecords.length,
    alreadyPresentLogicalHandCount: 2,
    newLogicalHandCount: new Set(importedRecords.slice(2).map(function (record) { return record.handKey; })).size,
    exactDuplicatePhysicalRecordCount: 2,
    newPhysicalRecordCount: importedRecords.length - 2,
    conflictedLogicalHandCount: 0,
    affectedPlayerCount: 3,
    affectedPlayerIds: ['stable-alice', 'stable-bob', 'stable-name-duplicate-2'],
    mergedLogicalHandCount: new Set(complex.map(function (record) { return record.handKey; })).size,
    mergedPhysicalRecordCount: complex.length,
    sessionAffected: false
  });
  assert.deepStrictEqual(plan.aggregate, aggregator.rebuild(complex).aggregate, 'overlap resolves to the canonical full physical graph');

  var target = indexed.createMemoryService({}, { initializedAt: 1, migratedAt: 2, buildId: 'target' });
  for (var i = 0; i < localRecords.length; i += 1) assert.strictEqual((await target.append(localRecords[i])).accepted, true);
  await target.mergeCareerRecords(plan.records, plan.careerMetadata, { backupFormatVersion: 1, payloadDigest: imported.summary.payloadDigest });
  assert.deepStrictEqual(await target.rebuildCareerStats(), aggregator.rebuild(complex).aggregate, 'all ten exact stat aggregates follow the merged resolver result');
  assert.strictEqual((await target.careerStats('stable-alice')).counters.hands, aggregator.rebuild(complex).aggregate.players['stable-alice'].counters.hands);
  assert.notDeepStrictEqual(await target.careerStats('stable-name-duplicate-1'), await target.careerStats('stable-name-duplicate-2'), 'same display name never merges stable identities');
  assert.ok((await target.careerPlayerSummaries()).some(function (summary) { return summary.playerId === 'stable-alice' && summary.hands > 0; }), 'tracked-player summaries rebuild with the merged history');
  assert.ok((await target.careerDashboardStats('stable-alice', {})).profileStats, 'profile projection rebuilds from accepted merged records');
  assert.ok((await target.careerTrendStats('stable-alice')).windows, 'Career trends rebuild against the merged player revision');

  var afterFirst = await validated((await target.exportCareer()).records, 'round-trip');
  var repeated = backupApi.mergeValidatedBackups(afterFirst, imported);
  assert.strictEqual(repeated.ok, true);
  assert.strictEqual(repeated.summary.newLogicalHandCount, 0);
  assert.strictEqual(repeated.summary.exactDuplicatePhysicalRecordCount, importedRecords.length, 'repeated import is physically idempotent');
  assert.strictEqual(repeated.records.length, complex.length);

  var empty = await validated([], 'empty');
  var intoEmpty = backupApi.mergeValidatedBackups(empty, imported);
  assert.strictEqual(intoEmpty.ok, true);
  assert.deepStrictEqual(intoEmpty.records, imported.records, 'import into an empty Career reproduces the portable authoritative records');
  assert.deepStrictEqual(intoEmpty.careerMetadata, imported.careerMetadata, 'empty-target import preserves the source Career boundary');

  var disjointLocal = await validated(syntheticRecords(600, 'LOCAL'), 'disjoint-local');
  var disjointImported = await validated(syntheticRecords(1000, 'IMPORTED'), 'disjoint-imported');
  var disjointPlan = backupApi.mergeValidatedBackups(disjointLocal, disjointImported);
  assert.strictEqual(disjointPlan.ok, true);
  assert.strictEqual(disjointPlan.summary.mergedLogicalHandCount, 1600, '1,000 disjoint imported hands preserve 600 local hands');
  assert.strictEqual(disjointPlan.summary.newLogicalHandCount, 1000);

  var conflictLocal = fixtures.record('CONFLICT', 'H1', [fixtures.player('conflict-a', 'Alex', { vpipMade: 1 })], { finalizedAt: 2000 });
  var conflictImported = fixtures.record('CONFLICT', 'H1', [fixtures.player('conflict-b', 'Alex', { pfrMade: 1 })], { finalizedAt: 2000 });
  var conflictPlan = backupApi.mergeValidatedBackups(await validated([conflictLocal], 'conflict-local'), await validated([conflictImported], 'conflict-imported'));
  assert.strictEqual(conflictPlan.ok, false);
  assert.strictEqual(conflictPlan.summary.conflictedLogicalHandCount, 1, 'competing roots quarantine one logical context in the shared resolver');
  var conflictTarget = indexed.createMemoryService({}, { initializedAt: 1 });
  await conflictTarget.append(conflictLocal);
  var beforeConflict = JSON.stringify(await conflictTarget.exportCareer());
  await assert.rejects(function () { return conflictTarget.mergeCareerRecords([conflictLocal, conflictImported], conflictLocal.metadata || {}, {}); }, /deterministic validation/);
  assert.strictEqual(JSON.stringify(await conflictTarget.exportCareer()), beforeConflict, 'an ambiguous merge cannot mutate existing Career');

  var malformed = await backupApi.createBackup(exportShape([conflictImported], 'malformed'));
  malformed.records[0].namespace.gameId = 'tampered';
  await assert.rejects(function () { return backupApi.validateBackup(malformed); }, /hand key|digest|fingerprint/i, 'malformed input fails before any store mutation');

  var timings = [];
  for (var size of [100, 1000, 5000]) {
    var records = syntheticRecords(size, 'N' + size);
    var validateStarted = Date.now();
    var candidate = await validated(records, 'perf-' + size);
    var perfPlan = backupApi.mergeValidatedBackups(empty, candidate);
    var validationPlanMs = Date.now() - validateStarted;
    var service = indexed.createMemoryService({}, { initializedAt: 1 });
    var mutationStarted = Date.now();
    await service.mergeCareerRecords(perfPlan.records, perfPlan.careerMetadata, { backupFormatVersion: 1, payloadDigest: candidate.summary.payloadDigest });
    var mutationMs = Date.now() - mutationStarted;
    var rebuildStarted = Date.now();
    var rebuilt = await service.rebuildCareerStats();
    var rebuildMs = Date.now() - rebuildStarted;
    assert.strictEqual(rebuilt.ledgerRecordCount, size);
    timings.push({ logicalHands: size, validationAndPlanMs: validationPlanMs, mergeMutationMs: mutationMs, rebuildMs: rebuildMs });
  }
  console.log('Career import merge, idempotence, stable identity, supersession, conflict safety, derived rebuild, and synthetic timings passed: ' + JSON.stringify(timings));
})().catch(function (error) { console.error(error); process.exit(1); });
