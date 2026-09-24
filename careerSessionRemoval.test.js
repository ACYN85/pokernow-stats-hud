'use strict';

var assert = require('assert');
var crypto = require('crypto').webcrypto;
var aggregator = require('./careerStatsAggregator.js');
var contribution = require('./careerContributionStore.js');
var indexed = require('./careerIndexedStore.js');
var backup = require('./careerBackup.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var queryHarness = require('./testSupport/careerDashboardQueryHarness.js');

function supportedPlayer(id, name, counters) {
  var value = fixtures.player(id, name, counters || {});
  value.position = { schemaVersion: 1, status: 'supported', dealtPosition: 'BTN', dealtPlayerCount: 3, unsupportedReason: null };
  return value;
}
function hand(game, id, players, at, aliases, semanticVersions, predecessor) {
  var value = fixtures.record(game, id, players, { finalizedAt: at, semanticVersions: semanticVersions, supersedesFingerprint: predecessor });
  value.lifecycleHandIds = aliases || value.lifecycleHandIds;
  value.fingerprint = aggregator.fingerprint(value);
  assert.strictEqual(aggregator.validateRecord(value), null);
  return value;
}
function saved(records) {
  var ordered = (records || []).slice().sort(function (left, right) { return left.finalizedAt - right.finalizedAt || left.handKey.localeCompare(right.handKey); });
  var initial = {};
  initial[contribution.META_KEY] = { schemaVersion: 1, careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'test', firstAcceptedHandKey: ordered[0] && ordered[0].handKey || null, firstAcceptedAt: ordered[0] && ordered[0].finalizedAt || null, latestAcceptedAt: ordered.length ? ordered[ordered.length - 1].finalizedAt : null };
  return ordered.reduce(function (result, record) { result[contribution.storageRecordKey(record.handKey, record.fingerprint)] = record; return result; }, initial);
}
function request(ids, game) {
  return { namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: game || 'CURRENT' }, sessionHandIds: ids };
}

(async function () {
  var older = hand('CURRENT', 'OLDER', [supportedPlayer('stable-a', 'Alex'), supportedPlayer('unrelated', 'Unrelated')], 10);
  var otherRoomSameId = hand('OTHER', 'SESSION-1', [supportedPlayer('other-room', 'Alex')], 11, ['session-life-1']);
  var sessionOne = hand('CURRENT', 'SESSION-1', [supportedPlayer('stable-a', 'Alex', {
    vpipMade: 1, pfrMade: 1, postflopAggressiveActions: 2, postflopCalls: 1,
    threeBetMade: 1, threeBetOpportunities: 1, foldToThreeBet: 1, foldToThreeBetOpportunities: 1,
    flopCBetMade: 1, flopCBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1,
    wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1
  }), supportedPlayer('stable-b', 'Alex')], 20, ['session-life-1']);
  var sessionTwoRoot = hand('CURRENT', 'SESSION-2', [supportedPlayer('stable-a', 'Alex'), supportedPlayer('stable-c', 'Cara')], 30, ['session-life-2'], { preflop: 1 });
  var sessionTwoTip = hand('CURRENT', 'SESSION-2', [supportedPlayer('stable-a', 'Alex', { pfrMade: 1 }), supportedPlayer('stable-c', 'Cara')], 31, ['session-life-2'], { preflop: 2 }, sessionTwoRoot.fingerprint);
  var sessionThree = hand('CURRENT', 'SESSION-3', [supportedPlayer('session-only', 'Only Here')], 40, ['session-life-3']);
  var records = [older, otherRoomSameId, sessionOne, sessionTwoRoot, sessionTwoTip, sessionThree];

  var exact = indexed.sessionRemovalPlan(records, request(['session-life-1', 'SESSION-2', 'session-life-3']));
  assert.deepStrictEqual(exact.logicalHandKeys, [sessionOne.handKey, sessionTwoRoot.handKey, sessionThree.handKey].sort(), 'authoritative and lifecycle aliases map to exact room-owned logical hands');
  assert.strictEqual(exact.logicalHandCount, 3);
  assert.strictEqual(exact.physicalRecordCount, 4, 'all physical versions of each shared logical hand are selected');
  assert.deepStrictEqual(exact.affectedPlayerIds, ['session-only', 'stable-a', 'stable-b', 'stable-c']);
  assert.ok(!exact.physicalFingerprints.includes(otherRoomSameId.fingerprint), 'same alias in another room is isolated');

  var withMissing = indexed.sessionRemovalPlan(records, request(['SESSION-1', 'not-recorded']));
  assert.deepStrictEqual(withMissing.matchedSessionHandIds, ['SESSION-1']);
  assert.deepStrictEqual(withMissing.unmatchedSessionHandIds, ['not-recorded'], 'a finalized Session hand absent from Career is reported without a heuristic match');

  var ambiguousA = hand('CURRENT', 'AMB-A', [supportedPlayer('a', 'A')], 50, ['reused-lifecycle']);
  var ambiguousB = hand('CURRENT', 'AMB-B', [supportedPlayer('b', 'B')], 51, ['reused-lifecycle']);
  assert.throws(function () { indexed.sessionRemovalPlan(records.concat([ambiguousA, ambiguousB]), request(['reused-lifecycle'])); }, /ambiguous/, 'ambiguous aliases fail closed');
  assert.throws(function () { indexed.sessionRemovalPlan(records, request(['bad\nhand'])); }, /malformed/, 'malformed Session provenance fails closed');

  var quarantineA = hand('OTHER', 'QUARANTINE', [supportedPlayer('quarantine', 'Q')], 60);
  var quarantineB = structuredClone(quarantineA); quarantineB.players[0].counters.vpipMade = 1; quarantineB.fingerprint = aggregator.fingerprint(quarantineB);
  var wrappers = records.concat([quarantineA, quarantineB]).map(function (record, index) { return indexed.recordWrapper(record, index + 1); });
  var projection = indexed.affectedProjectionPlan(wrappers, { nextSequence: wrappers.length }, exact.logicalHandKeys);
  assert.deepStrictEqual(projection.resolved.quarantinedHandKeys, [quarantineA.handKey], 'unrelated quarantined history stays quarantined and is never resurrected');
  assert.ok(projection.retained.some(function (wrapper) { return wrapper.record.fingerprint === quarantineB.fingerprint; }));

  var service = indexed.createMemoryService(saved(records), { initializedAt: 1, migratedAt: 2, buildId: 'v1.2-removal-test' });
  var beforeDashboard = await service.careerDashboardStats('stable-a', {});
  var beforeTrends = await service.careerTrendStats('stable-a');
  var beforeHud = await service.careerHudStats(['stable-a', 'stable-b', 'unrelated']);
  assert.deepStrictEqual([beforeDashboard.core.counters.hands, beforeTrends.totalCareerHands, beforeHud.players['stable-b'].counters.hands], [3, 3, 1]);
  assert.deepStrictEqual(beforeDashboard.core.derived, { vpip: 33.3, pfr: 66.7, af: 2, threeBet: 100, foldToThreeBet: 100, flopCBet: 100, foldToFlopCBet: 100, wtsd: 100, wsd: 100 }, 'every published Career statistic includes the removable hand before deletion');

  var removal = await service.removeCareerHandKeys(exact.logicalHandKeys);
  assert.strictEqual(removal.removed, true);
  assert.deepStrictEqual([removal.logicalHandCount, removal.physicalRecordCount], [3, 4]);
  var retained = await service.careerStats('stable-a');
  assert.deepStrictEqual(retained.counters, Object.assign(aggregator.emptyCounters(), { hands: 1, vpipOpportunities: 1, pfrOpportunities: 1 }), 'Hands, VPIP, PFR, AF, 3Bet, F3B, c-bet, FCB, WTSD and WSD contributions are all removed exactly');
  assert.deepStrictEqual(retained.derived, { vpip: 0, pfr: 0, af: 0, threeBet: null, foldToThreeBet: null, flopCBet: null, foldToFlopCBet: null, wtsd: null, wsd: null }, 'derived percentages and AF rebuild from retained history only');
  assert.strictEqual(await service.careerStats('stable-b'), null, 'player with only removed history has no active Career aggregate');
  assert.strictEqual((await service.careerStats('unrelated')).counters.hands, 1, 'unrelated shared-hand player remains unchanged');
  assert.strictEqual((await service.careerStats('other-room')).counters.hands, 1, 'cross-room stable identity remains isolated');
  assert.strictEqual((await service.careerDashboardStats('stable-a', {})).core.counters.hands, 1, 'Dashboard cache rebuild reflects deletion');
  assert.strictEqual((await service.careerTrendStats('stable-a')).totalCareerHands, 1, 'Trends cache rebuild reflects deletion');
  assert.strictEqual((await service.careerHudStats(['stable-a', 'stable-b'])).players['stable-b'], null, 'Career Seat HUD/Leaderboard batch reflects zero history');
  assert.strictEqual((await service.careerDashboardStats('stable-a', {})).profileStats.counters.hands, 1, 'Career profile projection reflects retained history');
  assert.strictEqual((await service.careerStatsFiltered('stable-a', { position: 'BTN' })).counters.hands, 1, 'Dashboard position projection reflects deletion without changing filter semantics');
  var summaries = await service.careerPlayerSummaries();
  assert.ok(!summaries.some(function (row) { return row.playerId === 'session-only' || row.playerId === 'stable-b' || row.playerId === 'stable-c'; }), 'zero-history players disappear under established active-Career summary semantics');
  assert.ok(summaries.some(function (row) { return row.playerId === 'stable-a' && row.hands === 1; }));
  assert.strictEqual((await service.removeCareerHandKeys(exact.logicalHandKeys)).removed, false, 'repeated deletion is an explicit idempotent no-op');

  var originalBackup = await backup.createBackup(await indexed.createMemoryService(saved(records)).exportCareer(), crypto);
  var validated = await backup.validateBackup(originalBackup, crypto);
  await service.replaceCareerRecords(validated.records, validated.careerMetadata, { backupFormatVersion: validated.summary.backupFormatVersion, payloadDigest: validated.summary.payloadDigest, restoredAt: 100 });
  assert.strictEqual((await service.careerStats('stable-a')).counters.hands, 3, 'existing verified SAFE REPLACE restore returns Career to its pre-removal state');

  var quarantinedDigest = await backup.digestCareerExport(indexed.serializableExport({ schemaVersion: 2 }, [quarantineA, quarantineB]), crypto);
  assert.match(quarantinedDigest, /^[a-f0-9]{64}$/, 'removal confirmation binds the current raw Career snapshot even when formal backup export correctly rejects quarantine');

  var timings = [];
  for (var count of [100, 1000, 5000]) {
    var synthetic = Array.from({ length: count }, function (_unused, index) {
      return hand('PERF-' + count, 'H-' + index, [supportedPlayer('subject', 'Subject'), supportedPlayer('villain-' + index, 'Villain')], 1000 + index);
    });
    var perfService = indexed.createMemoryService(saved(synthetic), { initializedAt: 1, migratedAt: 2 });
    var perfRequest = request(synthetic.slice(-3).map(function (record) { return record.authoritativeHandId; }), 'PERF-' + count);
    var started = process.hrtime.bigint(); var perfPlan = indexed.sessionRemovalPlan((await perfService.exportCareer()).records, perfRequest);
    var plannedAt = process.hrtime.bigint(); await perfService.removeCareerHandKeys(perfPlan.logicalHandKeys); var ended = process.hrtime.bigint();
    assert.strictEqual((await perfService.careerStats('subject')).counters.hands, count - 3);
    timings.push({ hands: count, planMs: Number(plannedAt - started) / 1e6, mutationMs: Number(ended - plannedAt) / 1e6 });
  }
  if (process.argv.includes('--browser')) {
    var browserHarness = await queryHarness.openHarness(true);
    try {
      await browserHarness.reset(records, false);
      var browserRemoval = await browserHarness.call('removeCareerHandKeys', [exact.logicalHandKeys]);
      assert.deepStrictEqual([browserRemoval.logicalHandCount, browserRemoval.physicalRecordCount], [3, 4]);
      assert.strictEqual((await browserHarness.call('careerStats', ['stable-a'])).counters.hands, 1);
      assert.strictEqual(await browserHarness.call('careerStats', ['stable-b']), null);
      assert.strictEqual((await browserHarness.call('careerTrendStats', ['stable-a'])).totalCareerHands, 1);
      assert.strictEqual((await browserHarness.call('careerPlayerSummaries')).some(function (row) { return row.playerId === 'session-only'; }), false);
      console.log('Native IndexedDB removal transaction passed in ' + browserHarness.environment + '.');
    } finally { await browserHarness.close(); }
  }
  console.log(JSON.stringify({ careerSessionRemovalSyntheticTimings: timings }, null, 2));
  console.log('Exact current-Session Career removal, shared players, supersession, quarantine, identity isolation, derived consumers, idempotence, backup restore, and performance tests passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
