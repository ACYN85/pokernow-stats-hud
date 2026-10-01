'use strict';

const assert = require('node:assert/strict');
const indexed = require('./careerIndexedStore.js');
const aggregator = require('./careerStatsAggregator.js');
const fixtures = require('./testSupport/careerBackupFixtures.js');
const Backup = require('./careerBackup.js');
const queryHarness = require('./testSupport/careerDashboardQueryHarness.js');
const contribution = require('./careerContributionStore.js');

const A = '00000000-0000-4000-8000-000000000101';
const B = '00000000-0000-4000-8000-000000000102';
const C = '00000000-0000-4000-8000-000000000103';
function record(id, sessionId, at, names, options) {
  options = options || {};
  const players = names.map((name, index) => {
    const row = fixtures.player(name, name, { vpipMade: index === 0 ? 1 : 0 });
    row.position = { schemaVersion: 1, status: 'supported', dealtPosition: index === 0 ? 'BTN' : index === 1 ? 'BB' : 'SB', dealtPlayerCount: names.length, unsupportedReason: null };
    return row;
  });
  return fixtures.record('HISTORICAL-DELETE', id, players, { historicalSessionId: sessionId, finalizedAt: at,
    semanticVersions: options.versions, supersedesFingerprint: options.predecessor });
}

(async () => {
  const root = record('B-CHAIN', B, 200, ['A', 'B'], { versions: { preflop: 1 } });
  const tip = record('B-CHAIN', B, 201, ['A', 'B'], { versions: { preflop: 2 }, predecessor: root.fingerprint });
  const rows = [record('A', A, 100, ['A', 'C']), root, tip, record('B-MIXED', B, 202, ['A', 'B', 'C']), record('C', C, 300, ['A', 'C'])];
  const plan = indexed.historicalSessionDeletionPlan(rows, B);
  assert.deepEqual(plan.logicalHandKeys, [root.handKey, rows[3].handKey].sort());
  assert.equal(plan.logicalHandCount, 2);
  assert.equal(plan.physicalRecordCount, 3, 'superseded root and active tip are both selected');
  assert.deepEqual(plan.affectedPlayers.map(row => [row.playerId, row.handCount]), [['A', 2], ['B', 2], ['C', 1]]);
  assert.deepEqual(plan.tableSizeHands, { HU: 1, '3_TO_5': 1, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.equal(plan.provenanceStatus, 'explicit');
  assert.throws(() => indexed.historicalSessionDeletionPlan(rows, 'bad-id'), /canonical historical Session ID/);
  assert.throws(() => indexed.historicalSessionDeletionPlan(rows, '00000000-0000-4000-8000-000000000199'), /no longer exists/);
  const conflict = structuredClone(root); conflict.session.sessionId = A; conflict.fingerprint = aggregator.fingerprint(conflict);
  assert.throws(() => indexed.historicalSessionDeletionPlan(rows.concat(conflict), B), /validation|Conflicting/, 'conflicting physical provenance fails closed');

  const service = indexed.createMemoryService({}, { initializedAt: 1 });
  for (const row of rows) assert.equal((await service.append(row)).accepted, true);
  const backup = await Backup.createBackup(await service.exportCareer());
  assert.deepEqual((await service.listCareerSessions()).map(row => row.sessionId), [C, B, A]);
  const removed = await service.removeCareerHandKeys(plan.logicalHandKeys);
  assert.equal(removed.removed, true);
  assert.equal(removed.physicalRecordCount, 3);
  assert.deepEqual((await service.listCareerSessions()).map(row => row.sessionId), [C, A]);
  assert.deepEqual((await service.getCareerPlayerSessionTrend('A')).points.map(row => row.sessionId), [A, C]);
  assert.deepEqual((await service.getCareerRecentPlayerStats('A', { type: 'sessions', count: 2 })).selectedSessionIds, [C, A]);
  assert.equal((await service.getCareerRecentPlayerStats('A', { type: 'hands', count: 100 })).selectedPlayerHandCount, 2);
  assert.equal((await service.getCareerRecentVsCareer('A', { type: 'sessions', count: 2 })).career.core.counters.hands, 2);
  assert.equal((await service.careerDashboardStats('B', {})).core, null, 'player with only deleted Session loses Career');
  for (const playerId of ['A', 'B', 'C']) assert.deepEqual((await service.listCareerSessionsForPlayer(playerId)).map(row => row.sessionId),
    playerId === 'B' ? [] : [C, A]);
  const surviving = (await service.exportCareer()).records;
  assert.deepEqual(surviving.map(row => row.session.sessionId).sort(), [A, C]);
  assert.equal(surviving.some(row => row.fingerprint === root.fingerprint || row.fingerprint === tip.fingerprint), false);
  assert.deepEqual((await service.rebuildCareerStats()).players, aggregator.rebuild(surviving).aggregate.players, 'maintained Career equals fresh surviving-record rebuild');
  const validated = await Backup.validateBackup(backup);
  await service.replaceCareerRecords(validated.records, validated.careerMetadata, { backupFormatVersion: 1 });
  assert.deepEqual((await service.listCareerSessions()).map(row => row.sessionId), [C, B, A], 'Restore Replace reintroduces deleted Session');
  await service.removeCareerHandKeys(plan.logicalHandKeys);
  await service.mergeCareerRecords(validated.records, validated.careerMetadata, { mode: 'merge', backupFormatVersion: 1 });
  assert.deepEqual((await service.listCareerSessions()).map(row => row.sessionId), [C, B, A], 'Import Merge may reintroduce authoritative records');
  const timings = [];
  for (const count of [100, 500, 2500]) {
    const scale = Array.from({ length: count }, (_, index) => record('PERF-' + index, index < 3 ? B : A, 1000 + index, ['A', 'B']));
    const saved = {};
    scale.forEach(row => { saved[contribution.storageRecordKey(row.handKey, row.fingerprint)] = row; });
    const scaled = indexed.createMemoryService(saved, { initializedAt: 1, migratedAt: 2 });
    const started = process.hrtime.bigint();
    const selected = indexed.historicalSessionDeletionPlan((await scaled.exportCareer()).records, B);
    const planned = process.hrtime.bigint();
    await scaled.removeCareerHandKeys(selected.logicalHandKeys, selected.physicalFingerprints);
    const finished = process.hrtime.bigint();
    assert.equal((await scaled.careerStats('A')).counters.hands, count - 3);
    timings.push({ hands: count, planMs: Number(planned - started) / 1e6, mutationMs: Number(finished - planned) / 1e6 });
  }
  if (process.argv.includes('--browser')) {
    const browser = await queryHarness.openHarness(true);
    try {
      await browser.reset(rows, false);
      const before = await browser.call('exportCareer');
      assert.deepEqual((await browser.call('listCareerSessions')).map(row => row.sessionId), [C, B, A], 'A/B/C are persisted before native deletion');
      assert.deepEqual(before.records.map(row => row.fingerprint).sort(), rows.map(row => row.fingerprint).sort(), 'all physical versions persisted before deletion');
      const injected = await browser.run(async function (args) {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value) {
          if (this.name === 'careerAggregateCache') throw new Error('injected aggregate write failure');
          return original.apply(this, arguments);
        };
        try { await queryService.removeCareerHandKeys(args.keys, args.fingerprints); return 'unexpected success'; }
        catch (error) { return String(error.message); }
        finally { IDBObjectStore.prototype.put = original; }
      }, { keys: plan.logicalHandKeys, fingerprints: plan.physicalFingerprints });
      assert.match(injected, /injected aggregate write failure/);
      assert.deepEqual((await browser.call('exportCareer')).records, before.records, 'aborted native transaction retains physical records');
      await browser.run(async function () {
        queryService.close();
        globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, { initializedAt: 1 });
      });
      assert.deepEqual((await browser.call('exportCareer')).records, before.records, 'aborted deletion remains intact after native reopen');
      assert.deepEqual((await browser.call('listCareerSessions')).map(row => row.sessionId), [C, B, A], 'aborted reopen retains all Sessions');
      const result = await browser.call('removeCareerHandKeys', [plan.logicalHandKeys, plan.physicalFingerprints]);
      assert.equal(result.logicalHandCount, 2);
      assert.equal(result.physicalRecordCount, 3);
      await browser.run(async function () {
        queryService.close();
        globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, { initializedAt: 1 });
      });
      const reopened = (await browser.call('exportCareer')).records;
      assert.deepEqual(reopened.map(row => row.session.sessionId).sort(), [A, C], 'native reopen retains exact survivors');
      assert.deepEqual(reopened.map(row => row.fingerprint).sort(), [rows[0].fingerprint, rows[4].fingerprint].sort(), 'no superseded B version resurrects after reopen');
      assert.deepEqual((await browser.call('listCareerSessions')).map(row => row.sessionId), [C, A]);
      const warm = await browser.call('careerStats', ['A']);
      const fresh = await browser.call('rebuildCareerStats');
      assert.deepEqual(fresh.players, aggregator.rebuild(reopened).aggregate.players, 'cold native rebuild equals fresh surviving-record projection');
      assert.deepEqual(warm.counters, fresh.players.A.counters, 'warm native aggregate agrees with authoritative rebuild');
      console.log('Native IndexedDB historical deletion rollback, commit, and reopen passed in ' + browser.environment + '.');
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ historicalSessionDeletionSyntheticTimings: timings }));
  console.log('Historical Session deletion plan, all versions, global players, middle Session, derived state, and Backup reintroduction passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
