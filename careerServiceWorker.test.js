'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var backupPolicy = require('./careerBackupPolicy.js');

(async function () {
  var listener = null;
  var removed = [];
  var writes = [];
  var appended = [];
  var replacements = [];
  var exportCareerCalls = 0;
  var ledgerInfo = { ready: true, backend: 'indexeddb', physicalRecordCount: 1, activeRecordCount: 1 };
  var databaseToken = { owner: 'extension-service-worker' };
  var pendingRecord = { fingerprint: 'pending-fingerprint' };
  var service = {
    append: async function (record) { appended.push(record); return { accepted: true }; },
    careerLedgerInfo: async function () { return Object.assign({}, ledgerInfo); },
    careerStats: async function (playerId) { return { playerId: playerId }; },
    careerStatsFiltered: async function (playerId, filters) { return { playerId: playerId, filters: filters }; },
    careerDashboardStats: async function (playerId, options) { return { playerId: playerId, options: options, combined: true }; },
    careerPlayers: async function () { return [{ playerId: 'P1' }]; },
    recentCareerRecords: async function () { return [{ fingerprint: 'recent' }]; },
    exportCareer: async function () { exportCareerCalls += 1; return { records: [{ fingerprint: 'formal-record' }] }; },
    replaceCareerRecords: async function (records, metadata, options) { replacements.push({ records: records, metadata: metadata, options: options }); return { replaced: true }; }
  };
  var backupModule = {
    createBackup: async function () { return { backupFormatVersion: 1, careerMetadata: { careerTrackingStartedAt: 50 }, integrity: { payloadDigest: 'current-digest-456', physicalRecordCount: 1, activeRecordCount: 1, playerCount: 1 } }; },
    validateBackup: async function (value) {
      if (value && value.invalid) throw new Error('invalid backup fixture');
      return { records: [{ fingerprint: 'restore-record' }], careerMetadata: { careerTrackingStartedAt: 50 }, summary: { backupFormatVersion: 1, payloadDigest: 'digest-123', physicalRecordCount: 1 } };
    }
  };
  var indexedModule = {
    MESSAGE_TYPE: 'PNHUD_CAREER_INDEXED_REQUEST',
    MIGRATION_MARKER_KEY: 'migration',
    STORAGE_SCHEMA_VERSION: 2,
    OUTBOX_PREFIX: 'outbox:',
    hasCompleteDatabase: async function (database) { assert.strictEqual(database, databaseToken); return true; },
    outboxRecords: function () { return [{ key: 'outbox:pending', record: pendingRecord }]; },
    createIndexedService: async function (database, saved) {
      assert.strictEqual(database, databaseToken, 'the worker passes its extension-origin IndexedDB global to the backend');
      assert.ok(saved['outbox:pending']);
      return service;
    }
  };
  var context = {
    importScripts: function () {},
    indexedDB: databaseToken,
    PokerCareerIndexedStore: indexedModule,
    PokerCareerBackup: backupModule,
    PokerCareerBackupPolicy: backupPolicy,
    crypto: {},
    chrome: {
      storage: { local: {
        get: async function (keys) {
          if (keys === null) return {};
          if (Array.isArray(keys) && keys[0] === 'migration') return { migration: { state: 'complete', storageSchemaVersion: 2 } };
          if (Array.isArray(keys) && keys[0] === 'outbox:pending') return { 'outbox:pending': pendingRecord };
          return {};
        },
        getKeys: async function () { return ['unrelated', 'outbox:pending']; },
        remove: async function (key) { removed.push(key); },
        set: async function (value) { writes.push(value); }
      } },
      runtime: {
        getManifest: function () { return { version: '0.1.0' }; },
        onMessage: { addListener: function (value) { listener = value; } }
      }
    },
    console: console,
    Date: Date,
    Promise: Promise,
    Object: Object,
    Array: Array,
    String: String,
    Error: Error
  };
  vm.runInNewContext(fs.readFileSync('./careerServiceWorker.js', 'utf8'), context, { filename: 'careerServiceWorker.js' });
  assert.strictEqual(typeof listener, 'function', 'service worker registers one career message listener');

  function request(method, args) {
    return new Promise(function (resolve) {
      assert.strictEqual(listener({ type: indexedModule.MESSAGE_TYPE, method: method, args: args || [] }, {}, resolve), true);
    });
  }
  var initialized = await request('initialize');
  assert.strictEqual(initialized.ok, true);
  assert.strictEqual(initialized.value.ready, true);
  assert.strictEqual(initialized.value.backupSizePolicy.allowed, true, 'ledger diagnostics expose the V1 backup estimate and bound');
  assert.deepStrictEqual(appended, [pendingRecord], 'worker startup replays the durable outbox before accepting requests');
  assert.deepStrictEqual(removed, ['outbox:pending']);
  assert.strictEqual(writes.length, 1, 'migration completion marker is written after recovery');
  var stats = await request('careerStats', ['P1']);
  assert.strictEqual(stats.ok, true);
  assert.strictEqual(stats.value.playerId, 'P1');
  var filteredStats = await request('careerStatsFiltered', ['P1', { position: 'BB' }]);
  assert.strictEqual(filteredStats.ok, true);
  assert.strictEqual(filteredStats.value.filters.position, 'BB');
  var dashboardStats = await request('careerDashboardStats', ['P1', { position: 'BTN', canonicalSelfId: 'P1' }]);
  assert.strictEqual(dashboardStats.ok, true);
  assert.strictEqual(dashboardStats.value.combined, true, 'service worker routes the combined Career dashboard query');
  assert.strictEqual(dashboardStats.value.options.position, 'BTN');
  var exportedBackup = await request('exportCareerBackup');
  assert.strictEqual(exportedBackup.ok, true);
  assert.strictEqual(exportedBackup.value.integrity.payloadDigest, 'current-digest-456');
  var validatedBackup = await request('validateCareerBackup', [{ candidate: true }]);
  assert.strictEqual(validatedBackup.ok, true);
  assert.strictEqual(validatedBackup.value.physicalRecordCount, 1);
  var preview = await request('prepareCareerRestore', [{ candidate: true }]);
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.value.candidate.payloadDigest, 'digest-123');
  assert.strictEqual(preview.value.current.payloadDigest, 'current-digest-456');
  assert.strictEqual((await request('replaceCareerBackup', [{ candidate: true }, { mode: 'replace', confirmed: true, expectedPayloadDigest: 'wrong', expectedCurrentPayloadDigest: 'current-digest-456' }])).ok, false, 'replacement rejects confirmation not bound to the validated backup digest');
  assert.strictEqual(replacements.length, 0, 'failed confirmation performs no mutation');
  assert.strictEqual((await request('replaceCareerBackup', [{ candidate: true }, { mode: 'replace', confirmed: true, expectedPayloadDigest: 'digest-123', expectedCurrentPayloadDigest: 'stale-current' }])).ok, false, 'replacement rejects when live career changed after preview');
  assert.strictEqual(replacements.length, 0);
  var replacedBackup = await request('replaceCareerBackup', [{ candidate: true }, { mode: 'replace', confirmed: true, expectedPayloadDigest: 'digest-123', expectedCurrentPayloadDigest: 'current-digest-456' }]);
  assert.strictEqual(replacedBackup.ok, true);
  assert.strictEqual(replacements.length, 1);
  assert.strictEqual(replacements[0].metadata.careerTrackingStartedAt, 50);
  assert.strictEqual((await request('replaceCareerBackup', [{ invalid: true }, { mode: 'replace', confirmed: true, expectedPayloadDigest: 'digest-123', expectedCurrentPayloadDigest: 'current-digest-456' }])).ok, false);
  assert.strictEqual(replacements.length, 1, 'validation failure occurs before the replacement method is entered');
  var timings = await request('careerRuntimeTimings', ['P1']);
  assert.strictEqual(timings.ok, true);
  assert.strictEqual(timings.value.environment, 'actual-extension-runtime');
  assert.deepStrictEqual(Array.from(timings.value.operations, function (entry) { return entry.name; }), ['careerLedgerInfo', 'careerStatsFirstCall', 'careerStatsSecondCall', 'careerPlayers', 'recentCareerRecords']);
  var exportCallsBeforeOversize = exportCareerCalls;
  ledgerInfo.physicalRecordCount = 100000;
  ledgerInfo.activeRecordCount = 99000;
  var oversizedExport = await request('exportCareerBackup');
  assert.strictEqual(oversizedExport.ok, false, 'service worker rejects an oversized export from metadata');
  assert.match(oversizedExport.error, /database remains intact/i);
  assert.strictEqual(exportCareerCalls, exportCallsBeforeOversize, 'oversized export is rejected before IndexedDB getAll/exportCareer');
  var rejected = await request('notAllowed');
  assert.strictEqual(rejected.ok, false, 'worker rejects methods outside the explicit allowlist');

  assert.match(fs.readFileSync('./careerServiceWorker.js', 'utf8'), /hasCompleteDatabase\(indexedDB\)/, 'startup verifies committed database metadata rather than trusting a stale Chrome marker');

  var staleListener = null;
  var staleReadAll = false;
  var staleModule = Object.assign({}, indexedModule, {
    hasCompleteDatabase: async function () { return false; },
    outboxRecords: function () { return []; },
    createIndexedService: async function (_database, staleSaved) {
      assert.ok(staleSaved['pokerNowHudCareerV1:record:legacy'], 'stale marker recovery supplies the retained Phase 1 source to structural migration');
      return service;
    }
  });
  var staleContext = {
    importScripts: function () {}, indexedDB: databaseToken, PokerCareerIndexedStore: staleModule, PokerCareerBackup: backupModule, PokerCareerBackupPolicy: backupPolicy, crypto: {},
    chrome: {
      storage: { local: {
        get: async function (keys) {
          if (keys === null) { staleReadAll = true; return { 'pokerNowHudCareerV1:record:legacy': { fingerprint: 'legacy' } }; }
          return { migration: { state: 'complete', storageSchemaVersion: 2 } };
        },
        getKeys: async function () { return []; }, remove: async function () {}, set: async function () {}
      } },
      runtime: { getManifest: function () { return { version: '0.1.0' }; }, onMessage: { addListener: function (value) { staleListener = value; } } }
    },
    console: console, Date: Date, Promise: Promise, Object: Object, Array: Array, String: String, Error: Error
  };
  vm.runInNewContext(fs.readFileSync('./careerServiceWorker.js', 'utf8'), staleContext, { filename: 'careerServiceWorker-stale-marker.js' });
  await new Promise(function (resolve) { staleListener({ type: staleModule.MESSAGE_TYPE, method: 'initialize', args: [] }, {}, resolve); });
  assert.strictEqual(staleReadAll, true, 'a stale complete marker cannot hide a missing/incomplete IndexedDB database');

  var source = fs.readFileSync('./content.js', 'utf8');
  assert.doesNotMatch(source, /\bcreateIndexedService\s*\(/, 'content script never opens the IndexedDB backend');
  assert.doesNotMatch(source, /\bindexedDB\b/, 'content script never touches host-origin IndexedDB');
  assert.match(source, /createMessageService\(chrome\.runtime\)/, 'content script reaches the extension-origin backend only through runtime messaging');
  var debugStart = source.indexOf('function createCareerDebugApi'); var debugEnd = source.indexOf('function installCareerDebugApi', debugStart);
  assert.ok(debugStart >= 0 && debugEnd > debugStart);
  assert.doesNotMatch(source.slice(debugStart, debugEnd), /replaceCareerBackup/, 'destructive replacement is never exposed through the page debug API');
  console.log('Career MV3 service worker owns IndexedDB, recovers the outbox, and enforces the message allowlist.');
})().catch(function (error) { console.error(error); process.exit(1); });
