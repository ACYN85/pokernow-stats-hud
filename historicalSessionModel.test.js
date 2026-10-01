'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var filtered = require('./filteredStats.js');
var indexed = require('./careerIndexedStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var dashboard = require('./playerDashboard.js');
var insights = require('./playerInsights.js');
var classifier = require('./playerProfileClassifier.js');
var presentation = require('./playerProfilePresentation.js');
var explanation = require('./playerProfileExplanation.js');

var S = '00000000-0000-4000-8000-000000000011';
var T = '00000000-0000-4000-8000-000000000012';
var U = '00000000-0000-4000-8000-000000000013';
function row(id, position, size, counters, decisions) {
  var value = fixtures.player(id, id, counters, decisions);
  value.position = { schemaVersion: 1, status: 'supported', dealtPosition: position, dealtPlayerCount: size, unsupportedReason: null };
  return value;
}
function hand(id, sessionId, at, names, options) {
  options = options || {};
  var size = names.filter(function (entry) { return entry !== 'seated-only'; }).length;
  var players = names.map(function (name, index) {
    var counters = name === 'seated-only' ? { hands: 0, vpipOpportunities: 0, pfrOpportunities: 0 } : {};
    if (options.walk && name === 'A') counters = { vpipOpportunities: 0, pfrOpportunities: 0 };
    if (options.conditional && name === 'A') counters = { foldToThreeBet: 1, foldToThreeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1, postflopAggressiveActions: 1, postflopCalls: 1 };
    var decisions = options.conditional && name === 'A' ? { foldToThreeBet: fixtures.decision(1, 1, null), flopCBet: fixtures.decision(1, 1, null), foldToFlopCBet: fixtures.decision(1, 1, null), wtsd: fixtures.decision(1, 1, null), wsd: fixtures.decision(1, 1, null) } : {};
    if (!options.conditional && name !== 'seated-only' && size === 2) decisions.wtsd = fixtures.decision(1, 0, null);
    return row(name, options.walk ? index === 0 ? 'BB' : 'BTN' : index === 0 ? 'BTN' : index === 1 ? 'BB' : 'SB', size, counters, decisions);
  });
  return fixtures.record('HISTORY-MODEL', id, players, { historicalSessionId: sessionId, finalizedAt: at, semanticVersions: options.versions, supersedesFingerprint: options.predecessor });
}
function legacy(record) { var copy = structuredClone(record); copy.schemaVersion = 3; delete copy.session; copy.fingerprint = aggregator.fingerprint(copy); return copy; }
function activeSession(records, id) { return aggregator.resolveActiveRecords(records).activeRecords.filter(function (record) { return record.session && record.session.sessionId === id; }); }
function cards(result) { return Object.fromEntries(dashboard.fromCareer(result).map(function (card) { return [card.id, card]; })); }
function parity(detail, records, player, filters) {
  var scope = { position: filters && filters.position || null, situation: filters && filters.situation || null, tableSize: filters && filters.tableSize || null };
  var active = activeSession(records, detail.session.sessionId);
  var participating = new Set(active.filter(function (record) { return record.players.some(function (entry) { return entry.playerId === player && entry.counters.hands > 0; }); }).map(function (record) { return record.handKey; }));
  var selected = aggregator.resolveActiveRecords(records).physicalRecords.filter(function (record) { return participating.has(record.handKey) && record.session.sessionId === detail.session.sessionId; });
  assert.deepStrictEqual(detail.core, filtered.careerStatsFiltered(selected, player, scope), 'full counters, derived values and coverage equal a fresh scoped Career rebuild');
  var unfiltered = filtered.careerStatsFiltered(selected, player, {});
  assert.deepStrictEqual(detail.session.stats, { counters: unfiltered.counters, derived: unfiltered.derived });
}
function metadata(records) { return { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'session-model-test', firstAcceptedHandKey: records[0].handKey, firstAcceptedAt: records[0].finalizedAt, latestAcceptedAt: records[records.length - 1].finalizedAt }; }

(async function () {
  var records = [];
  for (var i = 1; i <= 15; i += 1) {
    var names = i <= 5 ? ['A', 'B'] : i <= 10 ? ['A', 'B', 'C'] : ['A', 'C'];
    if (i === 2) names.push('seated-only');
    records.push(hand('S-' + i, S, 100 + i, names, { walk: i === 1, conditional: i >= 2 && i <= 4 }));
  }
  records.push(hand('T-1', T, 200, ['B', 'C']));
  records.push(hand('T-2', T, 210, ['A', 'C']));
  records.push(hand('T-3', T, 220, ['C', 'B'])); // A leaves before the Session ends.
  records.push(hand('U-1', U, 220, ['A', 'B'])); // Equal end time uses Session ID.
  records[18].players.forEach(function (entry) { entry.position = { schemaVersion: 1, status: 'unsupported', dealtPosition: null, dealtPlayerCount: null, unsupportedReason: 'dealt count unavailable' }; });
  records[18].fingerprint = aggregator.fingerprint(records[18]);
  records.push(hand('UNASSIGNED', null, 230, ['A', 'B']));
  records.push(legacy(hand('LEGACY', null, 240, ['A', 'B'])));
  assert(records.every(function (record) { return aggregator.validateRecord(record) === null; }));
  var service = indexed.createMemoryService({}, { initializedAt: 1 });
  for (var record of records) assert.strictEqual((await service.append(record)).accepted, true);
  var history = await service.listCareerSessionPlayerSummaries('A');
  assert.deepStrictEqual(history.sessions.map(function (item) { return item.sessionId; }), [T, U, S], 'whole-Session end time and deterministic ID determine ordering');
  assert.deepStrictEqual(history.unassigned, { legacyHandCount: 1, unsupportedHandCount: 1 });
  assert.deepStrictEqual(history.sessions.map(function (item) { return [item.playerHandCount, item.sessionHandCount]; }), [[1, 3], [1, 1], [15, 15]]);
  assert.strictEqual(history.query.historyTraversals, 1);
  assert.strictEqual(history.query.resolverPasses, 1);
  assert.strictEqual(history.query.physicalRecordsRead, records.length);
  assert.deepStrictEqual(history.sessions[2].tableSizeHands, { HU: 10, '3_TO_5': 5, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.deepStrictEqual(history.sessions[2].playerTableSizeHands, history.sessions[2].tableSizeHands);
  assert.deepStrictEqual(history.sessions[1].tableSizeHands, { HU: 0, '3_TO_5': 0, SIX_PLUS: 0, UNKNOWN: 1 }, 'unknown dealt count remains explicit in All');
  assert.strictEqual((await service.getCareerSessionPlayerStats(U, 'A', { tableSize: 'HU' })).core.counters.hands, 0);
  assert.deepStrictEqual((await service.listCareerSessionPlayerSummaries('B')).sessions.find(function (item) { return item.sessionId === S; }).playerTableSizeHands, { HU: 5, '3_TO_5': 5, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.deepStrictEqual((await service.listCareerSessionPlayerSummaries('C')).sessions.find(function (item) { return item.sessionId === S; }).playerTableSizeHands, { HU: 5, '3_TO_5': 5, SIX_PLUS: 0, UNKNOWN: 0 });
  assert.strictEqual((await service.listCareerSessionPlayerSummaries('B')).sessions.find(function (item) { return item.sessionId === S; }).sessionHandCount, 15);
  assert.strictEqual((await service.listCareerSessionPlayerSummaries('C')).sessions.find(function (item) { return item.sessionId === S; }).sessionHandCount, 15);
  assert.deepStrictEqual((await service.listCareerSessionPlayerSummaries('seated-only')).sessions, []);
  var detail = await service.getCareerSessionPlayerStats(S, 'A');
  parity(detail, records, 'A');
  assert.deepStrictEqual(detail.session, history.sessions[2]);
  assert.strictEqual(detail.core.counters.hands, 15);
  assert.strictEqual(detail.core.counters.vpipOpportunities, 14, 'BB walk counts a hand but not a VPIP opportunity');
  assert.strictEqual(detail.core.counters.pfrOpportunities, 14);
  assert.strictEqual(detail.core.counters.foldToThreeBetOpportunities, 3);
  assert.strictEqual(detail.core.counters.flopCBetOpportunities, 3);
  assert.strictEqual(detail.core.counters.foldToFlopCBetOpportunities, 3);
  assert.strictEqual(detail.core.counters.wtsdOpportunities, 3);
  assert.strictEqual(detail.core.counters.wsdOpportunities, 3);
  assert.strictEqual(detail.core.coverage.activeRecordCount, 15);
  assert.strictEqual(detail.core.coverage.physicalRecordCount, 15);
  assert.strictEqual(detail.core.coverage.earliestPositionTrackedAt, 101);
  assert.strictEqual(cards(detail.core).foldToThreeBet.evidence.status, 'insufficient');
  assert.strictEqual(cards(detail.core).foldToThreeBet.evidence.supportCount, 3);
  var overall = { position: null, situation: 'overall', opponentMode: 'overall' };
  assert.strictEqual(insights.derive({ cards: dashboard.fromCareer(detail.core, overall), source: 'career', context: overall, tableSize: null, tableSizeSupported: false }).length, 0, 'mixed Session does not claim a calibrated table size');
  assert.strictEqual(detail.profileStats, null, 'mixed All has no single table-size Profile input');
  assert.strictEqual(JSON.parse(JSON.stringify(detail)).session.sessionId, S);
  assert.strictEqual(JSON.stringify(detail).includes('HISTORY-MODEL'), false, 'query result does not expose room namespace or raw records');
  assert.strictEqual(await service.getCareerSessionPlayerStats(S, 'seated-only'), null);
  for (var filters of [{ tableSize: 'HU' }, { tableSize: '3_TO_5' }, { situation: 'ip' }, { situation: 'oop' }, { position: 'BTN' }, { tableSize: 'HU', position: 'BTN' }, { tableSize: '3_TO_5', situation: 'ip' }]) {
    var scoped = await service.getCareerSessionPlayerStats(S, 'A', filters);
    parity(scoped, records, 'A', filters);
    assert.strictEqual(scoped.core.coverage.physicalRecordCount, 15, 'coverage remains within selected Session');
  }
  var hu = await service.getCareerSessionPlayerStats(S, 'A', { tableSize: 'HU' });
  var three = await service.getCareerSessionPlayerStats(S, 'A', { tableSize: '3_TO_5' });
  assert.strictEqual(hu.core.counters.hands, 10);
  assert.strictEqual(three.core.counters.hands, 5);
  assert.strictEqual(hu.profileStats.tableSize, 'HU');
  assert.strictEqual(hu.profileStats.counters.hands, 10);
  assert.strictEqual(insights.derive({ cards: dashboard.fromCareer(hu.core, overall), source: 'career', context: overall, tableSize: 'HU', tableSizeSupported: true }).length, 0, 'weak HU Session cannot borrow Career or another Session analysis support');
  assert.strictEqual(three.profileStats.counters.hands, 5);
  assert.strictEqual(detail.comparisonContexts.positions.BTN.counters.hands, 14);
  assert.strictEqual(detail.comparisonContexts.situations.ip.counters.hands + detail.comparisonContexts.situations.oop.counters.hands > 0, true);
  ['ip', 'oop'].forEach(function (situation) {
    var value = detail.comparisonContexts.situations[situation];
    if (value) assert.deepStrictEqual(value, filtered.careerStatsFiltered(activeSession(records, S), 'A', { situation: situation }), 'comparison context includes Session-scoped coverage');
  });
  aggregator.POSITION_LABELS.forEach(function (position) {
    var value = detail.comparisonContexts.positions[position];
    if (value) assert.deepStrictEqual(value, filtered.careerStatsFiltered(activeSession(records, S), 'A', { position: position }));
  });
  var relational = await service.getCareerSessionPlayerStats(S, 'A', { statId: 'foldToThreeBet', counterpartMode: 'specific', counterpartPlayerId: 'B' });
  assert.deepStrictEqual(relational.relational, filtered.careerStatsFiltered(activeSession(records, S), 'A', { statId: 'foldToThreeBet', counterpartMode: 'specific', counterpartPlayerId: 'B' }));
  assert.strictEqual(relational.core.counters.hands, 15, 'relational selection is a separate result from core stats');
  var career = await service.careerStatsFiltered('A', {});
  assert.strictEqual(career.counters.hands, 19);
  assert.strictEqual(career.coverage.activeRecordCount > detail.core.coverage.activeRecordCount, true);
  for (var invalid of [null, '', 'BAD']) assert.throws(function () { indexed.careerSessionPlayerStatsFromRecords(records, invalid, 'A'); }, TypeError);
  for (var invalidFilters of [{ tableSize: 'UNKNOWN' }, { position: 'NOPE' }, { situation: 'bad' }, { position: 'BTN', situation: 'ip' }, { statId: 'vpip' }, { statId: 'foldToThreeBet' }, { counterpartPlayerId: 'B' }, { extra: 1 }, { tableSize: 3 }]) assert.throws(function () { indexed.careerSessionPlayerStatsFromRecords(records, S, 'A', invalidFilters); }, TypeError);
  assert.throws(function () { indexed.listCareerSessionPlayerSummariesFromRecords(records, ''); }, TypeError);
  var wire = indexed.createMessageService({ sendMessage: function (message, callback) {
    assert.strictEqual(message.type, indexed.MESSAGE_TYPE);
    Promise.resolve().then(function () { return service[message.method].apply(service, message.args); }).then(function (value) { callback({ ok: true, value: value }); }, function (error) { callback({ ok: false, error: error.message }); });
  } });
  assert.deepStrictEqual(await wire.listCareerSessionPlayerSummaries('A'), history, 'message proxy retains the structured list contract');
  assert.deepStrictEqual(await wire.getCareerSessionPlayerStats(S, 'A', { tableSize: 'HU' }), hu, 'message proxy retains the filtered detail contract');
  await assert.rejects(wire.getCareerSessionPlayerStats('bad-id', 'A'), /canonical historical Session ID/, 'malformed worker request rejects cleanly');

  var corrected = hand('S-4', S, 104, ['A', 'B'], { versions: { preflop: 2 } });
  corrected.supersedesFingerprint = records[3].fingerprint;
  corrected.players[0].counters.vpipMade = 1;
  corrected.fingerprint = aggregator.fingerprint(corrected);
  var prior = structuredClone(records[3]); prior.semanticVersions.preflop = 1; prior.fingerprint = aggregator.fingerprint(prior);
  corrected.supersedesFingerprint = prior.fingerprint; corrected.fingerprint = aggregator.fingerprint(corrected);
  var superseded = records.map(function (record) { return record.handKey === prior.handKey ? prior : record; }).concat([corrected, structuredClone(corrected)]);
  assert.strictEqual(aggregator.resolveActiveRecords(superseded).activeRecords.length, records.length);
  var correctedDetail = indexed.careerSessionPlayerStatsFromRecords(superseded, S, 'A');
  parity(correctedDetail, superseded, 'A');
  assert.strictEqual(correctedDetail.core.counters.vpipMade, detail.core.counters.vpipMade + 1);
  assert.strictEqual(correctedDetail.session.sessionHandCount, 15);
  var cross = structuredClone(corrected); cross.session.sessionId = T; cross.semanticVersions.preflop = 3; cross.supersedesFingerprint = corrected.fingerprint; cross.fingerprint = aggregator.fingerprint(cross);
  assert.match(aggregator.validateTransition(corrected, cross), /cross-session/);
  var quarantine = indexed.listCareerSessionPlayerSummariesFromRecords(superseded.concat([cross]), 'A');
  assert.strictEqual(quarantine.sessions.find(function (item) { return item.sessionId === S; }).sessionHandCount, 14, 'cross-Session conflict cannot double-count or relocate a hand');

  var restored = indexed.createMemoryService({}, { initializedAt: 1 });
  await restored.replaceCareerRecords(records, metadata(records));
  assert.deepStrictEqual(await restored.listCareerSessionPlayerSummaries('A'), history, 'Restore Replace matches fresh authoritative derivation');
  var imported = hand('IMPORT', U, 250, ['A', 'C']);
  await restored.mergeCareerRecords(records.concat([imported]), metadata(records.concat([imported])));
  var afterImport = await restored.exportCareer();
  assert.deepStrictEqual(await restored.listCareerSessionPlayerSummaries('A'), indexed.listCareerSessionPlayerSummariesFromRecords(afterImport.records, 'A'), 'Import Merge matches final authoritative population');
  parity(await restored.getCareerSessionPlayerStats(U, 'A'), afterImport.records, 'A');
  var exact = await service.getCareerSessionRecords(S);
  assert.deepStrictEqual(exact.map(function (record) { return record.handKey; }).sort(), activeSession(records, S).map(function (record) { return record.handKey; }).sort(), 'exact logical hands are available for a future deletion preview');
  assert.deepStrictEqual(Array.from(new Set(exact.flatMap(function (record) { return record.players.filter(function (entry) { return entry.counters.hands > 0; }).map(function (entry) { return entry.playerId; }); }))).sort(), ['A', 'B', 'C']);
  await service.removeCareerHandKeys(exact.map(function (record) { return record.handKey; }));
  assert.strictEqual(await service.getCareerSessionPlayerStats(S, 'A'), null);
  assert.deepStrictEqual((await service.listCareerSessionPlayerSummaries('A')).sessions.map(function (item) { return item.sessionId; }), [T, U]);
  assert.deepStrictEqual((await service.careerStats('A')).counters, aggregator.rebuild((await service.exportCareer()).records).aggregate.players.A.counters);

  var strong = [];
  for (var n = 0; n < 100; n += 1) strong.push(hand('STRONG-' + n, U, 1000 + n, ['A', 'B'], { conditional: n < 40 }));
  var strongDetail = indexed.careerSessionPlayerStatsFromRecords(strong, U, 'A', { tableSize: 'HU' });
  assert.strictEqual(cards(strongDetail.core).foldToThreeBet.evidence.status, 'strong');
  assert.strictEqual(cards(detail.core).foldToThreeBet.evidence.status, 'insufficient', 'Career/other-Session strength never leaks into weak Session');
  assert.strictEqual(strongDetail.profileStats.counters.hands, 100);
  assert(insights.derive({ cards: dashboard.fromCareer(strongDetail.core, overall), source: 'career', context: overall, tableSize: 'HU', tableSizeSupported: true }).length > 0, 'supported Session can feed existing Insights');
  assert.strictEqual(dashboard.careerProfile(strongDetail.profileStats, classifier, presentation, explanation).hands, 100, 'Profile consumes Session-scoped projection');
  assert.strictEqual(dashboard.careerProfile(hu.profileStats, classifier, presentation, explanation).hands, 10, 'weak Session Profile remains scoped');

  for (var scale of [{ sessions: 10, hands: 10 }, { sessions: 50, hands: 10 }, { sessions: 50, hands: 50 }]) {
    var generated = [];
    for (var s = 1; s <= scale.sessions; s += 1) for (var h = 1; h <= scale.hands; h += 1) generated.push(hand('PERF-' + s + '-' + h, '00000000-0000-4000-8000-' + String(s).padStart(12, '0'), 10000 + s * 100 + h, ['A', 'B']));
    var started = performance.now();
    var measured = indexed.listCareerSessionPlayerSummariesFromRecords(generated, 'A');
    var milliseconds = Math.round((performance.now() - started) * 10) / 10;
    assert.strictEqual(measured.sessions.length, scale.sessions);
    assert.strictEqual(measured.query.historyTraversals, 1);
    assert.strictEqual(measured.query.resolverPasses, 1);
    assert.strictEqual(measured.query.physicalRecordsRead, generated.length);
    console.log('Session model performance: sessions=' + scale.sessions + ' records=' + generated.length + ' historyTraversals=' + measured.query.historyTraversals + ' runtimeMs=' + milliseconds);
  }
  console.log('Historical per-player Session model, scoped statistics, lifecycle parity, Evidence and Profile compatibility passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
