'use strict';
var assert = require('node:assert/strict');
var indexed = require('./careerIndexedStore.js');
var aggregator = require('./careerStatsAggregator.js');
var fixture = require('./testSupport/careerBackupFixtures.js');
var dashboard = require('./playerDashboard.js');
var classifier = require('./playerProfileClassifier.js');
var presentation = require('./playerProfilePresentation.js');
var explanation = require('./playerProfileExplanation.js');

var S1 = '00000000-0000-4000-8000-000000000101';
var S2 = '00000000-0000-4000-8000-000000000102';
var S3 = '00000000-0000-4000-8000-000000000103';
var S4 = '00000000-0000-4000-8000-000000000104';
function hand(id, sessionId, at, options) {
  options = options || {};
  var names = options.names || ['A', 'B'];
  var players = names.map(function (name, index) {
    var counters = name === 'A' ? Object.assign({ vpipMade: options.vpip || 0, pfrMade: options.pfr || 0,
      postflopAggressiveActions: options.aggressive || 0, postflopCalls: options.calls || 0 },
      options.f3b === undefined ? {} : { foldToThreeBet: options.f3b, foldToThreeBetOpportunities: 1 }) : {};
    var decisions = name === 'A' && options.f3b !== undefined ? { foldToThreeBet: fixture.decision(1, options.f3b, null) } : {};
    var row = fixture.player(name, name, counters, decisions);
    if (name === 'A' && options.f3b !== undefined) row.relational.foldToThreeBetAggressorPlayerId = 'B';
    row.position = { schemaVersion: 1, status: 'supported', dealtPosition: index === 0 ? 'BTN' : index === 1 ? 'BB' : 'SB', dealtPlayerCount: names.length, unsupportedReason: null };
    return row;
  });
  return fixture.record('RECENT-MODEL', id, players, { historicalSessionId: sessionId, finalizedAt: at,
    semanticVersions: options.versions, supersedesFingerprint: options.predecessor });
}
function metadata(records) {
  return { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'recent-model-test',
    firstAcceptedHandKey: records[0].handKey, firstAcceptedAt: records[0].finalizedAt,
    latestAcceptedAt: records[records.length - 1].finalizedAt };
}
function legacy(record) {
  var value = structuredClone(record); value.schemaVersion = 3; delete value.session;
  value.fingerprint = aggregator.fingerprint(value); return value;
}
function recent(records, window, filters) { return indexed.careerRecentPlayerStatsFromRecords(records, 'A', window, filters); }
function trend(records, filters) { return indexed.careerPlayerSessionTrendFromRecords(records, 'A', filters); }

(async function () {
  var records = [
    hand('OLD-1', S1, 100, { vpip: 0, f3b: 0 }),
    hand('OLD-2', S1, 101, { vpip: 0, f3b: 0 }),
    hand('MID-1', S2, 200, { vpip: 1, pfr: 1, f3b: 1, aggressive: 2, calls: 1 }),
    hand('NEW-HU', S3, 300, { vpip: 1, pfr: 1, aggressive: 1 }),
    hand('NEW-THREE', S3, 301, { names: ['A', 'B', 'C'], vpip: 1, pfr: 0 }),
    hand('NEW-B-ONLY', S3, 302, { names: ['B', 'C'] }),
    legacy(hand('LEGACY', null, 350, { vpip: 0 }))
  ];
  assert(records.every(function (value) { return aggregator.validateRecord(value) === null; }));
  var one = recent(records, { type: 'sessions', count: 1 });
  assert.deepEqual(one.selectedSessionIds, [S3]);
  assert.equal(one.selectedPlayerHandCount, 2, 'whole Session with joining/leaving player');
  assert.deepEqual(one.playerTableSizeHands, { HU: 1, '3_TO_5': 1, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.equal(one.core.counters.vpipMade, 2);
  assert.equal(one.core.counters.vpipOpportunities, 2);
  assert.equal(one.core.derived.vpip, 100);
  assert.equal(one.query.historyTraversals, 1);
  assert.equal(one.query.resolverPasses, 1);
  var hu = recent(records, { type: 'sessions', count: 1 }, { tableSize: 'HU' });
  assert.deepEqual(hu.selectedSessionIds, [S3], 'filter follows Session selection');
  assert.equal(hu.selectedPlayerHandCount, 2);
  assert.equal(hu.core.counters.hands, 1);
  assert.equal(hu.core.counters.vpipMade, 1);
  assert.equal(recent(records, { type: 'sessions', count: 3 }).selectedPlayerHandCount, 5);
  assert.equal(recent(records, { type: 'sessions', count: 100 }).selectedSessionCount, 3);
  var oneHand = recent(records, { type: 'hands', count: 1 });
  assert.equal(oneHand.selectedPlayerHandCount, 1);
  assert.equal(oneHand.core.counters.vpipMade, 0, 'dated legacy hand participates in hand window');
  assert.deepEqual(oneHand.unassigned, { legacyHandCount: 1, unsupportedHandCount: 0 });
  var unsupported = recent(records.concat([hand('NO-PROVENANCE', null, 360, { vpip: 1 })]), { type: 'hands', count: 1 });
  assert.deepEqual(unsupported.unassigned, { legacyHandCount: 0, unsupportedHandCount: 1 });
  assert.equal(recent(records, { type: 'hands', count: 100 }).selectedPlayerHandCount, 6);
  assert.equal(recent(records, { type: 'hands', count: 3 }, { tableSize: 'HU' }).core.counters.hands, 2,
    'hand filter cannot refill the fixed hand window');
  var compared = indexed.careerRecentVsCareerFromRecords(records, 'A', { type: 'sessions', count: 1 });
  assert.equal(compared.recent.core.counters.vpipMade, 2);
  assert.equal(compared.career.core.counters.vpipMade, 3);
  assert.equal(compared.career.core.counters.vpipOpportunities, 6);
  assert.equal(compared.comparison.vpip.recentValue, 100);
  assert.equal(compared.comparison.vpip.careerValue, 50);
  assert.equal(compared.comparison.vpip.delta, 50);
  assert.equal(compared.comparison.pfr.recentValue, 50);
  assert.equal(compared.comparison.pfr.careerValue, 33.3);
  assert.equal(compared.comparison.af.unit, 'ratio');
  assert.equal(compared.comparison.af.recentCalls, 0);
  assert.equal(compared.comparison.af.careerCalls, 1);
  assert.equal(compared.comparison.af.recentValue, null, 'zero calls and positive aggression is a nonfinite ratio, not a percentage');
  assert.equal(compared.comparison.af.recentNonFinite, true);
  assert.equal(compared.comparison.foldToThreeBet.recentSupport.count, 0);
  assert.equal(compared.comparison.foldToThreeBet.careerSupport.count, 3);
  assert.equal(compared.comparison.foldToThreeBet.recentSupport.status, 'insufficient');
  assert.equal(compared.query.historyTraversals, 1);
  assert.doesNotThrow(function () { JSON.stringify(compared); });
  assert.equal(JSON.stringify(compared).includes('Infinity'), false);
  var series = trend(records, { tableSize: 'HU' });
  assert.deepEqual(series.points.map(function (point) { return point.sessionId; }), [S1, S2, S3]);
  assert.deepEqual(series.points.map(function (point) { return point.playerHandCount; }), [2, 1, 2]);
  assert.equal(series.points[2].core.counters.hands, 1, 'mixed Session stays one point with HU-filtered counters');
  assert.equal(series.points[2].stats.foldToThreeBet.value, null, 'zero opportunity is unsupported');
  assert.equal(series.points[2].stats.foldToThreeBet.supportCount, 0);
  assert.deepEqual(series.points[2].playerTableSizeHands, { HU: 1, '3_TO_5': 1, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.equal(series.query.historyTraversals, 1);
  assert.equal(series.query.resolverPasses, 1);
  var threeOnly = trend(records, { tableSize: '3_TO_5' });
  assert.equal(threeOnly.points.length, 3, 'zero-match Sessions remain in the series');
  assert.equal(threeOnly.points[0].core.counters.hands, 0);
  assert.equal(threeOnly.points[0].stats.vpip.value, null);
  var tied = records.concat([hand('TIE-B', S4, 350, { vpip: 1 })]);
  assert.deepEqual(trend(tied).points.map(function (point) { return point.sessionId; }), [S1, S2, S3, S4]);
  var tiedHands = tied.concat([hand('TIE-A', S4, 350, { vpip: 0 })]);
  assert.equal(recent(tiedHands, { type: 'hands', count: 1 }).core.counters.vpipMade, 0,
    'equal finalized timestamps break by handKey, independent of input order');
  assert.deepEqual(recent(tiedHands.slice().reverse(), { type: 'hands', count: 1 }).core.counters,
    recent(tiedHands, { type: 'hands', count: 1 }).core.counters);
  var fifty = [];
  for (var n = 0; n < 60; n += 1) fifty.push(hand('FIFTY-' + n, n < 30 ? S1 : S2, 1000 + n,
    { vpip: n < 30 ? 0 : 1, pfr: n < 30 ? 0 : 1, f3b: n < 40 ? 0 : 1, calls: 1 }));
  var lastFifty = recent(fifty, { type: 'hands', count: 50 });
  assert.equal(lastFifty.selectedPlayerHandCount, 50);
  assert.equal(lastFifty.core.counters.vpipMade, 30, 'last 50 cuts through the older Session');
  assert.equal(lastFifty.core.counters.vpipOpportunities, 50);
  assert.equal(lastFifty.core.derived.vpip, 60, 'aggregate opportunities, not Session rate average');
  var weak = indexed.careerRecentVsCareerFromRecords(fifty, 'A', { type: 'hands', count: 3 });
  assert.equal(weak.comparison.foldToThreeBet.recentSupport.count, 3);
  assert.equal(weak.comparison.foldToThreeBet.recentSupport.status, 'insufficient');
  assert.equal(weak.comparison.foldToThreeBet.careerSupport.count, 60);
  assert.equal(weak.comparison.foldToThreeBet.careerSupport.status, 'strong');
  assert.equal(weak.comparison.af.recentValue, 0);
  assert.equal(weak.comparison.af.careerValue, 0);
  assert.equal(weak.comparison.af.recentSupport.count, 3);
  assert.equal(weak.comparison.af.careerSupport.count, 60);
  assert.equal(weak.comparison.af.recentCalls, 3);
  assert.equal(weak.comparison.af.careerCalls, 60);
  var profiles = indexed.careerRecentVsCareerFromRecords(fifty, 'A', { type: 'sessions', count: 1 }, { tableSize: 'HU' });
  assert.equal(dashboard.careerProfile(profiles.recent.profileStats, classifier, presentation, explanation).hands, 30);
  assert.equal(dashboard.careerProfile(profiles.career.profileStats, classifier, presentation, explanation).hands, 60,
    'the existing classifier consumes independent Recent and Career populations');
  var relation = indexed.careerRecentVsCareerFromRecords(fifty, 'A', { type: 'hands', count: 3 },
    { statId: 'foldToThreeBet', counterpartMode: 'specific', counterpartPlayerId: 'B' });
  assert.equal(relation.recent.relational.counters.foldToThreeBetOpportunities, 3);
  assert.equal(relation.comparison.foldToThreeBet.recentOpportunities, 3);
  assert.equal(relation.comparison.foldToThreeBet.careerOpportunities, 60);
  var relatedSeries = trend(fifty, { statId: 'foldToThreeBet', counterpartMode: 'specific', counterpartPlayerId: 'B' });
  assert.equal(relatedSeries.points[1].stats.foldToThreeBet.denominator, 30);
  assert.equal(relatedSeries.points[1].relational.counters.foldToThreeBetOpportunities, 30);
  for (var bad of [{ type: 'sessions', count: 0 }, { type: 'hands', count: 5001 }, { type: 'other', count: 1 }, { type: 'hands', count: 1, extra: 1 }])
    assert.throws(function () { recent(records, bad); }, TypeError);
  assert.throws(function () { indexed.careerPlayerSessionTrendFromRecords(records, '', {}); }, TypeError);
  assert.throws(function () { recent(records, { type: 'hands', count: 1 }, { tableSize: 'bad' }); }, TypeError);

  var root = hand('CORRECT', S3, 310, { vpip: 0, versions: { preflop: 1 } });
  var tip = hand('CORRECT', S3, 310, { vpip: 1, versions: { preflop: 2 }, predecessor: root.fingerprint });
  var corrected = records.concat([root, tip]);
  assert.equal(recent(corrected, { type: 'sessions', count: 1 }).core.counters.vpipMade, 3);
  assert.equal(trend(corrected).points[2].playerHandCount, 3, 'supersession counts one logical hand');
  var service = indexed.createMemoryService({}, { initializedAt: 1 });
  await service.replaceCareerRecords(records, metadata(records));
  assert.deepEqual(await service.getCareerRecentPlayerStats('A', { type: 'sessions', count: 1 }), one);
  var imported = hand('IMPORT', S4, 400, { vpip: 1 });
  await service.mergeCareerRecords(records.concat([imported]), metadata(records.concat([imported])));
  var exported = (await service.exportCareer()).records;
  assert.deepEqual(await service.getCareerPlayerSessionTrend('A'), trend(exported));
  assert.deepEqual(await service.getCareerRecentVsCareer('A', { type: 'sessions', count: 1 }),
    indexed.careerRecentVsCareerFromRecords(exported, 'A', { type: 'sessions', count: 1 }));
  await service.replaceCareerRecords(records, metadata(records));
  assert.deepEqual(await service.getCareerPlayerSessionTrend('A'), trend(records), 'Restore Replace over populated Career drops imported Session');
  assert.deepEqual(await service.getCareerRecentVsCareer('A', { type: 'hands', count: 3 }),
    indexed.careerRecentVsCareerFromRecords(records, 'A', { type: 'hands', count: 3 }));
  await service.mergeCareerRecords(records.concat([imported]), metadata(records.concat([imported])));
  var removalPlan = indexed.sessionRemovalPlan((await service.exportCareer()).records,
    { namespace: imported.namespace, historicalSessionId: S4, sessionHandIds: [imported.authoritativeHandId] });
  assert.deepEqual(removalPlan.logicalHandKeys, [imported.handKey]);
  await service.removeCareerHandKeys(removalPlan.logicalHandKeys);
  assert.deepEqual((await service.getCareerPlayerSessionTrend('A')).points.map(function (point) { return point.sessionId; }), [S1, S2, S3]);
  assert.equal((await service.getCareerRecentPlayerStats('A', { type: 'sessions', count: 1 })).selectedSessionIds[0], S3);
  assert.equal((await service.getCareerRecentPlayerStats('A', { type: 'hands', count: 1 })).core.counters.vpipMade, 0);
  assert.equal((await service.getCareerRecentVsCareer('A', { type: 'sessions', count: 1 })).recent.selectedSessionIds[0], S3);
  var wire = indexed.createMessageService({ sendMessage: function (message, callback) {
    Promise.resolve().then(function () { return service[message.method].apply(service, message.args); })
      .then(function (value) { callback({ ok: true, value: value }); }, function (error) { callback({ ok: false, error: error.message }); });
  } });
  assert.deepEqual(await wire.getCareerRecentPlayerStats('A', { type: 'sessions', count: 1 }), one);
  assert.deepEqual(await wire.getCareerPlayerSessionTrend('A'), trend(records));
  await assert.rejects(wire.getCareerRecentPlayerStats('A', { type: 'hands', count: 0 }), /recent window/);

  for (var scale of [{ sessions: 10, hands: 10 }, { sessions: 50, hands: 10 }, { sessions: 50, hands: 50 }]) {
    var generated = [];
    for (var s = 1; s <= scale.sessions; s += 1) for (var h = 1; h <= scale.hands; h += 1)
      generated.push(hand('PERF-' + s + '-' + h, '00000000-0000-4000-8000-' + String(s).padStart(12, '0'),
        10000 + s * 100 + h, { vpip: h % 2 }));
    var started = performance.now(); var result = trend(generated); var ms = Math.round((performance.now() - started) * 10) / 10;
    assert.equal(result.points.length, scale.sessions);
    assert.equal(result.query.historyTraversals, 1);
    assert.equal(result.query.resolverPasses, 1);
    assert.equal(result.query.physicalRecordsRead, generated.length);
    started = performance.now(); var selected = recent(generated, { type: 'sessions', count: 5 });
    var recentMs = Math.round((performance.now() - started) * 10) / 10;
    assert.equal(selected.query.historyTraversals, 1);
    assert.equal(selected.query.resolverPasses, 1);
    started = performance.now(); var comparison = indexed.careerRecentVsCareerFromRecords(generated, 'A', { type: 'hands', count: 50 });
    var comparisonMs = Math.round((performance.now() - started) * 10) / 10;
    assert.equal(comparison.query.historyTraversals, 1);
    assert.equal(comparison.query.resolverPasses, 1);
    console.log('Recent/trend performance: sessions=' + scale.sessions + ' hands=' + generated.length +
      ' traversals=' + result.query.historyTraversals + ' resolverPasses=' + result.query.resolverPasses +
      ' trendMs=' + ms + ' recentMs=' + recentMs + ' comparisonMs=' + comparisonMs);
  }
  console.log('Historical recent windows, comparison, Session series, mutation and message tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
