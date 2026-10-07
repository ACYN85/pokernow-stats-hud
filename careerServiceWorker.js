/* MV3 extension-origin owner for the career IndexedDB database. */
'use strict';

importScripts('runtimeScope.js');
var PNHUD_BUILD_ID = globalThis.PokerNowRuntimeScope && globalThis.PokerNowRuntimeScope.buildId || 'unavailable';

importScripts('stats.js', 'careerStatsAggregator.js', 'filteredStats.js', 'statEvidence.js', 'careerContributionStore.js', 'careerIndexedStore.js', 'careerBackupPolicy.js', 'careerBackup.js');

var careerServicePromise = null;
var careerMutationQueue = Promise.resolve();
var careerRuntimeDiagnostics = { initializationDurationMs: null, lastAppendDurationMs: null, lastReplaceDurationMs: null, lastMergeDurationMs: null };
var SESSION_PROJECTION_ALARM = 'pnhud-career-session-projections';
var sessionProjectionDriverWork = null;
var sessionProjectionScheduleWork = null;
// Measured short/medium/long bursts: docs/V1_5_DERIVED_BACKFILL_THROUGHPUT.md.
// Admission stops at the deadline; an already-started atomic chunk may finish.
var DERIVED_BACKFILL_BUDGET_MS = 7500;
var DERIVED_BACKFILL_MAX_CHUNKS = 16;
// Native key-delete probe: 128 keys/batch, four low-priority admissions.
var DERIVED_CLEANUP_BUDGET_MS = 250;
var DERIVED_CLEANUP_MAX_BATCHES = 4;

async function derivedCleanupPending(service) {
  return Boolean(service.careerDerivedCleanupState && (await service.careerDerivedCleanupState()).pending);
}

function sessionProjectionNeedsWork(state) {
  return state.needsBackfill === undefined ? !state.ready : state.needsBackfill;
}
async function ensureSessionProjectionAlarm() {
  if (!chrome.alarms) return;
  if (!await chrome.alarms.get(SESSION_PROJECTION_ALARM))
    await chrome.alarms.create(SESSION_PROJECTION_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}
// Arm the durable continuation before opening/working. A terminated worker has
// no lease to expire; the next alarm/wake resumes the native checkpoint.
function scheduleSessionProjectionWork() {
  if (!chrome.alarms) return Promise.resolve();
  if (sessionProjectionScheduleWork) return sessionProjectionScheduleWork;
  sessionProjectionScheduleWork = queueCareerMutation(async function () {
    await ensureSessionProjectionAlarm();
    var service = await careerService(), state = await service.careerSessionProjectionState();
    var memberships = await service.careerHandMembershipState();
    if (!sessionProjectionNeedsWork(state) && !sessionProjectionNeedsWork(memberships) && !await derivedCleanupPending(service)) await chrome.alarms.clear(SESSION_PROJECTION_ALARM);
  }).finally(function () { sessionProjectionScheduleWork = null; });
  return sessionProjectionScheduleWork;
}
function driveCareerSessionProjections() {
  if (sessionProjectionDriverWork) return sessionProjectionDriverWork;
  sessionProjectionDriverWork = (async function () {
    var service;
    // Leave the periodic alarm armed before any work; never defer continuation
    // creation until an in-memory burst finishes. Bootstrap has its own cost.
    await queueCareerMutation(async function () { await ensureSessionProjectionAlarm(); service = await careerService(); });
    var started = monotonicNow(), chunks = 0;
    while (chunks < DERIVED_BACKFILL_MAX_CHUNKS && monotonicNow() - started < DERIVED_BACKFILL_BUDGET_MS) {
      var worked = await queueCareerMutation(async function () {
        // Re-read after queued appends/Restore/removal, never trust last iteration.
        var state = await service.careerSessionProjectionState(), memberships = await service.careerHandMembershipState();
        var sessionsNeedWork = sessionProjectionNeedsWork(state), membershipsNeedWork = sessionProjectionNeedsWork(memberships);
        if ((!sessionsNeedWork && !membershipsNeedWork) || monotonicNow() - started >= DERIVED_BACKFILL_BUDGET_MS) return false;
        // Least durable chunk progress goes first, Session wins ties. Restarted
        // generations start at zero. This survives worker loss, including wakes
        // that can afford only one chunk, without an in-memory turn or lease.
        var sessionChunks = state.status === 'building' && !state.restartRequired ? state.chunks || 0 : 0;
        var membershipChunks = memberships.status === 'building' && !memberships.restartRequired ? memberships.chunks || 0 : 0;
        if (sessionsNeedWork && (!membershipsNeedWork || sessionChunks <= membershipChunks))
          await service.backfillCareerSessionProjections({ maxChunks: 1, chunkGroups: 128,
            restart: Boolean(state.restartRequired || state.status === 'ready' || state.status === 'invalid') });
        else await service.backfillCareerHandMemberships({ maxChunks: 1, chunkGroups: 128, restart: Boolean(memberships.restartRequired) });
        return true;
      });
      if (!worked) break;
      chunks += 1;
      // Release queue ownership and give message/alarm tasks a turn each chunk.
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    // A wake that rebuilt anything yields cleanup until another opportunity.
    // Each cleanup admission rechecks readiness after queued mutations.
    var cleanupStarted = monotonicNow(), cleanupBatches = 0, cleanupDeleted = 0;
    if (chunks === 0 && service.cleanupCareerDerivedNamespaces) {
      while (cleanupBatches < DERIVED_CLEANUP_MAX_BATCHES && monotonicNow() - cleanupStarted < DERIVED_CLEANUP_BUDGET_MS) {
        var cleanup = await queueCareerMutation(async function () {
          var state = await service.careerSessionProjectionState(), memberships = await service.careerHandMembershipState();
          if (sessionProjectionNeedsWork(state) || sessionProjectionNeedsWork(memberships) ||
              monotonicNow() - cleanupStarted >= DERIVED_CLEANUP_BUDGET_MS) return null;
          if (!await derivedCleanupPending(service) || monotonicNow() - cleanupStarted >= DERIVED_CLEANUP_BUDGET_MS) return null;
          return service.cleanupCareerDerivedNamespaces();
        });
        if (!cleanup) break;
        cleanupBatches += 1; cleanupDeleted += cleanup.deleted;
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        if (!cleanup.pending) break;
      }
    }
    // The readiness check and alarm cleanup serialize with mutations too.
    return queueCareerMutation(async function () {
      var state = await service.careerSessionProjectionState(), memberships = await service.careerHandMembershipState();
      var remaining = sessionProjectionNeedsWork(state) || sessionProjectionNeedsWork(memberships) || await derivedCleanupPending(service);
      if (chrome.alarms && !remaining) await chrome.alarms.clear(SESSION_PROJECTION_ALARM);
      return Object.assign({}, state, { handMemberships: memberships, cleanupBurst: { batches: cleanupBatches, deleted: cleanupDeleted, elapsedMs: monotonicNow() - cleanupStarted }, backfillBurst: {
        chunks: chunks, elapsedMs: monotonicNow() - started,
        stopReason: !remaining ? 'complete' : chunks >= DERIVED_BACKFILL_MAX_CHUNKS ? 'chunks' : 'deadline'
      } });
    });
  })().finally(function () { sessionProjectionDriverWork = null; });
  return sessionProjectionDriverWork;
}

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

async function replayCareerOutbox(service) {
  if (typeof chrome.storage.local.getKeys !== 'function') return;
  var keys = await chrome.storage.local.getKeys();
  var outboxKeys = keys.filter(function (key) { return key.indexOf(PokerCareerIndexedStore.OUTBOX_PREFIX) === 0; });
  if (!outboxKeys.length) return;
  var saved = await chrome.storage.local.get(outboxKeys);
  var pending = PokerCareerIndexedStore.outboxRecords(saved);
  for (var index = 0; index < pending.length; index += 1) {
    var result = await service.append(pending[index].record);
    if (!result.accepted && !result.duplicate) throw new Error('Pending Career outbox record was rejected before data management: ' + result.reason);
    await chrome.storage.local.remove(pending[index].key);
  }
  if (pending.length) scheduleSessionProjectionWork().catch(function () {});
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

function requireSupportedValidatedBackup(operation, validated) {
  var summary = validated && validated.summary || {};
  var preflight = PokerCareerBackupPolicy.exportPreflight({
    physicalRecordCount: summary.physicalRecordCount,
    activeRecordCount: summary.activeRecordCount
  });
  if (!preflight.allowed) throw PokerCareerBackupPolicy.limitError(operation, preflight);
  return preflight;
}

function requireSupportedBackupClaim(operation, backup) {
  var integrity = backup && backup.integrity;
  if (!integrity || !Number.isInteger(integrity.physicalRecordCount) || integrity.physicalRecordCount < 0) return null;
  var preflight = PokerCareerBackupPolicy.exportPreflight({
    physicalRecordCount: integrity.physicalRecordCount,
    activeRecordCount: integrity.activeRecordCount
  });
  if (!preflight.allowed) throw PokerCareerBackupPolicy.limitError(operation, preflight);
  return preflight;
}

async function exactMergedBackupPreflight(currentBackup, mergePlan) {
  var mergedBackup = await PokerCareerBackup.createBackup({
    careerStorageSchemaVersion: currentBackup.careerStorageSchemaVersion,
    recordSchemaVersion: currentBackup.recordSchemaVersion,
    aggregateSchemaVersion: currentBackup.aggregateSchemaVersion,
    metadata: mergePlan.careerMetadata,
    records: mergePlan.records
  }, crypto);
  var exact = PokerCareerBackupPolicy.serializedPreflight(mergedBackup);
  return Object.assign({}, exact, {
    physicalRecordCount: mergePlan.summary.mergedPhysicalRecordCount,
    activeRecordCount: mergedBackup.integrity.activeRecordCount
  });
}

async function careerSnapshotForRemoval(service, request) {
  var exported = await service.exportCareer();
  var currentDigest = await PokerCareerBackup.digestCareerExport(exported, crypto);
  var plan = PokerCareerIndexedStore.sessionRemovalPlan(exported.records, request);
  var token = JSON.stringify({
    currentDigest: currentDigest,
    namespace: plan.namespace,
    historicalSessionId: plan.historicalSessionId,
    sessionHandIds: plan.sessionHandIds,
    logicalHandKeys: plan.logicalHandKeys,
    physicalFingerprints: plan.physicalFingerprints
  });
  return { exported: exported, currentDigest: currentDigest, plan: plan, token: token };
}

function removalPreview(snapshot) {
  var plan = snapshot.plan;
  return {
    currentDigest: snapshot.currentDigest,
    confirmationToken: snapshot.token,
    sessionHandCount: plan.sessionHandCount,
    matchedSessionHandCount: plan.matchedSessionHandIds.length,
    unmatchedSessionHandCount: plan.unmatchedSessionHandIds.length,
    logicalHandCount: plan.logicalHandCount,
    physicalRecordCount: plan.physicalRecordCount,
    affectedPlayerCount: plan.affectedPlayerIds.length,
    affectedPlayerIds: plan.affectedPlayerIds
  };
}

async function careerSnapshotForHistoricalDeletion(service, sessionId) {
  var exported = await service.exportCareer();
  var currentDigest = await PokerCareerBackup.digestCareerExport(exported, crypto);
  var plan = PokerCareerIndexedStore.historicalSessionDeletionPlan(exported.records, sessionId);
  return { currentDigest: currentDigest, plan: plan, token: currentDigest + ':delete:' + plan.sessionId };
}

async function trustedHistoricalDeletionCurrentIds(plan) {
  var namespaces = plan.namespaces || [];
  if (!namespaces.length) throw new Error('Cannot establish the live Session identity for historical deletion');
  var keys = namespaces.map(function (entry) { return 'pokerNowHudSessionMeta:game:' + encodeURIComponent(entry.host + ':' + entry.gameId); });
  var saved = await chrome.storage.local.get(keys);
  return namespaces.map(function (entry, index) {
    var meta = saved[keys[index]]; var expectedKey = entry.host + ':' + entry.gameId;
    if (!meta || meta.gameId !== entry.gameId || meta.sessionKey !== expectedKey ||
        typeof meta.historicalSessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(meta.historicalSessionId))
      throw new Error('Cannot establish the live Session identity for historical deletion; open that game before retrying');
    return meta.historicalSessionId;
  });
}

function historicalDeletionPreview(snapshot, currentIds) {
  var plan = snapshot.plan;
  return {
    sessionId: plan.sessionId, startedAt: plan.startedAt, endedAt: plan.endedAt,
    provenanceStatus: plan.provenanceStatus, logicalHandCount: plan.logicalHandCount,
    physicalRecordCount: plan.physicalRecordCount, tableSizeHands: plan.tableSizeHands,
    affectedPlayers: plan.affectedPlayers, affectedPlayerCount: plan.affectedPlayers.length,
    isCurrentCanonicalSession: currentIds.indexOf(plan.sessionId) >= 0,
    blocked: currentIds.indexOf(plan.sessionId) >= 0,
    blockingReason: currentIds.indexOf(plan.sessionId) >= 0 ? 'Use Remove Current Session from Career & Reset for the live Session' : null,
    currentDigest: snapshot.currentDigest, confirmationToken: snapshot.token
  };
}

var allowedMethods = Object.freeze({
  careerStats: true,
  careerStatsFiltered: true,
  careerDashboardStats: true,
  careerTrendStats: true,
  careerHudStats: true,
  careerPlayers: true,
  careerPlayerSummaries: true,
  careerSessionProjectionState: true,
  careerHandMembershipState: true,
  backfillCareerHandMemberships: true,
  readCareerHandMemberships: true,
  backfillCareerSessionProjections: true,
  readCareerSessionProjections: true,
  readCareerSessionProjectionPage: true,
  careerLedgerInfo: true,
  careerPlayerRecordInfo: true,
  recentCareerRecords: true,
  listCareerSessions: true,
  listCareerSessionsForPlayer: true,
  getCareerSession: true,
  getCareerSessionRecords: true,
  listCareerSessionPlayerSummaries: true,
  getCareerSessionPlayerStats: true,
  getCareerRecentPlayerStats: true,
  getCareerRecentVsCareer: true,
  getCareerRecentBatch: true,
  getCareerPlayerSessionTrend: true,
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
    if (message.method === 'openBackupV2Page') {
      var pages = { export: 'careerBackupV2Transfer.html', import: 'careerBackupV2Import.html' };
      var action = message.args && message.args[0];
      var page = Object.prototype.hasOwnProperty.call(pages, action) && pages[action];
      if (!page || !sender || sender.id !== chrome.runtime.id || !sender.tab ||
          !globalThis.PokerNowRuntimeScope.isPokerNowGamePage(sender.url))
        throw new Error('Backup v2 pages can only be opened from PokerNow Settings');
      await chrome.tabs.create({ url: chrome.runtime.getURL(page), openerTabId: sender.tab.id });
      return { opened: true };
    }
    var service = await careerService();
    if (message.method === 'prepareBackupV2Publication') {
      if (!sender || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('careerBackupV2Import.html'))
        throw new Error('Backup v2 publication preparation is internal only');
      return queueCareerMutation(async function () { await replayCareerOutbox(service); await ensureSessionProjectionAlarm(); return { outboxReplayed: true }; });
    }
    if (message.method === 'driveCareerSessionProjections') return driveCareerSessionProjections();
    if (message.method === 'backfillCareerSessionProjections') return queueCareerMutation(function () { return service.backfillCareerSessionProjections(message.args && message.args[0]); });
    if (message.method === 'backfillCareerHandMemberships') return queueCareerMutation(function () { return service.backfillCareerHandMemberships(message.args && message.args[0]); });
    if (message.method === 'initialize' || message.method === 'careerLedgerInfo') return careerLedgerInfoWithBackupPolicy(service);
    if (message.method === 'append') return queueCareerMutation(async function () { var started = monotonicNow(); try { return await service.append(message.args && message.args[0]); } finally { careerRuntimeDiagnostics.lastAppendDurationMs = Math.round((monotonicNow() - started) * 100) / 100; } });
    if (message.method === 'exportCareerBackup') return queueCareerMutation(async function () {
      await replayCareerOutbox(service); await requireSupportedCareerExport(service);
      var backup = await PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      var serialized = PokerCareerBackupPolicy.serializedPreflight(backup);
      if (!serialized.allowed) throw PokerCareerBackupPolicy.limitError('export', serialized);
      return backup;
    });
    if (message.method === 'validateCareerBackup') return (await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto)).summary;
    if (message.method === 'prepareCareerImport') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      requireSupportedBackupClaim('import', message.args && message.args[0]);
      var imported = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
      await requireSupportedCareerExport(service);
      var currentBackup = await PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      var plan = PokerCareerBackup.mergeValidatedBackups({ records: currentBackup.records, careerMetadata: currentBackup.careerMetadata }, imported);
      var mergedPreflight = PokerCareerBackupPolicy.exportPreflight({ physicalRecordCount: plan.summary.mergedPhysicalRecordCount, activeRecordCount: plan.activeRecords && plan.activeRecords.length || 0 });
      if (plan.ok && !mergedPreflight.allowed) throw PokerCareerBackupPolicy.limitError('import', mergedPreflight);
      if (plan.ok) {
        mergedPreflight = await exactMergedBackupPreflight(currentBackup, plan);
        if (!mergedPreflight.allowed) throw PokerCareerBackupPolicy.limitError('import', mergedPreflight);
      }
      return {
        canImport: plan.ok,
        reason: plan.ok ? null : plan.reason,
        candidatePayloadDigest: imported.summary.payloadDigest,
        candidate: imported.summary,
        currentPayloadDigest: currentBackup.integrity.payloadDigest,
        summary: plan.summary,
        mergedSizePolicy: mergedPreflight
      };
    });
    if (message.method === 'mergeCareerBackup') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      requireSupportedBackupClaim('import', message.args && message.args[0]);
      var importedPlan = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
      var confirmation = message.args && message.args[1];
      await requireSupportedCareerExport(service);
      var liveBackup = await PokerCareerBackup.createBackup(await service.exportCareer(), crypto);
      var mergePlan = PokerCareerBackup.mergeValidatedBackups({ records: liveBackup.records, careerMetadata: liveBackup.careerMetadata }, importedPlan);
      var combinedPreflight = PokerCareerBackupPolicy.exportPreflight({ physicalRecordCount: mergePlan.summary.mergedPhysicalRecordCount, activeRecordCount: mergePlan.activeRecords && mergePlan.activeRecords.length || 0 });
      if (!mergePlan.ok) throw new Error(mergePlan.reason);
      if (!combinedPreflight.allowed) throw PokerCareerBackupPolicy.limitError('import', combinedPreflight);
      combinedPreflight = await exactMergedBackupPreflight(liveBackup, mergePlan);
      if (!combinedPreflight.allowed) throw PokerCareerBackupPolicy.limitError('import', combinedPreflight);
      if (!confirmation || confirmation.mode !== 'merge' || confirmation.confirmed !== true || confirmation.expectedPayloadDigest !== importedPlan.summary.payloadDigest || confirmation.expectedCurrentPayloadDigest !== liveBackup.integrity.payloadDigest) throw new Error('Career import requires explicit candidate-and-current digest-bound confirmation');
      var mergeStarted = monotonicNow();
      try {
        await service.mergeCareerRecords(mergePlan.records, mergePlan.careerMetadata, { backupFormatVersion: importedPlan.summary.backupFormatVersion, payloadDigest: importedPlan.summary.payloadDigest, restoredAt: Date.now() });
        return { merged: true, summary: mergePlan.summary, ledgerInfo: await service.careerLedgerInfo() };
      } finally { careerRuntimeDiagnostics.lastMergeDurationMs = Math.round((monotonicNow() - mergeStarted) * 100) / 100; }
    });
    if (message.method === 'prepareCareerRestore') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      requireSupportedBackupClaim('restore', message.args && message.args[0]);
      var candidatePlan = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
      requireSupportedValidatedBackup('restore', candidatePlan);
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
        await replayCareerOutbox(service);
        requireSupportedBackupClaim('restore', message.args && message.args[0]);
        var plan = await PokerCareerBackup.validateBackup(message.args && message.args[0], crypto);
        requireSupportedValidatedBackup('restore', plan);
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
    if (message.method === 'prepareCareerSessionRemoval') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      return removalPreview(await careerSnapshotForRemoval(service, message.args && message.args[0]));
    });
    if (message.method === 'removeCareerSession') return queueCareerMutation(async function () {
      var request = message.args && message.args[0]; var confirmation = message.args && message.args[1];
      await replayCareerOutbox(service);
      var snapshot = await careerSnapshotForRemoval(service, request);
      if (!confirmation || confirmation.mode !== 'remove-current-session' || confirmation.confirmed !== true || confirmation.expectedCurrentDigest !== snapshot.currentDigest || confirmation.expectedConfirmationToken !== snapshot.token) throw new Error('Career Session removal requires explicit current-digest-bound confirmation');
      var result = snapshot.plan.logicalHandKeys.length
        ? await service.removeCareerHandKeys(snapshot.plan.logicalHandKeys)
        : { removed: false, logicalHandCount: 0, physicalRecordCount: 0, affectedPlayerIds: [] };
      return { removed: result.removed, preview: removalPreview(snapshot), result: result, ledgerInfo: await service.careerLedgerInfo() };
    });
    if (message.method === 'prepareCareerHistoricalSessionDeletion') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      var args = message.args || [];
      var snapshot = await careerSnapshotForHistoricalDeletion(service, args[0]);
      return historicalDeletionPreview(snapshot, await trustedHistoricalDeletionCurrentIds(snapshot.plan));
    });
    if (message.method === 'deleteCareerHistoricalSession') return queueCareerMutation(async function () {
      await replayCareerOutbox(service);
      var args = message.args || []; var sessionId = args[0]; var confirmation = args[1];
      var snapshot = await careerSnapshotForHistoricalDeletion(service, sessionId);
      if ((await trustedHistoricalDeletionCurrentIds(snapshot.plan)).indexOf(snapshot.plan.sessionId) >= 0)
        throw new Error('Use Remove Current Session from Career & Reset for the live Session');
      if (!confirmation || confirmation.mode !== 'delete-historical-session' || confirmation.confirmed !== true ||
          confirmation.expectedCurrentDigest !== snapshot.currentDigest || confirmation.expectedConfirmationToken !== snapshot.token)
        throw new Error('Historical Session deletion requires explicit current-digest-bound confirmation');
      var result = await service.removeCareerHandKeys(snapshot.plan.logicalHandKeys, snapshot.plan.physicalFingerprints);
      if (!result.removed) throw new Error('Historical Session no longer has authoritative Career hands');
      return { deleted: true, sessionId: snapshot.plan.sessionId,
        deletedLogicalHands: result.logicalHandCount, deletedPhysicalRecords: result.physicalRecordCount,
        affectedPlayers: snapshot.plan.affectedPlayers, affectedPlayerIds: result.affectedPlayerIds,
        mutationRevision: snapshot.token };
    });
    if (message.method === 'careerRuntimeTimings') return measuredCareerQueries(service, message.args && message.args[0]);
    if (message.method === 'exportCareer') { await requireSupportedCareerExport(service); return service.exportCareer(); }
    if (!allowedMethods[message.method] || typeof service[message.method] !== 'function') throw new Error('Unsupported career service method: ' + String(message.method));
    return service[message.method].apply(service, Array.isArray(message.args) ? message.args : []);
  })().then(function (value) {
    if (['append', 'replaceCareerBackup', 'mergeCareerBackup', 'removeCareerSession', 'deleteCareerHistoricalSession', 'backfillCareerSessionProjections', 'backfillCareerHandMemberships'].indexOf(message.method) >= 0)
      scheduleSessionProjectionWork().catch(function () {});
    sendResponse({ ok: true, value: value });
  }).catch(function (error) {
    sendResponse({ ok: false, error: String(error && error.message || error) });
  });
  return true;
});

if (chrome.alarms) chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === SESSION_PROJECTION_ALARM) driveCareerSessionProjections().catch(function () {});
});
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(function () { scheduleSessionProjectionWork().catch(function () {}); });
if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(function () { scheduleSessionProjectionWork().catch(function () {}); });
// One wake check, no in-memory timer loop or startup backfill. Ready/invalid
// catalogs remove the alarm; successful mutations can schedule it again.
scheduleSessionProjectionWork().catch(function () {});
