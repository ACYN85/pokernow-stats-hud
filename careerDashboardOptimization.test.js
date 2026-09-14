'use strict';

var assert = require('assert');
var indexed = require('./careerIndexedStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var aggregator = require('./careerStatsAggregator.js');
var filtered = require('./filteredStats.js');
var queryHarness = require('./testSupport/careerDashboardQueryHarness.js');
var dashboard = require('./playerDashboard.js');

function equivalent(result, records, playerId, filters) {
  var selected = records.filter(function (record) { return record.players.some(function (entry) { return entry.playerId === playerId; }); });
  var scope = { position: filters.position || null, situation: filters.situation || null };
  assert.deepStrictEqual(result.core, !selected.length && !scope.position && !scope.situation ? null : filtered.careerStatsFiltered(selected, playerId, scope));
  var relational = {};
  if (filters.opponentMode !== 'overall') ['threeBet', 'foldToThreeBet', 'foldToFlopCBet'].forEach(function (statId) {
    relational[statId] = filtered.careerStatsFiltered(selected, playerId, { position: scope.position, situation: scope.situation, statId: statId, counterpartMode: filters.opponentMode, selfPlayerId: filters.selfPlayerId });
  });
  assert.deepStrictEqual(result.relational, relational, 'all relational counters, derived values, filters and coverage match independent queries');
}

async function backendChecks(browserMode) {
  var driver = await queryHarness.openHarness(browserMode);
  try {
    var records = queryHarness.scaleRecords(6);
    records[0].schemaVersion = 1; records[0].players.forEach(function (entry) { delete entry.position; delete entry.relational; });
    records[1].schemaVersion = 2; records[1].players.forEach(function (entry) { delete entry.position; });
    records[2].players[0].relational.threeBetTargetPlayerId = null;
    records.forEach(function (record) { record.fingerprint = aggregator.fingerprint(record); assert.strictEqual(aggregator.validateRecord(record), null); });
    for (var cold of [true, false]) {
      for (var position of [null, 'SB', 'BB', 'unsupported']) {
        for (var mode of ['overall', 'self', 'others']) {
          await driver.reset(records, cold);
          var filters = { position: position, opponentMode: mode, selfPlayerId: 'me' };
          var sample = await driver.sample('subject', filters);
          equivalent(sample.result, records, 'subject', filters);
          var expected = (cold ? 1 : 0) + (position || mode !== 'overall' ? 1 : 0);
          assert.strictEqual(sample.passes, expected, 'aggregate remains separate; all filters share one resolution');
          assert.strictEqual(sample.records, expected * records.length);
          assert.strictEqual(sample.result.query.aggregateCacheUsed, !cold);
          assert.strictEqual(sample.result.query.playerRecordRetrievals, cold || position || mode !== 'overall' ? 1 : 0);
          var hit = await driver.sample('subject', filters);
          assert.strictEqual(hit.passes, 0); assert.strictEqual(hit.records, 0);
          assert.strictEqual(hit.result.query.dashboardCacheHit, true);
          assert.strictEqual(hit.result.query.playerRecordRetrievals, 0);
          assert.deepStrictEqual(hit.result.core, sample.result.core); assert.deepStrictEqual(hit.result.relational, sample.result.relational);
        }
      }
    }
    await driver.reset(records, false);
    var overallSample = await driver.sample('subject', { situation: 'overall', opponentMode: 'overall', selfPlayerId: 'me' });
    assert.strictEqual(overallSample.result.query.playerRecordRetrievals, 0, 'warm Overall uses the aggregate cache without history retrieval');
    var overallProfile = overallSample.result.profileStats;
    for (var situation of ['ip', 'oop']) {
      var situationRequest = { situation: situation, opponentMode: 'overall', selfPlayerId: 'me' };
      var situationSample = await driver.sample('subject', situationRequest);
      equivalent(situationSample.result, records, 'subject', situationRequest);
      assert.strictEqual(situationSample.passes, 1, 'each new situation resolves player history once');
      assert.strictEqual(situationSample.result.query.playerRecordRetrievals, 1);
      assert.deepStrictEqual(situationSample.result.profileStats, overallProfile, 'situation filters do not change the all-hand cached profile projection');
      var situationHit = await driver.sample('subject', situationRequest);
      assert.strictEqual(situationHit.passes, 0); assert.strictEqual(situationHit.result.query.dashboardCacheHit, true);
    }
    var composedSituation = { situation: 'ip', opponentMode: 'others', selfPlayerId: 'me' };
    var composedSample = await driver.sample('subject', composedSituation);
    equivalent(composedSample.result, records, 'subject', composedSituation);
    assert.strictEqual(composedSample.passes, 1, 'situation and three relational views share one resolution');
    assert.strictEqual(composedSample.result.query.playerRecordRetrievals, 1);
    var request = { position: 'SB', opponentMode: 'self', selfPlayerId: 'me' };
    await driver.reset(records, false);
    var initial = await driver.sample('subject', request);
    var unrelated = fixtures.record('OTHER', 'unrelated', [fixtures.player('unrelated', 'Unrelated')]);
    assert.strictEqual((await driver.call('append', [unrelated])).accepted, true);
    var unchanged = await driver.sample('subject', request);
    assert.strictEqual(unchanged.result.query.playerRevision, initial.result.query.playerRevision);
    assert.strictEqual(unchanged.result.query.dashboardCacheHit, true); assert.strictEqual(unchanged.passes, 0);
    var appended = queryHarness.scaleRecords(7)[6];
    assert.strictEqual((await driver.call('append', [appended])).accepted, true);
    records.push(appended);
    var changed = await driver.sample('subject', request);
    assert.ok(changed.result.query.playerRevision > initial.result.query.playerRevision);
    assert.strictEqual(changed.result.query.dashboardCacheHit, false); assert.strictEqual(changed.passes, 2);
    equivalent(changed.result, records, 'subject', request);
    assert.strictEqual((await driver.call('append', [appended])).duplicate, true);
    assert.strictEqual((await driver.sample('subject', request)).passes, 0, 'duplicate append leaves revision/cache intact');

    // Mutate actual backend return objects before they cross the test driver boundary.
    await driver.run(async function (request) {
      var first = await queryService.careerDashboardStats('subject', request);
      first.core.counters.hands = -99; first.core.coverage.totalCareerHands = -99; first.core.filters.position = 'wrong'; first.core.derived.af = -99;
      first.relational.threeBet.counters.threeBetMade = -99;
    }, request);
    equivalent((await driver.sample('subject', request)).result, records, 'subject', request);

    // Replacement deliberately has the SAME head revision and different counters.
    await driver.reset(records, false);
    var beforeRestore = await driver.sample('subject', request);
    var replacement = structuredClone(records);
    replacement[4].players[0].counters.vpipMade = 1;
    replacement[4].fingerprint = aggregator.fingerprint(replacement[4]);
    var metadata = await driver.call('careerLedgerInfo');
    await driver.call('replaceCareerRecords', [replacement, metadata, { restoredAt: 5000 }]);
    var restored = await driver.sample('subject', request);
    assert.strictEqual(restored.result.query.playerRevision, beforeRestore.result.query.playerRevision);
    assert.strictEqual(restored.result.query.dashboardCacheHit, false); assert.strictEqual(restored.passes, 1);
    equivalent(restored.result, replacement, 'subject', request);
    assert.notDeepStrictEqual(restored.result.core.counters, beforeRestore.result.core.counters);

    var requests = [request, { position: 'BB', opponentMode: 'others', selfPlayerId: 'me' }, { position: null, opponentMode: 'overall', selfPlayerId: 'me' }];
    var concurrent = await driver.run(function (requests) { return Promise.all(requests.map(function (filters) { return queryService.careerDashboardStats('subject', filters); })); }, requests);
    concurrent.forEach(function (result, index) { equivalent(result, replacement, 'subject', requests[index]); });
    var oldSnapshot = Object.assign({ open: true, playerId: 'subject', mode: 'career', requestToken: 1 }, request);
    var newSnapshot = Object.assign({}, oldSnapshot, requests[1], { requestToken: 2 });
    var displayed;
    var releaseOld;
    var oldGate = new Promise(function (resolve) { releaseOld = resolve; });
    function receive(snapshot, result) { if (dashboard.requestMatches(newSnapshot, snapshot)) displayed = result; }
    var older = driver.call('careerDashboardStats', ['subject', request]).then(async function (result) { await oldGate; receive(oldSnapshot, result); });
    var newer = await driver.call('careerDashboardStats', ['subject', requests[1]]);
    receive(newSnapshot, newer); releaseOld(); await older;
    assert.deepStrictEqual(displayed, newer, 'a delayed older Dashboard response cannot overwrite the newer filter request');
    await assert.rejects(driver.call('careerDashboardStats', ['subject', { position: 'SB', opponentMode: 'self' }]), /canonical selfPlayerId/);
    equivalent((await driver.sample('subject', request)).result, replacement, 'subject', request);

    for (var missingPosition of [null, 'SB']) {
      var missingRequest = { position: missingPosition, opponentMode: 'self', selfPlayerId: 'me' };
      equivalent((await driver.sample('missing', missingRequest)).result, records, 'missing', missingRequest);
      await driver.reset([], false);
      equivalent((await driver.sample('subject', missingRequest)).result, [], 'subject', missingRequest);
    }
    var historical = fixtures.complexRecords();
    await driver.reset(historical, true);
    equivalent((await driver.sample('stable-alice', request)).result, historical, 'stable-alice', request);
    console.log('Career Dashboard complete equivalence, pass counts, single retrieval, append/restore revisions, cache isolation and concurrent filters passed: ' + driver.environment);
  } finally { await driver.close(); }
}

(async function () {
  var service = indexed.createMemoryService({}, { initializedAt: 1, migratedAt: 2, buildId: 'career-dashboard-optimization-test' });
  var records = fixtures.complexRecords();
  for (var index = 0; index < records.length; index += 1) {
    var appended = await service.append(records[index]);
    assert.ok(appended.accepted || appended.duplicate, appended.reason);
  }

  await service.careerStats('stable-alice');
  var overall = await service.careerDashboardStats('stable-alice', { position: null, opponentMode: 'overall', selfPlayerId: 'stable-bob' });
  assert.strictEqual(overall.query.aggregateCacheUsed, true, 'unfiltered Career dashboard uses the existing authoritative aggregate cache');
  assert.strictEqual(overall.query.playerRecordRetrievals, 0, 'unfiltered aggregate hit performs no player-record getAll');
  assert.deepStrictEqual(overall.core.counters, (await service.careerStats('stable-alice')).counters);

  var relational = await service.careerDashboardStats('stable-alice', { position: null, opponentMode: 'self', selfPlayerId: 'stable-bob' });
  assert.strictEqual(relational.query.playerRecordRetrievals, 1, 'three relational views share one player-record retrieval');
  assert.deepStrictEqual(Object.keys(relational.relational).sort(), ['foldToFlopCBet', 'foldToThreeBet', 'threeBet']);
  var second = await service.careerDashboardStats('stable-alice', { position: null, opponentMode: 'self', selfPlayerId: 'stable-bob' });
  assert.strictEqual(second.query.dashboardCacheHit, true, 'identical player-head revision and filters reuse the short-lived dashboard result');
  assert.strictEqual(second.query.playerRecordRetrievals, 0);
  assert.deepStrictEqual(second.core, relational.core);
  assert.deepStrictEqual(second.relational, relational.relational);

  var extra = fixtures.record('TABLE-Z', 'CACHE-INVALIDATION', [fixtures.player('stable-alice', 'Alicia', { vpipMade: 1 }), fixtures.player('stable-bob', 'Bob')], { finalizedAt: 9000 });
  assert.strictEqual((await service.append(extra)).accepted, true);
  var afterAppend = await service.careerDashboardStats('stable-alice', { position: null, opponentMode: 'self', selfPlayerId: 'stable-bob' });
  assert.strictEqual(afterAppend.query.dashboardCacheHit, false, 'append affecting the player invalidates the read-through cache');
  assert.strictEqual(afterAppend.query.playerRecordRetrievals, 1);

  await backendChecks(process.argv.includes('--browser'));
  console.log('Career aggregate-cache, one-retrieval relational query, revision cache, and append invalidation passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
