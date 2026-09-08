/* MV3 extension-origin owner for the career IndexedDB database. */
'use strict';

var PNHUD_BUILD_ID = 'v1.1.0-public-20260908';

importScripts('stats.js', 'careerStatsAggregator.js', 'filteredStats.js', 'careerContributionStore.js', 'careerIndexedStore.js', 'careerBackupPolicy.js', 'careerBackup.js');

var careerServicePromise = null;
var careerMutationQueue = Promise.resolve();
var careerRuntimeDiagnostics = { initializationDurationMs: null, lastAppendDurationMs: null, lastReplaceDurationMs: null };

function monotonicNow() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function queueCareerMutation(operation) {
  var pending = careerMutationQueue.then(operation);
  careerMutationQueue = pending.catch(function () {});
  return pending;
}

async function readCareerBootstrapStorage() {
  var databaseComplete = await PokerCareerIndexedStore.hasCompleteDatabase(indexedDB);
  var markerResult = await chrome.storage.local.get([PokerCareerIndexedStore.MIGRATION_MARKER_KEY]);
  if (!databaseComplete) {
    return chrome.storage.local.get(null);
  }
  if (typeof chrome.storage.local.getKeys !== 'function') return chrome.storage.local.get(null);
  var keys = await chrome.storage.local.getKeys();
  var outboxKeys = keys.filter(function (key) { return key.indexOf(PokerCareerIndexedStore.OUTBOX_PREFIX) === 0; });
  if (!outboxKeys.length) return markerResult;
  return Object.assign(markerResult, await chrome.storage.local.get(outboxKeys));
}

async function initializeCareerService() {
  var startedAt = monotonicNow();
  var saved = await readCareerBootstrapStorage();
  var service = await PokerCareerIndexedStore.createIndexedService(indexedDB, saved, {
    initializedAt: Date.now(),
    buildId: PNHUD_BUILD_ID
  });
  var pending = PokerCareerIndexedStore.outboxRecords(saved);
  for (var index = 0; index < pending.length; index += 1) {
    var result = await service.append(pending[index].record);
    if (!result.accepted && !result.duplicate) throw new Error('Pending career outbox record was rejected: ' + result.reason);
    await chrome.storage.local.remove(pending[index].key);
  }
  var markerUpdate = {};
  markerUpdate[PokerCareerIndexedStore.MIGRATION_MARKER_KEY] = {
    state: 'complete',
    storageSchemaVersion: PokerCareerIndexedStore.STORAGE_SCHEMA_VERSION,
    completedAt: Date.now(),
    backend: 'extension-service-worker-indexeddb'
  };
  await chrome.storage.local.set(markerUpdate);
  careerRuntimeDiagnostics.initializationDurationMs = Math.round((monotonicNow() - startedAt) * 100) / 100;
  return service;
}

function careerService() {
  if (!careerServicePromise) {
    careerServicePromise = initializeCareerService().catch(function (error) {
      careerServicePromise = null;
      throw error;
    });
  }
  return careerServicePromise;
}

async function careerLedgerInfoWithBackupPolicy(service) {
  return PokerCareerBackupPolicy.withDiagnostics(await service.careerLedgerInfo());
}

async function requireSupportedCareerExport(service) {
  var info = await careerLedgerInfoWithBackupPolicy(service);
  if (!info.backupSizePolicy.allowed) throw PokerCareerBackupPolicy.limitError('export', info.backupSizePolicy);
  return info;
}

var allowedMethods = Object.freeze({
  careerStats: true,
  careerStatsFiltered: true,
  careerDashboardStats: true,
  careerHudStats: true,
  careerPlayers: true,
  careerLedgerInfo: true,
  careerPlayerRecordInfo: true,
  recentCareerRecords: true,
  rebuildCareerStats: true,
  exportCareer: true
});

async function measuredCareerQueries(service, playerId) {
  async function measured(name, operation) { var started = monotonicNow(); var value = await operation(); return { name: name, durationMs: Math.round((monotonicNow() - started) * 100) / 100, value: value }; }
  var ledger = await measured('careerLedgerInfo', function () { return service.careerLedgerInfo(); });
  var effectivePlayerId = playerId || null;
  if (!effectivePlayerId) {
    var playersForIdentity = await service.careerPlayers();
    effectivePlayerId = playersForIdentity[0] && playersForIdentity[0].playerId || null;
  }
  var diagnosticStats = typeof service.careerStatsDiagnostic === 'function' ? function () { return service.careerStatsDiagnostic(effectivePlayerId); } : function () { return service.careerStats(effectivePlayerId).then(function (player) { return { player: player, cacheHit: null, rebuiltFromPlayerIndex: null }; }); };
  var first = effectivePlayerId ? await measured('careerStatsFirstCall', diagnosticStats) : null;
  var second = effectivePlayerId ? await measured('careerStatsSecondCall', diagnosticStats) : null;
  var players = await measured('careerPlayers', function () { return service.careerPlayers(); });
  var recent = await measured('recentCareerRecords', function () { return service.recentCareerRecords(10); });
  return {
    environment: 'actual-extension-runtime',
    measuredAt: Date.now(),
    playerId: effectivePlayerId,
    databaseInitializationDurationMs: careerRuntimeDiagnostics.initializationDurationMs,
    lastIncrementalAppendDurationMs: careerRuntimeDiagnostics.lastAppendDurationMs,
    lastReplaceDurationMs: careerRuntimeDiagnostics.lastReplaceDurationMs,
    operations: [ledger, first, second, players, recent].filter(Boolean).map(function (entry) { return { name: entry.name, durationMs: entry.durationMs, resultCount: Array.isArray(entry.value) ? entry.value.length : null, cacheHit: entry.value && Object.prototype.hasOwnProperty.call(entry.value, 'cacheHit') ? entry.value.cacheHit : null, rebuiltFromPlayerIndex: entry.value && Object.prototype.hasOwnProperty.call(entry.value, 'rebuiltFromPlayerIndex') ? entry.value.rebuiltFromPlayerIndex : null }; })
  };
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== PokerCareerIndexedStore.MESSAGE_TYPE) return false;
  (async function () {
    var service = await careerService();
    if (message.method === 'initialize' || message.method === 'careerLedgerInfo') return careerLedgerInfoWithBackupPolicy(service);
    if (message.method === 'append') return queueCareerMutation(async function () { var started = monotonicNow(); try { return await service.append(message.args && message.args[0]); } finally { careerRuntimeDiagnostics.lastAppendDurationMs = Math.round((monotonicNow() - started) * 100) / 100; } });
    if (message.method === 'exportCareerBackup') return queueCareerMutation(async function () { await requireSupportedCareerExport(service); return PokerCareerBackup.createBackup(await service.exportCareer(), crypto); });
    if (message.method === 'validateCareerBackup') return (await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto)).summary;
    if (message.method === 'prepareCareerRestore') return queueCareerMutation(async function () {
      var candidatePlan = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
      await requireSupportedCareerExport(service);
      var currentBackup = await PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      return { candidate: candidatePlan.summary, current: {
        payloadDigest: currentBackup.integrity.payloadDigest,
        physicalRecordCount: currentBackup.integrity.physicalRecordCount,
        activeRecordCount: currentBackup.integrity.activeRecordCount,
        playerCount: currentBackup.integrity.playerCount,
        careerTrackingStartedAt: currentBackup.careerMetadata.careerTrackingStartedAt
      } };
    });
    if (message.method === 'replaceCareerBackup') {
      return queueCareerMutation(async function () {
        var plan = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
        var confirmation = message.args && message.args[1];
        await requireSupportedCareerExport(service);
        var currentBackup = await PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
        if (!confirmation || confirmation.mode !== 'replace' || confirmation.confirmed !== true || confirmation.expectedPayloadDigest !== plan.summary.payloadDigest || confirmation.expectedCurrentPayloadDigest !== currentBackup.integrity.payloadDigest) throw new Error('Career replacement requires explicit candidate-and-current digest-bound confirmation');
        var started = monotonicNow();
        try {
          await service.replaceCareerRecords(plan.records, plan.careerMetadata, { backupFormatVersion: plan.summary.backupFormatVersion, payloadDigest: plan.summary.payloadDigest, restoredAt: Date.now() });
          return { replaced: true, summary: plan.summary, ledgerInfo: await service.careerLedgerInfo() };
        } finally { careerRuntimeDiagnostics.lastReplaceDurationMs = Math.round((monotonicNow() - started) * 100) / 100; }
      });
    }
    if (message.method === 'careerRuntimeTimings') return measuredCareerQueries(service, message.args && message.args[0]);
    if (message.method === 'exportCareer') { await requireSupportedCareerExport(service); return service.exportCareer(); }
    if (!allowedMethods[message.method] || typeof service[message.method] !== 'function') throw new Error('Unsupported career service method: ' + String(message.method));
    return service[message.method].apply(service, Array.isArray(message.args) ? message.args : []);
  })().then(function (value) {
    sendResponse({ ok: true, value: value });
  }).catch(function (error) {
    sendResponse({ ok: false, error: String(error && error.message || error) });
  });
  return true;
});
