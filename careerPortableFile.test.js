'use strict';

var assert = require('assert');
var Backup = require('./careerBackup.js');
var Indexed = require('./careerIndexedStore.js');
var Portable = require('./careerPortableFile.js');
var Policy = require('./careerBackupPolicy.js');
var Fixtures = require('./testSupport/careerBackupFixtures.js');

function namedBlob(name, parts, type) {
  var blob = new Blob(parts, { type: type || '' });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

(async function () {
  var records = Fixtures.complexRecords();
  var source = {
    careerStorageSchemaVersion: 2, recordSchemaVersion: 3, aggregateSchemaVersion: 2,
    metadata: { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'portable-test', firstAcceptedHandKey: records[0].handKey, firstAcceptedAt: 1001, latestAcceptedAt: 1008 },
    records: records
  };
  var backup = await Backup.createBackup(source, require('crypto').webcrypto);
  var options = { maximumFileBytes: Policy.MAX_COMPRESSED_FILE_BYTES, maximumJsonBytes: Policy.MAX_BACKUP_BYTES };
  var compressed = await Portable.compressBackup(backup, options);
  assert.strictEqual(Portable.isGzip(compressed.bytes), true);
  assert.strictEqual(compressed.mediaType, 'application/gzip');
  assert.ok(compressed.compressedBytes < compressed.decompressedBytes / 2, 'representative Backup v1 JSON compresses materially');

  var gzipRead = await Portable.readBackupFile(namedBlob('spoofed.json', [compressed.bytes], 'application/json'), options);
  assert.strictEqual(gzipRead.format, 'gzip', 'gzip magic wins over a spoofed JSON extension and media type');
  assert.strictEqual(Backup.canonicalStringify(gzipRead.backup), Backup.canonicalStringify(backup));
  assert.strictEqual((await Backup.validateBackup(gzipRead.backup)).summary.payloadDigest, backup.integrity.payloadDigest);
  var validatedA = await Backup.validateBackup(gzipRead.backup);
  var empty = Indexed.createMemoryService({}, { initializedAt: 1, migratedAt: 1, buildId: 'portable-empty' });
  var emptyBackup = await Backup.createBackup(await empty.exportCareer());
  var importIntoEmpty = Backup.mergeValidatedBackups({ records: emptyBackup.records, careerMetadata: emptyBackup.careerMetadata }, validatedA);
  assert.strictEqual(importIntoEmpty.ok, true);
  assert.strictEqual(importIntoEmpty.summary.newLogicalHandCount, validatedA.summary.activeRecordCount);
  await empty.mergeCareerRecords(importIntoEmpty.records, importIntoEmpty.careerMetadata);
  assert.strictEqual((await Backup.createBackup(await empty.exportCareer())).integrity.payloadDigest, backup.integrity.payloadDigest, 'compressed A imports exactly into an empty Career');

  var bRecord = Fixtures.record('PORTABLE-B', 'B-ONLY', [Fixtures.player('stable-b', 'B')], { finalizedAt: 2000 });
  var careerB = Indexed.createMemoryService({}, { initializedAt: 1, migratedAt: 1, buildId: 'portable-b' });
  await careerB.append(bRecord);
  var bBackup = await Backup.createBackup(await careerB.exportCareer());
  var mergeAIntoB = Backup.mergeValidatedBackups({ records: bBackup.records, careerMetadata: bBackup.careerMetadata }, validatedA);
  assert.strictEqual(mergeAIntoB.ok, true);
  await careerB.mergeCareerRecords(mergeAIntoB.records, mergeAIntoB.careerMetadata);
  var mergedBackup = await Backup.createBackup(await careerB.exportCareer());
  assert.strictEqual(mergedBackup.integrity.activeRecordCount, validatedA.summary.activeRecordCount + 1, 'compressed A merges canonically into Career B');
  var reimportA = Backup.mergeValidatedBackups({ records: mergedBackup.records, careerMetadata: mergedBackup.careerMetadata }, validatedA);
  assert.strictEqual(reimportA.summary.newLogicalHandCount, 0, 'reimporting compressed A is idempotent');
  var restoredA = Indexed.createMemoryService({}, { initializedAt: 2, migratedAt: 2, buildId: 'portable-restore' });
  await restoredA.replaceCareerRecords(validatedA.records, validatedA.careerMetadata);
  assert.strictEqual((await Backup.createBackup(await restoredA.exportCareer())).integrity.payloadDigest, backup.integrity.payloadDigest, 'compressed A restores exactly');

  var legacyText = JSON.stringify(backup, null, 2) + '\n';
  var jsonRead = await Portable.readBackupFile(namedBlob('spoofed.json.gz', [legacyText], 'application/gzip'), options);
  assert.strictEqual(jsonRead.format, 'json', 'plain JSON remains supported regardless of extension');
  assert.strictEqual((await Backup.validateBackup(jsonRead.backup)).summary.payloadDigest, backup.integrity.payloadDigest);

  await assert.rejects(Portable.readBackupFile(namedBlob('invalid.gz', [new Uint8Array([0x1f, 0x8b, 0, 1, 2, 3])]), options), function (error) { return error.code === 'CAREER_PORTABLE_GZIP_INVALID'; });
  await assert.rejects(Portable.readBackupFile(namedBlob('truncated.gz', [compressed.bytes.slice(0, compressed.bytes.length - 8)]), options), function (error) { return error.code === 'CAREER_PORTABLE_GZIP_INVALID'; });
  var invalidJsonGzip = await Portable.compressBackup({ not: 'Backup v1' }, options);
  var invalidJson = await Portable.readBackupFile(namedBlob('valid-gzip-invalid-backup.json.gz', [invalidJsonGzip.bytes]), options);
  await assert.rejects(Backup.validateBackup(invalidJson.backup), /backup|fields|format/i);
  var malformedJsonGzipBytes = await (async function () {
    var stream = namedBlob('malformed-source', ['{not-json']).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  })();
  await assert.rejects(Portable.readBackupFile(namedBlob('malformed.json.gz', [malformedJsonGzipBytes]), options), function (error) { return error.code === 'CAREER_PORTABLE_JSON_INVALID'; });

  var corrupt = JSON.parse(JSON.stringify(backup));
  corrupt.records[0].players[0].displayName += '!';
  var corruptGzip = await Portable.compressBackup(corrupt, options);
  var corruptRead = await Portable.readBackupFile(namedBlob('integrity.json.gz', [corruptGzip.bytes]), options);
  await assert.rejects(Backup.validateBackup(corruptRead.backup), /fingerprint|digest/i, 'integrity validation still runs after decompression');

  await assert.rejects(Portable.readBackupFile(namedBlob('too-large.json.gz', [compressed.bytes]), { maximumFileBytes: compressed.bytes.length - 1, maximumJsonBytes: Policy.MAX_BACKUP_BYTES }), function (error) { return error.code === 'CAREER_BACKUP_FILE_SIZE_LIMIT'; });
  await assert.rejects(Portable.readBackupFile(namedBlob('expands-too-large.json.gz', [compressed.bytes]), { maximumFileBytes: Policy.MAX_COMPRESSED_FILE_BYTES, maximumJsonBytes: compressed.decompressedBytes - 1 }), function (error) { return error.code === 'CAREER_BACKUP_DECOMPRESSED_SIZE_LIMIT'; });
  await assert.rejects(Portable.compressBackup(backup, { maximumFileBytes: 1, maximumJsonBytes: Policy.MAX_BACKUP_BYTES }), function (error) { return error.code === 'CAREER_BACKUP_FILE_SIZE_LIMIT' && /compressed file size/.test(error.message); });

  console.log('Career portable gzip magic detection, legacy JSON, empty/B merge, idempotence, restore, corruption, truncation, integrity, and size-limit tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
