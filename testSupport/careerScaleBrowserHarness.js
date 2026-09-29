'use strict';

/* Browser-side half of scripts/benchmark-career-scale-chrome.js. */
(function (root) {
  function round(value) { return Math.round(value * 100) / 100; }
  function mib(value) { return round(Number(value || 0) / (1024 * 1024)); }
  async function sample(label) {
    if (typeof root.gc === 'function') root.gc();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
    return {
      label: label,
      usedJSHeapMiB: performance.memory ? mib(performance.memory.usedJSHeapSize) : null,
      totalJSHeapMiB: performance.memory ? mib(performance.memory.totalJSHeapSize) : null
    };
  }
  async function timed(label, operation, stages) {
    root.careerScaleProgress = { stage: label, state: 'running', startedAt: Date.now() };
    var started = performance.now();
    var value = await operation();
    stages.push(Object.assign({ operation: label, durationMs: round(performance.now() - started) }, await sample(label)));
    root.careerScaleProgress = { stage: label, state: 'complete', completedAt: Date.now() };
    return value;
  }
  function metadata(records) { return root.PokerCareerScaleFixtures.metadata(records); }
  async function deleteDatabase() {
    await new Promise(function (resolve, reject) {
      var request = indexedDB.deleteDatabase(root.PokerCareerIndexedStore.DATABASE_NAME);
      request.onsuccess = resolve;
      request.onerror = function () { reject(request.error); };
      request.onblocked = function () { reject(new Error('Career scale database deletion was blocked')); };
    });
  }
  root.runCareerScaleBrowserBenchmark = async function (options) {
    options = options || {};
    var mode = String(options.mode);
    var count = Number(options.count);
    await deleteDatabase();
    var service = await root.PokerCareerIndexedStore.createIndexedService(indexedDB, {}, { initializedAt: 1800000000000, migratedAt: 1800000000000, buildId: 'career-scale-browser' });
    var localSeedMs = null;
    if (mode !== 'restore') {
      var localRecords = root.PokerCareerScaleFixtures.records(count, 0);
      var seedStarted = performance.now();
      await service.replaceCareerRecords(localRecords, metadata(localRecords), { mode: 'replace', restoredAt: 1800000000000, payloadDigest: 'scale-seed' });
      localSeedMs = round(performance.now() - seedStarted);
      localRecords = null;
    }
    var stages = [await sample('start after local seed')];
    var response = await fetch('/incoming.json.gz', { cache: 'no-store' });
    if (!response.ok) throw new Error('incoming fixture fetch failed');
    var file = await response.blob();
    stages.push(await sample('compressed input loaded'));
    var decoded = await timed('decompression + UTF-8 decode + JSON.parse', function () {
      return root.PokerCareerPortableFile.readBackupFile(file);
    }, stages);
    var validated = await timed('Backup v1 validation + canonical digest + resolver', function () {
      return root.PokerCareerBackup.validateBackup(decoded.backup, crypto);
    }, stages);
    var resultRecordCount = count;
    if (mode === 'restore') {
      await timed('current Career export + Backup v1 digest', async function () {
        return root.PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      }, stages);
      await timed('native IndexedDB SAFE REPLACE + derived rebuild + verification', function () {
        return service.replaceCareerRecords(validated.records, validated.careerMetadata, { mode: 'replace', restoredAt: 1900000000000, payloadDigest: validated.summary.payloadDigest });
      }, stages);
    } else {
      var current = await timed('native IndexedDB local export + Backup v1 creation', async function () {
        return root.PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      }, stages);
      var merged = await timed('local + imported union resolution', function () {
        return root.PokerCareerBackup.mergeValidatedBackups({ records: current.records, careerMetadata: current.careerMetadata }, validated);
      }, stages);
      if (!merged.ok) throw new Error(merged.reason);
      resultRecordCount = merged.records.length;
      await timed('exact merged Backup v1 size/digest materialization', function () {
        return root.PokerCareerBackup.createBackup({
          careerStorageSchemaVersion: current.careerStorageSchemaVersion,
          recordSchemaVersion: current.recordSchemaVersion,
          aggregateSchemaVersion: current.aggregateSchemaVersion,
          metadata: merged.careerMetadata,
          records: merged.records
        }, crypto);
      }, stages);
      await timed('native IndexedDB merge + derived rebuild + verification', function () {
        return service.mergeCareerRecords(merged.records, merged.careerMetadata, { mode: 'merge', restoredAt: 1900000000000, payloadDigest: validated.summary.payloadDigest });
      }, stages);
    }
    root.careerScaleProgress = { stage: 'careerLedgerInfo', state: 'running', startedAt: Date.now() };
    var info = await service.careerLedgerInfo();
    root.careerScaleProgress = { stage: 'careerLedgerInfo', state: 'complete', completedAt: Date.now() };
    service.close();
    return {
      environment: navigator.userAgent + ' / native IndexedDB',
      crossOriginIsolated: root.crossOriginIsolated,
      mode: mode,
      localPhysicalRecords: mode === 'restore' ? 0 : count,
      incomingPhysicalRecords: count,
      mergedPhysicalRecords: resultRecordCount,
      committedPhysicalRecords: info.physicalRecordCount,
      compactBytes: Number(options.compactBytes),
      gzipBytes: Number(options.gzipBytes),
      compactKiBPerIncomingRecord: round(Number(options.compactBytes) / count / 1024),
      gzipBytesPerIncomingRecord: round(Number(options.gzipBytes) / count),
      localSeedMs: localSeedMs,
      stages: stages
    };
  };
  root.careerScaleBrowserReady = true;
})(typeof globalThis !== 'undefined' ? globalThis : this);
