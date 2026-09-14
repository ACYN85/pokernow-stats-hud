'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var filtered = require('./filteredStats.js');
var dashboard = require('./playerDashboard.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function hand(index, at, playerId, counters) {
  var id = String(index).padStart(4, '0');
  var record = fixtures.record('TRENDS', 'H-' + id, [fixtures.player(playerId || 'subject', 'Subject', counters || {}), fixtures.player('villain-' + id, 'Villain')], { finalizedAt: at || 1000 });
  record.finalizedAt = at;
  record.fingerprint = aggregator.fingerprint(record);
  assert.strictEqual(aggregator.validateRecord(record), null);
  return record;
}
function many(count, offset) { return Array.from({ length: count }, function (_, index) { return hand((offset || 0) + index + 1, 100000 + (offset || 0) + index + 1); }); }

var records = many(300);
records.slice(-25).forEach(function (record, index) {
  var entry = record.players[0];
  Object.assign(entry.counters, { vpipMade: 1, pfrMade: index < 15 ? 1 : 0, postflopAggressiveActions: 2, postflopCalls: 1, threeBetMade: index < 5 ? 1 : 0, threeBetOpportunities: 1, foldToThreeBet: index < 4 ? 1 : 0, foldToThreeBetOpportunities: 1, flopCBetMade: index < 10 ? 1 : 0, flopCBetOpportunities: 1, foldToFlopCBet: index < 8 ? 1 : 0, foldToFlopCBetOpportunities: 1, wtsdMade: index < 12 ? 1 : 0, wtsdOpportunities: 1, wsdMade: index < 6 ? 1 : 0, wsdOpportunities: index < 12 ? 1 : 0 });
  record.fingerprint = aggregator.fingerprint(record);
});
records = records.slice().sort(function (left, right) { return left.authoritativeHandId < right.authoritativeHandId ? 1 : -1; });
var trends = filtered.careerTrendStats(records, 'subject');
assert.deepStrictEqual(trends.availableWindows, [25, 50, 100, 250]);
assert.strictEqual(trends.defaultWindow, 100);
assert.deepStrictEqual([trends.windows['25'].stats.counters.hands, trends.windows['50'].stats.counters.hands, trends.windows['100'].stats.counters.hands, trends.windows['250'].stats.counters.hands], [25, 50, 100, 250]);
assert.deepStrictEqual([trends.windows['25'].stats.derived.vpip, trends.windows['50'].stats.derived.vpip, trends.windows['100'].stats.derived.vpip, trends.windows['250'].stats.derived.vpip], [100, 50, 25, 10], 'nested windows use timestamp order rather than insertion order');
assert.deepStrictEqual(trends.windows['25'].stats.derived, { vpip: 100, pfr: 60, af: 2, threeBet: 20, foldToThreeBet: 16, flopCBet: 40, foldToFlopCBet: 32, wtsd: 48, wsd: 50 });
assert.strictEqual(trends.baseline.counters.hands, 300, 'all-Career baseline remains unchanged');
assert.strictEqual(trends.query.resolverPasses, 1); assert.strictEqual(trends.query.windowAggregateBuilds, 4);

var ties = many(26, 1000); ties.forEach(function (record) { record.finalizedAt = 7777; record.fingerprint = aggregator.fingerprint(record); }); ties[0].players[0].counters.vpipMade = 1; ties[0].fingerprint = aggregator.fingerprint(ties[0]);
var tiedForward = filtered.careerTrendStats(ties, 'subject').windows['25'].stats.counters.vpipMade;
var tiedReverse = filtered.careerTrendStats(ties.slice().reverse(), 'subject').windows['25'].stats.counters.vpipMade;
assert.strictEqual(tiedForward, 0); assert.strictEqual(tiedReverse, 0, 'timestamp ties use deterministic hand identity rather than physical order');

var dated = many(25, 2000); var undated = hand(9997, null, 'subject', { vpipMade: 1 }); undated.schemaVersion = 1; undated.players.forEach(function (entry) { delete entry.position; delete entry.relational; }); undated.fingerprint = aggregator.fingerprint(undated);
var invalidTimestamp = hand(9998, 999998, 'subject', { vpipMade: 1 }); invalidTimestamp.finalizedAt = 'not-authoritative'; invalidTimestamp.fingerprint = aggregator.fingerprint(invalidTimestamp);
var wrongPlayer = hand(9999, 999999, 'other-player', { vpipMade: 1 });
var withUndated = filtered.careerTrendStats([wrongPlayer, undated, invalidTimestamp].concat(dated), 'subject');
assert.deepStrictEqual([withUndated.totalCareerHands, withUndated.datedHands, withUndated.undatedHands], [27, 25, 2]);
assert.strictEqual(withUndated.windows['25'].stats.counters.vpipMade, 0, 'undated and other-player hands cannot enter the recent window');
assert.strictEqual(withUndated.baseline.counters.vpipMade, 2, 'legacy and malformed-timestamp hands remain in all-Career baseline');

var root = hand(5000, 999999, 'subject', { vpipMade: 1 }); root.semanticVersions.preflop = 1; root.fingerprint = aggregator.fingerprint(root);
var successor = structuredClone(root); successor.semanticVersions.preflop = 2; successor.supersedesFingerprint = root.fingerprint; successor.finalizedAt = 1; successor.players[0].counters.vpipMade = 0; successor.fingerprint = aggregator.fingerprint(successor);
var resolved = filtered.careerTrendStats(many(25, 3000).concat([root, successor]), 'subject');
assert.strictEqual(resolved.totalCareerHands, 26); assert.strictEqual(resolved.windows['25'].stats.counters.vpipMade, 0, 'active successor replaces predecessor and uses successor chronology');
var conflict = structuredClone(successor); conflict.supersedesFingerprint = root.fingerprint; conflict.players[0].counters.pfrMade = 1; conflict.fingerprint = aggregator.fingerprint(conflict);
var quarantined = filtered.careerTrendStats(many(25, 4000).concat([root, successor, conflict]), 'subject');
assert.strictEqual(quarantined.totalCareerHands, 25); assert.strictEqual(quarantined.resolution.quarantinedHandCount, 1, 'conflicting logical hand is excluded before chronology');

[[20, []], [30, [25]], [75, [25, 50]], [180, [25, 50, 100]], [500, [25, 50, 100, 250]]].forEach(function (entry) {
  var result = filtered.careerTrendStats(many(entry[0], 10000 + entry[0] * 10), 'subject');
  assert.deepStrictEqual(result.availableWindows, entry[1]);
  assert.strictEqual(result.defaultWindow, entry[0] >= 100 ? 100 : entry[0] >= 50 ? 50 : entry[0] >= 25 ? 25 : null);
});

assert.strictEqual(dashboard.trendDelta('vpip', { derived: { vpip: 48 } }, { derived: { vpip: 38.6 } }), '+9.4 pp');
assert.strictEqual(dashboard.trendDelta('af', { derived: { af: 2.4 } }, { derived: { af: 1.8 } }), '+0.6');
assert.strictEqual(dashboard.trendDelta('threeBet', { derived: { threeBet: null } }, { derived: { threeBet: 10 } }), null);
assert.strictEqual(dashboard.selectTrendWindow({ availableWindows: [25, 50, 100, 250] }, null), 100);
assert.strictEqual(dashboard.selectTrendWindow({ availableWindows: [25, 50] }, 100), 50);

function trendSection(html) { var start = html.indexOf('<section class="pnhud-dashboard-section pnhud-dashboard-trends">'); var end = html.indexOf('<section class="pnhud-dashboard-section pnhud-dashboard-relational">'); return html.slice(start, end); }
var baseState = { open: true, playerId: 'subject', displayName: 'Subject', mode: 'career', trends: trends, trendWindow: 100, coreStats: { counters: aggregator.emptyCounters(), coverage: {} }, profile: { displayedArchetype: 'TAG' }, noteDraft: 'keep' };
var baseHtml = dashboard.render(baseState); assert.match(baseHtml, /Recent trends/); assert.match(baseHtml, /Last 100 of 300 Career hands/); assert.match(baseHtml, /No supported delta|pp|Career/); assert.match(baseHtml, /50 aggressive \/ 25 calls/);
assert.strictEqual(trendSection(dashboard.render(Object.assign({}, baseState, { position: 'BTN' }))), trendSection(dashboard.render(Object.assign({}, baseState, { situation: 'ip', position: null, opponentMode: 'self', selfPlayerId: 'me' }))));
assert.doesNotMatch(dashboard.render(Object.assign({}, baseState, { mode: 'session', sessionStats: {} })), /Recent trends/, 'Session does not masquerade as Career trends');
assert.match(dashboard.render(Object.assign({}, baseState, { trends: filtered.careerTrendStats(many(20, 20000), 'subject'), trendWindow: null })), /Not enough dated Career history/);

console.log('Career Trends chronology, nested windows, resolution, undated baseline, stat semantics, deltas, availability and UI ownership passed.');
