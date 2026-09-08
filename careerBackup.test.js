'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var indexed = require('./careerIndexedStore.js');
var backupApi = require('./careerBackup.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

(async function () {
  var records = fixtures.complexRecords();
  var original = indexed.createMemoryService({}, { initializedAt: 700, migratedAt: 701, buildId: 'phase3a-original' });
  for (var index = 0; index < records.length; index += 1) assert.strictEqual((await original.append(records[index])).accepted, true, 'complex fixture appends in physical chain order');
  var rawExport = await original.exportCareer();
  var backup = await backupApi.createBackup(rawExport);
  var repeated = await backupApi.createBackup(rawExport);
  assert.strictEqual(backupApi.canonicalStringify(backup), backupApi.canonicalStringify(repeated), 'unchanged career exports produce byte-deterministic canonical backups');
  assert.strictEqual(backup.backupFormat, backupApi.FORMAT);
  assert.strictEqual(backup.backupFormatVersion, 1);
  assert.strictEqual(backup.integrity.algorithm, 'SHA-256');
  assert.strictEqual(backup.integrity.physicalRecordCount, records.length);
  assert.strictEqual(backup.integrity.activeRecordCount, records.length - 2, 'A→B→C contributes one active logical hand');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(backup, 'aggregateCache'), false, 'disposable caches are absent from the authoritative backup');
  assert.strictEqual(JSON.stringify(backup).includes('derived'), false, 'derived percentages are not exported as authoritative history');

  var validated = await backupApi.validateBackup(JSON.stringify(backup));
  assert.deepStrictEqual(validated.aggregate, aggregator.rebuild(records).aggregate);
  assert.strictEqual(validated.summary.careerTrackingStartedAt, 700);
  var restored = indexed.createMemoryService({}, { initializedAt: 900, migratedAt: 901, buildId: 'clean-target' });
  await restored.replaceCareerRecords(validated.records, validated.careerMetadata, { backupFormatVersion: validated.summary.backupFormatVersion, payloadDigest: validated.summary.payloadDigest, restoredAt: 1000 });
  assert.deepStrictEqual(await restored.rebuildCareerStats(), await original.rebuildCareerStats(), 'clean replace restore reproduces every exact numerator and denominator');
  var restoredInfo = await restored.careerLedgerInfo();
  assert.strictEqual(restoredInfo.careerTrackingStartedAt, 700, 'replacement uses the backup career boundary rather than the target initialization time');
  assert.strictEqual(restoredInfo.firstAcceptedHandKey, (await original.careerLedgerInfo()).firstAcceptedHandKey);
  assert.strictEqual(restoredInfo.physicalRecordCount, records.length);
  assert.strictEqual(restoredInfo.activeRecordCount, records.length - 2);
  assert.strictEqual((await restored.careerStats('stable-alice')).latestDisplayName, 'Alicia', 'same stable ID retains one career across display-name changes');
  assert.notDeepStrictEqual(await restored.careerStats('stable-name-duplicate-1'), await restored.careerStats('stable-name-duplicate-2'), 'duplicate display names with different stable IDs remain distinct careers');
  var roundTripBackup = await backupApi.createBackup(await restored.exportCareer());
  assert.strictEqual(backupApi.canonicalStringify(roundTripBackup), backupApi.canonicalStringify(backup), 'export→restore→export is canonical and cache-independent');
  var beforeRejectedReplacement = JSON.stringify(await restored.exportCareer());
  var invalidReplacementRecords = validated.records.map(function (record) { return JSON.parse(JSON.stringify(record)); }); invalidReplacementRecords[0].schemaVersion = 999;
  await assert.rejects(function () { return restored.replaceCareerRecords(invalidReplacementRecords, validated.careerMetadata); }, /replacement records failed/);
  assert.strictEqual(JSON.stringify(await restored.exportCareer()), beforeRejectedReplacement, 'store-level replacement planning rejects the complete candidate before clearing any live state');
  console.log('Career backup canonical export, SHA-256 integrity, complex A→B→C round trip, boundary, names, and cache independence passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
