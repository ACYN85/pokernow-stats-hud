'use strict';
var assert = require('assert');
var crypto = require('crypto').webcrypto;
var runtime = require('./sessionRuntime.js');
var aggregator = require('./careerStatsAggregator.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var indexed = require('./careerIndexedStore.js');
var backup = require('./careerBackup.js');
var production = require('./testSupport/productionContentScriptHarness.js');

var A = '00000000-0000-4000-8000-000000000001';
var B = '00000000-0000-4000-8000-000000000002';
var C = '00000000-0000-4000-8000-000000000003';
function player(id, hands) { return fixtures.player(id, id, { hands: hands === undefined ? 1 : hands }); }
function hand(game, id, sessionId, at, ids, count, options) {
  options = options || {};
  var rows = ids.map(function (entry) { return player(entry[0], entry[1]); });
  rows.forEach(function (row) { row.position = { schemaVersion: 1, status: 'supported', dealtPosition: 'BTN', dealtPlayerCount: count, unsupportedReason: null }; });
  return fixtures.record(game, id, rows, { finalizedAt: at, historicalSessionId: sessionId, semanticVersions: options.versions, supersedesFingerprint: options.predecessor });
}
function legacy(record) { var result = structuredClone(record); result.schemaVersion = 3; delete result.session; result.fingerprint = aggregator.fingerprint(result); return result; }
function metadata(records) {
  var sorted = records.slice().sort(function (left, right) { return left.finalizedAt - right.finalizedAt; });
  return { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'history-test', firstAcceptedHandKey: sorted[0].handKey, firstAcceptedAt: sorted[0].finalizedAt, latestAcceptedAt: sorted[sorted.length - 1].finalizedAt };
}
function exportShape(records) { return { careerStorageSchemaVersion: 2, recordSchemaVersion: 4, aggregateSchemaVersion: 4, metadata: metadata(records), records: records }; }
function productionHarness(gameId, storage, failStorageSet) {
  return production.createHarness({ gameId: gameId, initialStorage: storage,
    crypto: { getRandomValues: function (bytes) { bytes.fill(0); bytes[15] = 9; return bytes; } },
    failStorageSet: failStorageSet,
    transformContentSource: function (source) {
      return source.replace(/\n\}\)\(\);\s*$/, '\n globalThis.__historyEpochTest = { id: function () { return historicalSessionId; }, reset: resetCurrentSession };\n})();\n');
    }
  });
}
function productionId(harness) { return harness.evaluateInIsolatedWorld('__historyEpochTest.id()'); }

(async function () {
  var generated = runtime.newHistoricalSessionId({ getRandomValues: function (bytes) { bytes.fill(0); bytes[15] = 1; return bytes; } });
  assert.strictEqual(generated, A);
  assert.strictEqual(runtime.restoreHistoricalSessionId({ gameId: 'G', sessionKey: 'pokernow.com:G', historicalSessionId: A }, 'G', 'pokernow.com:G'), A, 'reload, reconnect, extension reload and return to the same room restore the persisted epoch');
  assert.strictEqual(runtime.restoreHistoricalSessionId({ gameId: 'G', sessionKey: 'pokernow.com:G', historicalSessionId: A }, 'OTHER', 'pokernow.com:OTHER'), null, 'new game has a separate epoch');
  assert.strictEqual(runtime.newHistoricalSessionId({}), null, 'missing secure randomness leaves new provenance explicitly unsupported');
  assert.notStrictEqual(A, B, 'explicit reset uses a new epoch even with the same roster and room');
  var gameId = 'history-write-failure';
  var storageKeys = production.storageKeys(gameId);
  var metaKey = 'pokerNowHudSessionMeta:game:pokernow.com%3A' + gameId;
  var priorStorage = {}; priorStorage[storageKeys.schema] = 4; priorStorage[storageKeys.liveEvents] = [];
  var failedStartup = productionHarness(gameId, priorStorage, function (update) { return Boolean(update[metaKey]); });
  assert.deepStrictEqual(failedStartup.evaluationErrors, []);
  assert.strictEqual(productionId(failedStartup), null, 'failed startup metadata write cannot certify a transient Session ID');
  var afterFailedStartup = productionHarness(gameId, failedStartup.storage);
  assert.deepStrictEqual(afterFailedStartup.evaluationErrors, []);
  assert.strictEqual(productionId(afterFailedStartup), '00000000-0000-4000-8000-000000000009', 'reload starts a durable epoch after failed startup write');
  var durableBeforeReset = productionId(afterFailedStartup);
  var failedReset = productionHarness(gameId, afterFailedStartup.storage, function (update) { return Boolean(update[metaKey] && update[metaKey].resetAt); });
  assert.strictEqual(productionId(failedReset), durableBeforeReset);
  failedReset.evaluateInIsolatedWorld('__historyEpochTest.reset()');
  assert.strictEqual(productionId(failedReset), null, 'failed reset write withholds explicit provenance');
  var afterFailedResetReload = productionHarness(gameId, failedReset.storage);
  assert.strictEqual(productionId(afterFailedResetReload), durableBeforeReset, 'reload retains the last durable Session after failed reset');

  var first = hand('G', 'H1', A, 100, [['liam'], ['austin']], 2);
  var second = hand('G', 'H2', A, 200, [['liam'], ['eric'], ['seated-only', 0]], 3);
  var third = hand('G', 'H3', B, 200, [['liam'], ['austin']], 2);
  var unknown = hand('G', 'H4', null, 300, [['legacy-player']], 2);
  var old = legacy(hand('G', 'H5', null, 400, [['legacy-player']], 2));
  var root = hand('G', 'CORRECTED', C, 150, [['austin']], 2, { versions: { preflop: 1 } });
  var tip = hand('G', 'CORRECTED', C, 160, [['austin']], 2, { versions: { preflop: 2 }, predecessor: root.fingerprint });
  var records = [first, second, third, unknown, old, root, tip];
  assert.strictEqual(records.every(function (record) { return aggregator.validateRecord(record) === null; }), true);
  var service = indexed.createMemoryService({}, { initializedAt: 1 });
  for (var record of records) assert.strictEqual((await service.append(record)).accepted, true);
  var sessions = await service.listCareerSessions();
  assert.deepStrictEqual(sessions.map(function (row) { return row.sessionId; }), [A, B, C], 'end-time ordering uses canonical ID tie-break and ignores unassigned history');
  assert.deepStrictEqual(await service.getCareerSession(A), { sessionId: A, provenanceStatus: 'explicit', startedAt: 100, endedAt: 200, handCount: 2, tableSizeHands: { HU: 1, '3_TO_5': 1, SIX_PLUS: 0, UNKNOWN: 0 } });
  assert.deepStrictEqual((await service.listCareerSessionsForPlayer('liam')).map(function (row) { return [row.sessionId, row.playerHandCount]; }), [[A, 2], [B, 1]]);
  assert.deepStrictEqual((await service.listCareerSessionsForPlayer('austin')).map(function (row) { return [row.sessionId, row.playerHandCount]; }), [[A, 1], [B, 1], [C, 1]]);
  assert.deepStrictEqual(await service.listCareerSessionsForPlayer('seated-only'), [], 'zero-hand seat does not establish player Session participation');
  assert.strictEqual((await service.getCareerSessionRecords(C)).length, 1, 'supersession selects only the active tip');
  assert.strictEqual((await service.careerStats('legacy-player')).counters.hands, 2, 'legacy and explicitly unsupported hands remain in Career');
  assert.deepStrictEqual(sessions, aggregator.historicalSessionCatalog(records).map(function (row) { return aggregator.publicSessionSummary(row); }), 'incremental append catalog equals fresh derivation');

  var conflicting = hand('G', 'CORRECTED', B, 170, [['austin']], 2, { versions: { preflop: 3 }, predecessor: tip.fingerprint });
  assert.match(aggregator.validateTransition(tip, conflicting), /cross-session/);
  assert.strictEqual((await service.append(conflicting)).conflict, true, 'one logical hand cannot move to a second explicit Session');
  var invalid = structuredClone(first); invalid.handKey = 'invalid';
  assert.deepStrictEqual(aggregator.historicalSessionCatalog([invalid]), [], 'rejected record creates no Session');
  var fork = structuredClone(root); fork.supersedesFingerprint = null; fork.players[0].counters.vpipMade = 1; fork.fingerprint = aggregator.fingerprint(fork);
  assert.deepStrictEqual(aggregator.historicalSessionCatalog([root, fork]), [], 'quarantined logical hand creates no Session');

  var portable = await backup.createBackup(exportShape(records), crypto);
  assert.strictEqual(portable.backupFormatVersion, 1, 'Backup format remains v1');
  var restored = await backup.validateBackup(portable, crypto);
  assert.deepStrictEqual(restored.records.map(function (row) { return row.session && row.session.sessionId || null; }).sort(), records.map(function (row) { return row.session && row.session.sessionId || null; }).sort());
  var replacement = indexed.createMemoryService({}, { initializedAt: 1 });
  await replacement.replaceCareerRecords(restored.records, restored.careerMetadata);
  assert.deepStrictEqual(await replacement.listCareerSessions(), sessions, 'Restore Replace reconstructs the same topology');
  var importedHand = hand('G', 'IMPORT', '00000000-0000-4000-8000-000000000004', 250, [['liam']], 2);
  var importedBackup = await backup.createBackup(exportShape([importedHand]), crypto);
  var merged = backup.mergeValidatedBackups(restored, await backup.validateBackup(importedBackup, crypto));
  assert.strictEqual(merged.ok, true);
  await replacement.mergeCareerRecords(merged.records, merged.careerMetadata);
  assert.strictEqual((await replacement.listCareerSessions()).length, 4, 'Import Merge keeps independent Sessions distinct');
  var collision = hand('OTHER', 'IMPORT-OTHER', A, 250, [['liam']], 2);
  var collisionBackup = await backup.createBackup(exportShape([collision]), crypto);
  assert.strictEqual(backup.mergeValidatedBackups(restored, await backup.validateBackup(collisionBackup, crypto)).ok, false, 'cross-room imported ID collision fails closed');

  var removal = indexed.sessionRemovalPlan(records, { namespace: first.namespace, historicalSessionId: A, sessionHandIds: ['H1', 'H2'] });
  assert.deepStrictEqual(removal.logicalHandKeys, [first.handKey, second.handKey]);
  assert.throws(function () { indexed.sessionRemovalPlan(records, { namespace: first.namespace, historicalSessionId: B, sessionHandIds: ['H1'] }); }, /disagrees/, 'current removal rejects conflicting canonical provenance');
  await service.removeCareerHandKeys(removal.logicalHandKeys);
  var remaining = await service.exportCareer();
  assert.deepStrictEqual(await service.listCareerSessions(), aggregator.historicalSessionCatalog(remaining.records).map(function (row) { return aggregator.publicSessionSummary(row); }), 'removal and fresh catalog derivation agree');
  assert.strictEqual(await service.getCareerSession(A), null);
  console.log('Historical Session identity, provenance, catalog, lifecycle, portability, supersession, quarantine and removal tests passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
