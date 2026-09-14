'use strict';

var assert = require('assert');
var indexed = require('./careerIndexedStore.js');
var aggregator = require('./careerStatsAggregator.js');
var phaseOne = require('./careerContributionStore.js');
var dashboard = require('./playerDashboard.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function hand(index, made) { var record = fixtures.record('TREND-SERVICE', 'H-' + index, [fixtures.player('subject', 'Subject', { vpipMade: made ? 1 : 0 }), fixtures.player('v-' + index, 'Villain')], { finalizedAt: 10000 + index }); record.fingerprint = aggregator.fingerprint(record); return record; }
function saved(records) { var value = {}; records.forEach(function (record) { value[phaseOne.RECORD_PREFIX + record.fingerprint] = record; }); return value; }

(async function () {
  var records = Array.from({ length: 75 }, function (_, index) { return hand(index + 1, false); });
  var coldService = indexed.createMemoryService(saved(records), { initializedAt: 1, buildId: 'trend-single-flight-test' });
  var concurrent = await Promise.all([coldService.careerTrendStats('subject'), coldService.careerTrendStats('subject'), coldService.careerTrendStats('subject')]);
  assert.strictEqual(coldService.testHooks.dashboardDiagnostics.playerRecordRetrievals, 1, 'concurrent cold requests share one player-history retrieval');
  assert.strictEqual(concurrent.filter(function (result) { return result.query.trendRequestCoalesced; }).length, 2, 'later cold requests join the in-flight revision query');
  assert.deepStrictEqual(concurrent.map(function (result) { return result.windows['50'].stats.counters; }), [concurrent[0].windows['50'].stats.counters, concurrent[0].windows['50'].stats.counters, concurrent[0].windows['50'].stats.counters], 'single-flight callers receive the same complete windows');
  coldService.close();
  var service = indexed.createMemoryService(saved(records), { initializedAt: 1, buildId: 'trend-service-test' });
  var first = await service.careerTrendStats('subject'); assert.deepStrictEqual(first.availableWindows, [25, 50]); assert.strictEqual(first.query.playerRevision, 75); assert.strictEqual(first.query.trendCacheHit, false);
  assert.strictEqual((await service.careerTrendStats('subject')).query.trendCacheHit, true, 'unchanged revision reuses Trend cache');
  var next = hand(76, true); assert.strictEqual((await service.append(next)).accepted, true);
  var afterAppend = await service.careerTrendStats('subject'); assert.strictEqual(afterAppend.query.trendCacheHit, false); assert.ok(afterAppend.query.playerRevision > first.query.playerRevision); assert.strictEqual(afterAppend.windows['25'].stats.counters.vpipMade, 1);
  var unrelated = fixtures.record('OTHER', 'OTHER', [fixtures.player('other', 'Other')], { finalizedAt: 99999 }); assert.strictEqual((await service.append(unrelated)).accepted, true);
  assert.strictEqual((await service.careerTrendStats('subject')).query.trendCacheHit, true, 'unrelated append preserves player Trend cache');

  var metadata = await service.careerLedgerInfo(); var replacement = Array.from({ length: 30 }, function (_, index) { return hand(100 + index, true); });
  await service.replaceCareerRecords(replacement, metadata, { restoredAt: 200000 });
  var restored = await service.careerTrendStats('subject'); assert.strictEqual(restored.query.trendCacheHit, false, 'restore clears Trend cache even when revision values can repeat');
  assert.deepStrictEqual(restored.availableWindows, [25]); assert.strictEqual(dashboard.selectTrendWindow(restored, 50), 25, 'unavailable selected window falls back to closest supported window');
  assert.strictEqual(restored.windows['25'].stats.counters.vpipMade, 25);
  service.close();
  console.log('Career Trend single-flight, revision cache, append, unrelated-player isolation, restore invalidation and window fallback passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
