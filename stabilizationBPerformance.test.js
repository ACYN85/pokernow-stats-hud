'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var filtered = require('./filteredStats.js');
var cacheApi = require('./sessionStatsCache.js');
var runtime = require('./sessionRuntime.js');
var indexed = require('./careerIndexedStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function elapsed(started) { return Math.round((performance.now() - started) * 1000) / 1000; }
function makeEvents(handCount) {
  var positions = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
  var events = [];
  for (var hand = 0; hand < handCount; hand += 1) {
    for (var seat = 0; seat < 6; seat += 1) {
      var action = seat === 0 ? 'raise' : seat === 1 ? 'call' : 'fold';
      events.push({
        handId: 'bench-' + hand, playerId: 'p' + seat, player: 'P' + seat,
        action: action, street: 'preflop', amount: action === 'raise' ? 6 : action === 'call' ? 6 : 0,
        countsAsHand: true, vpipOpportunity: true, pfrOpportunity: true,
        dealtPosition: positions[(seat - hand % 6 + 6) % 6],
        threeBetMade: seat === 0 && hand % 5 === 0 ? 1 : 0,
        threeBetOpportunities: seat === 0 ? 1 : 0,
        threeBetTargetPlayerId: seat === 0 ? 'p1' : null,
        foldToThreeBet: seat === 1 && hand % 2 === 0 ? 1 : 0,
        foldToThreeBetOpportunities: seat === 1 ? 1 : 0,
        foldToThreeBetAggressorPlayerId: seat === 1 ? 'p0' : null,
        flopCBetMade: seat === 0 && hand % 3 === 0 ? 1 : 0,
        flopCBetOpportunities: seat === 0 ? 1 : 0,
        foldToFlopCBet: seat === 1 && hand % 4 === 0 ? 1 : 0,
        foldToFlopCBetOpportunities: seat === 1 ? 1 : 0,
        foldToFlopCBetAggressorPlayerId: seat === 1 ? 'p0' : null,
        timestamp: hand * 10 + seat
      });
    }
  }
  return events;
}

function sessionBenchmark(handCount) {
  var events = makeEvents(handCount);
  var cache = cacheApi.create({ maxEntries: 64 });
  var coldStarted = performance.now();
  var cold = [];
  for (var seat = 0; seat < 6; seat += 1) {
    (function (playerId) {
      cold.push(cacheApi.get(cache, { kind: 'exact', playerId: playerId }, function () {
        return stats.computePlayerStatsByIdentity(events, playerId, 'P' + playerId.slice(1));
      }));
    })('p' + seat);
  }
  var coldMs = elapsed(coldStarted);
  var warmStarted = performance.now();
  for (var warmSeat = 0; warmSeat < 6; warmSeat += 1) {
    var warmId = 'p' + warmSeat;
    var warm = cacheApi.get(cache, { kind: 'exact', playerId: warmId }, function () { throw new Error('warm cache query recomputed'); });
    assert.strictEqual(warm, cold[warmSeat], 'identical revision/query returns the exact computed result object');
  }
  var warmMs = elapsed(warmStarted);
  var uncachedReferenceStarted = performance.now();
  for (var verifySeat = 0; verifySeat < 6; verifySeat += 1) {
    assert.deepStrictEqual(cold[verifySeat], stats.computePlayerStatsByIdentity(events, 'p' + verifySeat, 'P' + verifySeat), 'cached and uncached exact counters are equivalent');
  }
  var uncachedReferenceMs = elapsed(uncachedReferenceStarted);

  var queries = [
    {},
    { position: 'BTN' },
    { statId: 'threeBet', counterpartMode: 'self', selfPlayerId: 'p1' },
    { statId: 'foldToFlopCBet', counterpartMode: 'others', selfPlayerId: 'p0' }
  ];
  var dashboardColdStarted = performance.now();
  var dashboardCold = queries.map(function (filters, index) {
    return cacheApi.get(cache, { kind: 'filtered', playerId: 'p0', filters: filtered.normalizeFilters(filters) }, function () {
      return filtered.sessionStatsFiltered(events, 'p0', filters);
    });
  });
  var dashboardColdMs = elapsed(dashboardColdStarted);
  var dashboardWarmStarted = performance.now();
  var dashboardWarm = queries.map(function (filters) {
    return cacheApi.get(cache, { kind: 'filtered', playerId: 'p0', filters: filtered.normalizeFilters(filters) }, function () { throw new Error('warm dashboard query recomputed'); });
  });
  var dashboardWarmMs = elapsed(dashboardWarmStarted);
  var dashboardUncachedReferenceStarted = performance.now();
  queries.forEach(function (filters, index) {
    assert.strictEqual(dashboardWarm[index], dashboardCold[index]);
    assert.deepStrictEqual(dashboardWarm[index], filtered.sessionStatsFiltered(events, 'p0', filters));
  });
  var dashboardUncachedReferenceMs = elapsed(dashboardUncachedReferenceStarted);
  return { hands: handCount, events: events.length, sessionColdMs: coldMs, sixPlayerUncachedReferenceMs: uncachedReferenceMs, sessionWarmMs: warmMs, dashboardColdMs: dashboardColdMs, dashboardUncachedReferenceMs: dashboardUncachedReferenceMs, dashboardWarmMs: dashboardWarmMs, cache: cacheApi.inspect(cache), eventsArray: events };
}

function persistenceBenchmark(events) {
  var planner = runtime.createPersistencePlanner({ initialFinalizedRevision: 1, persistedFinalizedRevision: 1 });
  var queueCallbacks = [];
  var writes = [];
  var writeSerializationMs = 0;
  var queue = stats.createSerializedPersistenceQueue(function (payload, revision, callback) {
    var started = performance.now();
    var json = JSON.stringify(payload);
    writeSerializationMs += performance.now() - started;
    writes.push({ revision: revision, bytes: Buffer.byteLength(json), includesFinalized: Object.prototype.hasOwnProperty.call(payload, 'live') });
    queueCallbacks.push(callback);
  });
  var plannedBytes = 0;
  var enqueueStarted = performance.now();
  for (var index = 0; index < 100; index += 1) {
    var plan = runtime.planPersistence(planner, {
      finalizedRevision: 1,
      finalized: { live: events, finalizedHandIds: ['last'] },
      recovery: { activeHand: { handId: 'active', events: [{ eventKey: 'event-' + index }] }, fingerprints: ['event-' + index] },
      reason: 'staged action'
    });
    assert.strictEqual(plan.includesFinalized, false);
    plannedBytes += Buffer.byteLength(JSON.stringify(plan.payload));
    queue.enqueue(plan.payload, function (error) { assert.ifError(error); });
  }
  var enqueueMs = elapsed(enqueueStarted);
  while (queueCallbacks.length) queueCallbacks.shift()(null);
  assert.strictEqual(writes.filter(function (write) { return write.includesFinalized; }).length, 0);
  assert.strictEqual(writes.length, 2, '100 adjacent persistence requests coalesce to the in-flight write plus one pending write');
  return {
    stagedRequests: 100,
    fullHistorySerializations: 0,
    recoveryPayloadSerializations: 100,
    plannedBytes: plannedBytes,
    storageInvocations: writes.length,
    storageBytes: writes.reduce(function (sum, write) { return sum + write.bytes; }, 0),
    enqueueAndCloneMs: enqueueMs,
    writerJsonMs: Math.round(writeSerializationMs * 1000) / 1000
  };
}

(async function () {
  var oneThousand = sessionBenchmark(1000);
  var tenThousand = sessionBenchmark(10000);
  var persistenceOneThousand = persistenceBenchmark(oneThousand.eventsArray);
  var persistenceTenThousand = persistenceBenchmark(tenThousand.eventsArray);
  delete oneThousand.eventsArray;
  delete tenThousand.eventsArray;

  var career = indexed.createMemoryService({}, { initializedAt: 1, migratedAt: 2, buildId: 'stabilization-b-benchmark' });
  var records = fixtures.complexRecords();
  for (var recordIndex = 0; recordIndex < records.length; recordIndex += 1) await career.append(records[recordIndex]);
  await career.careerStats('stable-alice');
  var careerOldOverallRetrievalsBefore = career.testHooks.dashboardDiagnostics.playerRecordRetrievals;
  var careerOldOverallStarted = performance.now();
  await career.careerStatsFiltered('stable-alice', {});
  var careerOldOverallMs = elapsed(careerOldOverallStarted);
  var careerOldOverallRetrievals = career.testHooks.dashboardDiagnostics.playerRecordRetrievals - careerOldOverallRetrievalsBefore;
  var careerOldRelationalRetrievalsBefore = career.testHooks.dashboardDiagnostics.playerRecordRetrievals;
  var careerOldRelationalStarted = performance.now();
  await Promise.all([
    career.careerStatsFiltered('stable-alice', {}),
    career.careerStatsFiltered('stable-alice', { statId: 'threeBet', counterpartMode: 'self', selfPlayerId: 'stable-bob' }),
    career.careerStatsFiltered('stable-alice', { statId: 'foldToThreeBet', counterpartMode: 'self', selfPlayerId: 'stable-bob' }),
    career.careerStatsFiltered('stable-alice', { statId: 'foldToFlopCBet', counterpartMode: 'self', selfPlayerId: 'stable-bob' })
  ]);
  var careerOldRelationalMs = elapsed(careerOldRelationalStarted);
  var careerOldRelationalRetrievals = career.testHooks.dashboardDiagnostics.playerRecordRetrievals - careerOldRelationalRetrievalsBefore;
  var careerOverallStarted = performance.now();
  var overall = await career.careerDashboardStats('stable-alice', { opponentMode: 'overall', selfPlayerId: 'stable-bob' });
  var careerOverallMs = elapsed(careerOverallStarted);
  var careerRelationalStarted = performance.now();
  var relational = await career.careerDashboardStats('stable-alice', { opponentMode: 'self', selfPlayerId: 'stable-bob' });
  var careerRelationalMs = elapsed(careerRelationalStarted);
  assert.strictEqual(overall.query.aggregateCacheUsed, true);
  assert.strictEqual(overall.query.playerRecordRetrievals, 0);
  assert.strictEqual(relational.query.playerRecordRetrievals, 1);
  assert.strictEqual(careerOldOverallRetrievals, 1);
  assert.strictEqual(careerOldRelationalRetrievals, 4);

  var report = {
    measuredScope: 'Node CPU, JSON byte counts, and in-memory service calls only; no Chrome storage or IndexedDB latency claimed',
    beforeStartingCandidate: {
      oneThousand: { sixPlayerColdMs: 22.744, fourDashboardQueriesMs: 6.395, stagedFullHistorySerializations: 100, stagedBytes: 276886600, stagedJsonMs: 621.618 },
      tenThousand: { sixPlayerColdMs: 284.469, fourDashboardQueriesMs: 88.533, stagedFullHistorySerializations: 100, stagedBytes: 2790367800, stagedJsonMs: 6518.645 }
    },
    after: { oneThousand: oneThousand, tenThousand: tenThousand, persistenceOneThousand: persistenceOneThousand, persistenceTenThousand: persistenceTenThousand, career: { previousUnfilteredMs: careerOldOverallMs, previousUnfilteredRecordRetrievals: careerOldOverallRetrievals, unfilteredAggregateMs: careerOverallMs, unfilteredRecordRetrievals: 0, previousRelationalMs: careerOldRelationalMs, previousRelationalRecordRetrievals: careerOldRelationalRetrievals, combinedRelationalMs: careerRelationalMs, combinedRelationalRecordRetrievals: 1 } }
  };
  console.log('STABILIZATION_B_BENCHMARK ' + JSON.stringify(report));
})().catch(function (error) { console.error(error); process.exit(1); });
