'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const indexed = require('./careerIndexedStore.js');
const fixtures = require('./testSupport/careerBackupFixtures.js');
const Backup = require('./careerBackup.js');
const policy = require('./careerBackupPolicy.js');

const S = '00000000-0000-4000-8000-000000000211';
const T = '00000000-0000-4000-8000-000000000212';
function hand(id, sessionId, at) { return fixtures.record('DELETE-WORKER', id,
  [fixtures.player('A', 'Alice'), fixtures.player('B', 'Bob')], { historicalSessionId: sessionId, finalizedAt: at }); }

(async () => {
  const service = indexed.createMemoryService({}, { initializedAt: 1 });
  await service.append(hand('S-1', S, 100));
  await service.append(hand('T-1', T, 200));
  let failNextRemoval = false;
  const serviceProxy = Object.create(service);
  serviceProxy.removeCareerHandKeys = function (keys, fingerprints) {
    if (failNextRemoval) { failNextRemoval = false; return Promise.reject(new Error('injected transaction failure')); }
    return service.removeCareerHandKeys(keys, fingerprints);
  };
  let listener;
  const metaKey = 'pokerNowHudSessionMeta:game:' + encodeURIComponent('pokernow.com:DELETE-WORKER');
  let liveSessionId = T;
  let metadataAvailable = true;
  const worker = {
    importScripts() {}, indexedDB: {}, crypto: require('node:crypto').webcrypto,
    PokerCareerIndexedStore: Object.assign({}, indexed, { hasCompleteDatabase: async () => true, outboxRecords: () => [], createIndexedService: async () => serviceProxy }),
    PokerCareerBackup: Backup, PokerCareerBackupPolicy: policy,
    chrome: { storage: { local: { get: async () => metadataAvailable ? { [metaKey]: { gameId: 'DELETE-WORKER', sessionKey: 'pokernow.com:DELETE-WORKER', historicalSessionId: liveSessionId } } : {}, getKeys: async () => [], set: async () => {}, remove: async () => {} } },
      runtime: { onMessage: { addListener(value) { listener = value; } }, getManifest: () => ({ version: '1.4.0' }) } },
    console, Date, Promise, Object, Array, String, Error
  };
  worker.globalThis = worker;
  vm.runInNewContext(fs.readFileSync('./careerServiceWorker.js', 'utf8'), worker, { filename: 'careerServiceWorker.js' });
  async function call(method, args) {
    return new Promise(resolve => listener({ type: indexed.MESSAGE_TYPE, method, args: args || [] }, {}, resolve));
  }
  const preview = await call('prepareCareerHistoricalSessionDeletion', [S]);
  assert.equal(preview.ok, true);
  assert.equal(preview.value.sessionId, S);
  assert.equal(preview.value.logicalHandCount, 1);
  assert.equal(preview.value.physicalRecordCount, 1);
  assert.equal(preview.value.affectedPlayerCount, 2);
  assert.equal(preview.value.isCurrentCanonicalSession, false);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.value.affectedPlayers.map(row => [row.playerId, row.handCount]))), [['A', 1], ['B', 1]]);
  assert.equal(Object.hasOwn(preview.value, 'records'), false);
  const confirmation = { mode: 'delete-historical-session', confirmed: true,
    expectedCurrentDigest: preview.value.currentDigest, expectedConfirmationToken: preview.value.confirmationToken,
    currentSessionId: T };
  assert.equal((await call('deleteCareerHistoricalSession', [S, {}])).ok, false, 'no mutation without confirmation');
  liveSessionId = S;
  const currentPreview = await call('prepareCareerHistoricalSessionDeletion', [S, T]);
  assert.equal(currentPreview.value.blocked, true, 'worker preview reads persisted live identity, not caller hint');
  assert.equal((await call('deleteCareerHistoricalSession', [S, { ...confirmation, currentSessionId: T }])).ok, false, 'forged current Session hint cannot delete live Session');
  assert.equal((await call('deleteCareerHistoricalSession', [S, { ...confirmation, currentSessionId: null }])).ok, false, 'omitted current Session hint cannot delete live Session');
  liveSessionId = T;
  metadataAvailable = false;
  assert.equal((await call('deleteCareerHistoricalSession', [S, confirmation])).ok, false, 'missing trusted Session metadata fails closed');
  metadataAvailable = true;
  assert.equal((await service.listCareerSessions()).length, 2);
  await service.append(hand('T-2', T, 201));
  assert.equal((await call('deleteCareerHistoricalSession', [S, confirmation])).ok, false, 'changed Career digest rejects stale preview');
  const refreshed = (await call('prepareCareerHistoricalSessionDeletion', [S])).value;
  const freshConfirmation = { ...confirmation, expectedCurrentDigest: refreshed.currentDigest, expectedConfirmationToken: refreshed.confirmationToken };
  failNextRemoval = true;
  assert.equal((await call('deleteCareerHistoricalSession', [S, freshConfirmation])).ok, false, 'transaction failure rejects');
  assert.equal((await service.listCareerSessions()).length, 2, 'failure leaves Session authoritative');
  const result = await call('deleteCareerHistoricalSession', [S, freshConfirmation]);
  assert.equal(result.ok, true);
  assert.equal(result.value.deleted, true);
  assert.equal(result.value.sessionId, S);
  assert.equal(result.value.deletedLogicalHands, 1);
  assert.equal(result.value.deletedPhysicalRecords, 1);
  assert.equal(typeof result.value.mutationRevision, 'string');
  assert.deepEqual((await service.listCareerSessions()).map(row => row.sessionId), [T]);
  assert.equal((await call('prepareCareerHistoricalSessionDeletion', [S, T])).ok, false, 'deleted Session has no new preview');
  assert.equal((await call('prepareCareerHistoricalSessionDeletion', ['bad', T])).ok, false, 'invalid ID fails at worker boundary');
  console.log('Historical Session deletion worker preview, digest confirmation, current guard, rollback, and result contract passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
