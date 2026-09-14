'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var phaseOne = require('./careerContributionStore.js');
var indexed = require('./careerIndexedStore.js');

function player(id, name, hands) { return { playerId: id, displayName: name, counters: Object.assign(aggregator.emptyCounters(), { hands: hands, vpipMade: hands, vpipOpportunities: hands }), decisions: {} }; }
function record(game, hand, entries, versions, predecessor, at) {
  var value = { schemaVersion: 1, recordType: 'certified-career-hand', handKey: 'pokernow|pokernow.com|' + game + '|' + hand, namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: game }, authoritativeHandId: hand, lifecycleHandIds: [], finalizedAt: at || 1, semanticVersions: versions || { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 }, players: entries, supersedesFingerprint: predecessor || null };
  value.fingerprint = aggregator.fingerprint(value); return value;
}
var a = record('G1', 'H1', [player('P1', 'Alice', 1), player('P2', 'Bob', 1)], null, null, 10);
var h2 = record('G2', 'H2', [player('P1', 'Alice2', 1), player('P3', 'Cara', 1)], null, null, 20);
var saved = {};
saved[phaseOne.META_KEY] = { schemaVersion: 1, careerTrackingStartedAt: 50, careerSchemaInitializedAt: 51, firstAcceptedHandKey: a.handKey, firstAcceptedAt: 10 };
saved[phaseOne.storageRecordKey(a.handKey, a.fingerprint)] = a;

(async function () {
  var service = indexed.createMemoryService(saved, { initializedAt: 999, migratedAt: 1000, buildId: 'phase2-test' });
  var info = await service.careerLedgerInfo();
  assert.strictEqual(info.careerTrackingStartedAt, 50, 'migration preserves the Phase 1 career boundary');
  assert.strictEqual(info.careerSchemaInitializedAt, 51);
  assert.strictEqual(info.migration.state, 'complete');
  assert.strictEqual(info.physicalRecordCount, 1);
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 1);
  assert.deepStrictEqual((await service.rebuildCareerStats()), aggregator.rebuild([a]).aggregate, 'structural migration preserves the exact aggregate');
  assert.deepStrictEqual(saved[phaseOne.storageRecordKey(a.handKey, a.fingerprint)], a, 'migration never mutates or deletes the old authoritative record');

  var retried = indexed.createMemoryService(saved, { initializedAt: 999, migratedAt: 1001 });
  assert.deepStrictEqual(await retried.rebuildCareerStats(), await service.rebuildCareerStats(), 'migration retry is idempotent');
  assert.strictEqual((await retried.careerLedgerInfo()).careerTrackingStartedAt, 50);

  var interruptedSaved = Object.assign({}, saved); interruptedSaved[indexed.outboxKey(h2)] = h2;
  var interrupted = indexed.createMemoryService(interruptedSaved, { initializedAt: 999, migratedAt: 1002 });
  var pending = indexed.outboxRecords(interruptedSaved);
  assert.deepStrictEqual(pending.map(function (entry) { return entry.record.fingerprint; }), [h2.fingerprint]);
  assert.strictEqual((await interrupted.append(pending[0].record)).accepted, true, 'reload replays a durable pending outbox record after an interrupted append');
  assert.strictEqual((await interrupted.append(pending[0].record)).duplicate, true, 'retry after commit is idempotent');
  assert.strictEqual((await interrupted.careerStats('P1')).counters.hands, 2);

  assert.strictEqual((await service.append(h2)).accepted, true);
  assert.strictEqual((await service.append(h2)).duplicate, true);
  assert.deepStrictEqual((await service.careerStats('P1')).counters.hands, 2);
  assert.strictEqual((await service.careerStatsFiltered('P1', {})).counters.hands, 2, 'filtered queries reuse the one-player record selection and exact deltas');
  assert.strictEqual((await service.careerStats('P3')).counters.hands, 1);
  var p1Info = await service.careerPlayerRecordInfo('P1');
  assert.deepStrictEqual([p1Info.physicalRecordCount, p1Info.activeRecordCount], [2, 2], 'one-player lookup uses the player index shape');

  var p2Cache = service.testHooks.caches.get('P2');
  service.testHooks.caches.delete('P1');
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 2, 'missing player cache rebuilds from indexed immutable records');
  service.testHooks.caches.get('P1').revision = -1;
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 2, 'stale cache revision rebuilds');
  service.testHooks.caches.set('P1', { playerId: 'P1', revision: service.testHooks.heads.get('P1').revision, player: { counters: {} } });
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 2, 'malformed cache rebuilds');
  assert.strictEqual(service.testHooks.caches.get('P2'), p2Cache, 'append and recovery do not rewrite unaffected-player caches');

  var corrected = record('G1', 'H1', [player('P1', 'Alice', 2), player('P2', 'Bob', 2)], { core: 1, preflop: 3, flopCBet: 1, showdown: 1, sourceLedger: 1 }, a.fingerprint, 10);
  assert.strictEqual((await service.append(corrected)).accepted, true);
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 3, 'active corrected H1 plus H2 count without old+new double counting');
  assert.deepStrictEqual((await service.rebuildCareerStats()), aggregator.rebuild([a, corrected, h2]).aggregate);

  var samePlayerTwoTablesA = record('TABLE-A', 'HA', [player('PX', 'X', 1)], null, null, 30);
  var samePlayerTwoTablesB = record('TABLE-B', 'HB', [player('PX', 'X', 1)], null, null, 31);
  var concurrent = await Promise.all([service.append(samePlayerTwoTablesA), service.append(samePlayerTwoTablesB)]);
  assert.ok(concurrent.every(function (value) { return value.accepted; }), 'serialized concurrent table appends both commit');
  assert.strictEqual((await service.careerStats('PX')).counters.hands, 2, 'same-player multi-table cache has no lost update');

  var exported = await service.exportCareer();
  assert.strictEqual(exported.records.length, 5);
  assert.deepStrictEqual(exported.records.map(function (value) { return value.handKey + '|' + value.fingerprint; }), exported.records.map(function (value) { return value.handKey + '|' + value.fingerprint; }).slice().sort(), 'export enumeration is canonical');
  assert.strictEqual(exported.metadata.careerTrackingStartedAt, 50);

  var corruptSaved = {}; var corrupt = JSON.parse(JSON.stringify(a)); corrupt.schemaVersion = 999; corruptSaved[phaseOne.storageRecordKey(a.handKey, a.fingerprint)] = corrupt;
  var blocked = indexed.createMemoryService(corruptSaved, { initializedAt: 1 });
  assert.strictEqual((await blocked.careerLedgerInfo()).ready, false, 'malformed migration blocks conservatively');
  assert.strictEqual((await blocked.append(h2)).migrationBlocked, true);
  assert.ok(corruptSaved[phaseOne.storageRecordKey(a.handKey, a.fingerprint)], 'failed migration leaves Phase 1 source intact for retry/recovery');

  var baseBytes = Buffer.byteLength(phaseOne.storageRecordKey(a.handKey, a.fingerprint)) + Buffer.byteLength(JSON.stringify(a));
  var indexedBytes = Buffer.byteLength(JSON.stringify(indexed.recordWrapper(a, 1)));
  assert.ok(indexedBytes < baseBytes + 100, 'minimal index envelope avoids broad semantic-field duplication');

  var messages = [];
  var runtime = {
    lastError: null,
    sendMessage: function (message, callback) {
      messages.push(message);
      callback({ ok: true, value: message.method === 'careerStats' ? { playerId: message.args[0] } : { method: message.method } });
    }
  };
  var proxy = indexed.createMessageService(runtime);
  assert.strictEqual((await proxy.initialize()).method, 'initialize');
  assert.strictEqual((await proxy.append(h2)).method, 'append');
  assert.strictEqual((await proxy.careerStats('P1')).playerId, 'P1');
  assert.strictEqual((await proxy.careerStatsFiltered('P1', { position: 'BB' })).method, 'careerStatsFiltered');
  assert.strictEqual((await proxy.careerDashboardStats('P1', { position: 'BTN' })).method, 'careerDashboardStats');
  assert.strictEqual((await proxy.careerPlayerSummaries()).method, 'careerPlayerSummaries');
  assert.ok(messages.every(function (message) { return message.type === indexed.MESSAGE_TYPE; }), 'content proxy uses only the dedicated extension message contract');
  assert.deepStrictEqual(messages.map(function (message) { return message.method; }), ['initialize', 'append', 'careerStats', 'careerStatsFiltered', 'careerDashboardStats', 'careerPlayerSummaries']);
  console.log('Career IndexedDB model migration, boundary, indexed query, cache recovery, concurrency, supersession, export, and failure tests passed: ' + JSON.stringify({ phase1ItemBytes: baseBytes, indexedEnvelopeBytes: indexedBytes }));
})().catch(function (error) { console.error(error); process.exit(1); });
