'use strict';

var assert = require('assert');
var indexed = require('./careerIndexedStore.js');
var aggregator = require('./careerStatsAggregator.js');
var phaseOne = require('./careerContributionStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function records(count) {
  return Array.from({ length: count }, function (_, index) {
    var record = fixtures.record('TREND-PERF', 'H-' + String(index).padStart(5, '0'), [fixtures.player('subject', 'Subject', { vpipMade: index % 3 === 0 ? 1 : 0, pfrMade: index % 7 === 0 ? 1 : 0 }), fixtures.player('villain-' + index, 'Villain')], { finalizedAt: 100000 + index });
    record.fingerprint = aggregator.fingerprint(record); return record;
  });
}
function saved(values) { var result = {}; values.forEach(function (record) { result[phaseOne.RECORD_PREFIX + record.fingerprint] = record; }); return result; }

(async function () {
  var measurements = [];
  for (var count of [100, 500, 1000, 5000]) {
    var service = indexed.createMemoryService(saved(records(count)), { initializedAt: 1, buildId: 'trend-performance' });
    var before = service.testHooks.dashboardDiagnostics.playerRecordRetrievals; var started = performance.now();
    var cold = await service.careerTrendStats('subject'); var coldMs = Math.round((performance.now() - started) * 100) / 100;
    var afterCold = service.testHooks.dashboardDiagnostics.playerRecordRetrievals;
    started = performance.now(); var warm = await service.careerTrendStats('subject'); var warmMs = Math.round((performance.now() - started) * 100) / 100;
    var afterWarm = service.testHooks.dashboardDiagnostics.playerRecordRetrievals;
    assert.strictEqual(afterCold - before, 1); assert.strictEqual(cold.query.playerRecordRetrievals, 1); assert.strictEqual(cold.query.resolverPasses, 1);
    assert.strictEqual(cold.query.windowAggregateBuilds, cold.availableWindows.length, 'all windows derive from the one resolved history');
    assert.strictEqual(afterWarm - afterCold, 0); assert.strictEqual(warm.query.playerRecordRetrievals, 0); assert.strictEqual(warm.query.trendCacheHit, true);
    [25, 50, 100, 250].filter(function (size) { return count >= size; }).forEach(function (size) { assert.ok(warm.windows[String(size)]); });
    measurements.push({ hands: count, coldHistoryRetrievals: 1, resolverPasses: cold.query.resolverPasses, windowAggregateBuilds: cold.query.windowAggregateBuilds, warmWindowSwitchRetrievals: 0, coldMs: coldMs, warmMs: warmMs });
    service.close();
  }
  console.log('CAREER_TRENDS_PERFORMANCE ' + JSON.stringify({ environment: 'synthetic Node memory service; timings informational', measurements: measurements }));
})().catch(function (error) { console.error(error); process.exit(1); });
