'use strict';
var assert = require('node:assert/strict');
var Resolver = require('./positionResolver.js');
var Aggregator = require('./careerStatsAggregator.js');
var Filtered = require('./filteredStats.js');
var Indexed = require('./careerIndexedStore.js');
var Fixtures = require('./testSupport/careerBackupFixtures.js');

function provenance(dealt, occupied) {
  var ids = Array.from({ length: dealt }, function (_, i) { return 'P' + i; });
  var seats = Array.from({ length: occupied }, function (_, i) { return [i + 1, 'P' + i]; });
  return Resolver.resolve({ dealtPlayerIds: ids, seats: seats, buttonPlayerId: 'P0',
    smallBlindPlayerId: dealt === 2 ? 'P0' : 'P1', bigBlindPlayerId: dealt === 2 ? 'P1' : 'P2' });
}
assert.equal(provenance(4, 6).dealtPlayerCount, 4, 'two seated Away players are excluded');
assert.equal(provenance(2, 5).dealtPlayerCount, 2, 'three seated sitting-out players are excluded');
assert.equal(Aggregator.classifyTableSize(provenance(4, 6).dealtPlayerCount), '3_TO_5');
assert.equal(Aggregator.classifyTableSize(provenance(2, 5).dealtPlayerCount), 'HU');
var frozen = provenance(2, 5);
assert.equal(frozen.dealtPlayerCount, 2, 'hand N retains frozen start provenance');
assert.equal(provenance(3, 5).dealtPlayerCount, 3, 'an Away player dealt next hand changes only hand N+1');
assert.equal(frozen.dealtPlayerCount, 2, 'later occupancy never reclassifies hand N');
assert.equal(Aggregator.classifyTableSize(null), 'UNKNOWN');

var labels = { 2: ['BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] };
function record(hand, count) {
  var players = (labels[count] || ['BTN', 'BB']).map(function (position, index) {
    var p = Fixtures.player(index === 0 ? 'hero' : 'other-' + index, 'Player ' + index,
      { vpipMade: index === 0 ? 1 : 0, wtsdOpportunities: index === 0 || index === (count === 2 ? 1 : 2) ? 1 : 0 });
    p.position = { schemaVersion: 1, status: count ? 'supported' : 'unsupported', dealtPosition: count ? position : null,
      dealtPlayerCount: count || null, unsupportedReason: count ? null : 'unknown historical provenance' };
    p.decisions.wtsd = Fixtures.decision(index === 0 || index === (count === 2 ? 1 : 2), false, null);
    return p;
  });
  return Fixtures.record('TABLE-SIZE', hand, players, { finalizedAt: 1000 + Number(hand) });
}
var records = [record('1', 2), record('2', 4), record('3', 6), record('4', null)];
var mixedCounts = Array(80).fill(2).concat(Array(60).fill(4), Array(100).fill(6));
var mixedRecords = mixedCounts.map(function (count, index) { return record(String(index + 100), count); });
var mixedAggregate = Aggregator.rebuild(mixedRecords).aggregate.players.hero;
assert.deepEqual([mixedAggregate.counters.hands, mixedAggregate.tableSizes[2].counters.hands,
  mixedAggregate.tableSizes[4].counters.hands, mixedAggregate.tableSizes[6].counters.hands], [240, 80, 60, 100],
  'All retains every hand while exact-count partitions are disjoint');
assert.deepEqual(records.map(Aggregator.resolveDealtPlayerCount), [2, 4, 6, null]);
var rebuilt = Aggregator.rebuild(records);
assert.equal(rebuilt.aggregate.schemaVersion, 4);
var hero = rebuilt.aggregate.players.hero;
assert.deepEqual(Object.keys(hero.tableSizes).sort(), ['2', '4', '6']);
assert.deepEqual([hero.tableSizes[2].counters.hands, hero.tableSizes[4].counters.hands, hero.tableSizes[6].counters.hands], [1, 1, 1]);
assert.equal(hero.counters.hands, 4, 'unknown historical hands remain in All');
assert.equal(hero.tableSizes[2].contexts.positions.BTN.hands, 1);
assert.equal(hero.tableSizes[2].contexts.situations.ip.hands, 1);
assert.equal(hero.tableSizes[4].contexts.situations.ip.hands, 1);
assert.equal(hero.tableSizes[6].contexts.situations.ip.hands, 1);
assert.deepEqual(Aggregator.rebuild(records).aggregate, rebuilt.aggregate, 'one canonical rebuild is idempotent');
for (var bucket of ['HU', '3_TO_5', 'SIX_PLUS']) {
  var traversed = Filtered.careerStatsFiltered(records, 'hero', { tableSize: bucket });
  assert.equal(traversed.counters.hands, 1, bucket + ' authoritative traversal matches partition');
}

(async function () {
  function dashboardCore(value) {
    var coverage = value.coverage;
    return { schemaVersion: value.schemaVersion, playerId: value.playerId, filters: value.filters,
      counters: value.counters, derived: value.derived, coverage: {
        totalCareerHands: coverage.totalCareerHands, positionTrackedHands: coverage.positionTrackedHands,
        matchedPositionHands: coverage.matchedPositionHands, situationTrackedHands: coverage.situationTrackedHands,
        matchedSituationHands: coverage.matchedSituationHands, tableSizeHands: coverage.tableSizeHands
      } };
  }
  async function assertCoreParity(label, dataset, expectedAllBuckets) {
    var parityService = Indexed.createMemoryService();
    await parityService.replaceCareerRecords(dataset, {}, {});
    for (var request of [{}, { tableSize: 'HU' }, { tableSize: '3_TO_5' }, { tableSize: 'SIX_PLUS' },
      { position: 'BTN' }, { situation: 'ip' }, { tableSize: 'HU', position: 'BTN' }]) {
      var direct = Filtered.careerStatsFiltered(dataset, 'hero', request);
      var warm = await parityService.careerDashboardStats('hero', request);
      assert.deepEqual(dashboardCore(warm.core), dashboardCore(direct),
        label + ' cold/history and warm/cache Dashboard fields match: ' + JSON.stringify(request));
      assert.equal(warm.query.playerRecordRetrievals, 0, label + ' maintained read avoids player history');
    }
    var all = await parityService.careerDashboardStats('hero', {});
    assert.deepEqual(all.core.coverage.tableSizeHands, expectedAllBuckets, label + ' classified buckets exclude unknown hands');
    assert.equal(all.core.counters.hands, dataset.length, label + ' All raw hands remain present');
  }
  await assertCoreParity('unknown-only', [records[3]], { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 });
  await assertCoreParity('HU-only', [records[0]], { HU: 1, '3_TO_5': 0, SIX_PLUS: 0 });
  await assertCoreParity('mixed with unknown', records, { HU: 1, '3_TO_5': 1, SIX_PLUS: 1 });
  var mixedService = Indexed.createMemoryService();
  await mixedService.replaceCareerRecords(mixedRecords, {}, {});
  for (var slice of [['all', 240], ['HU', 80], ['3_TO_5', 60], ['SIX_PLUS', 100]]) {
    var mixedResult = await mixedService.careerDashboardStats('hero', { tableSize: slice[0] });
    assert.equal(mixedResult.core.counters.hands, slice[1], slice[0] + ' selects only its authoritative Career hands');
    assert.equal(mixedResult.query.playerRecordRetrievals, 0);
    if (slice[0] === 'all') assert.equal(mixedResult.profileStats, null, 'mixed All has no single calibrated profile');
  }
  var service = Indexed.createMemoryService();
  for (var item of records) assert.equal((await service.append(item)).accepted, true);
  service.testHooks.metadata.aggregateSchemaVersion = 3;
  service.testHooks.caches.clear();
  service.testHooks.dashboardCache.clear();
  var upgradesBefore = service.testHooks.dashboardDiagnostics.aggregateUpgrades;
  assert.equal((await service.careerDashboardStats('hero', { tableSize: 'HU' })).core.counters.hands, 1);
  assert.equal(service.testHooks.dashboardDiagnostics.aggregateUpgrades, upgradesBefore + 1, 'v3 aggregate upgrades once from authoritative records');
  assert.deepEqual((await service.careerDashboardStats('hero', { situation: 'ip' })).core,
    Filtered.careerStatsFiltered(records, 'hero', { situation: 'ip' }), 'schema-4 migration retains complete history/cache context parity');
  for (var selected of ['all', 'HU', '3_TO_5', 'SIX_PLUS']) {
    var result = await service.careerDashboardStats('hero', { tableSize: selected, opponentMode: 'overall' });
    assert.equal(result.core.counters.hands, selected === 'all' ? 4 : 1);
    assert.equal(result.query.playerRecordRetrievals, 0, 'warm maintained table-size reads avoid history');
    assert.equal(result.core.coverage.tableSizeHands.HU, selected === 'all' || selected === 'HU' ? 1 : 0);
    if (selected !== 'all') assert.equal(result.profileStats.tableSize, selected);
  }
  assert.equal(service.testHooks.dashboardDiagnostics.aggregateUpgrades, upgradesBefore + 1, 'warm reads do not repeat upgrade');
  var huIp = await service.careerDashboardStats('hero', { tableSize: 'HU', situation: 'ip' });
  assert.equal(huIp.core.counters.hands, 1);
  assert.equal(huIp.comparisonContexts.situations.ip.counters.hands, 1);
  assert.equal(huIp.query.playerRecordRetrievals, 0);
  for (var bucket of ['3_TO_5', 'SIX_PLUS']) {
    var slice = await service.careerDashboardStats('hero', { tableSize: bucket, situation: 'ip' });
    assert.equal(slice.core.counters.hands, 1, bucket + ' × IP uses the same exact hand');
    assert.equal(slice.query.playerRecordRetrievals, 0);
  }
  var added = record('5', 3);
  await service.mergeCareerRecords(records.concat([added]), {}, {});
  assert.equal((await service.careerDashboardStats('hero', { tableSize: '3_TO_5' })).core.counters.hands, 2, 'Import Merge rebuilds disjoint partitions');
  await service.replaceCareerRecords(records, {}, {});
  assert.equal((await service.careerDashboardStats('hero', { tableSize: '3_TO_5' })).core.counters.hands, 1, 'Restore Replace rebuilds from final authority');
  await service.removeCareerHandKeys([records[0].handKey]);
  assert.equal((await service.careerDashboardStats('hero', { tableSize: 'HU' })).core.counters.hands, 0, 'exact removal clears only the removed segment');
  assert.equal((await service.careerDashboardStats('hero', { tableSize: 'SIX_PLUS' })).core.counters.hands, 1, 'removal preserves other segments');
  console.log('Authoritative dealt counts, Away/late-join exclusion, disjoint Career partitions, rebuild, contexts, and warm reads passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
