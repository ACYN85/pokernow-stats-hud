'use strict';
var assert = require('node:assert/strict');
var Filtered = require('./filteredStats.js');
var Dashboard = require('./playerDashboard.js');

function handEvents(hand, size, rate) {
  var slot = hand % 50;
  var action = slot < rate / 2 - 5 ? 'raise' : slot < rate / 2 ? 'call' : 'fold';
  var position = size === 2 ? 'BTN' : 'CO';
  var rows = [{ handId: String(hand), playerId: 'subject', player: 'Subject', action: action,
    street: 'preflop', amount: action === 'fold' ? 0 : 2, positionSchemaVersion: 1,
    dealtPlayerCount: size, dealtPosition: position }];
  for (var i = 1; i < size; i += 1) rows.push({ handId: String(hand), playerId: 'other-' + i,
    player: 'Other ' + i, action: 'check', street: 'preflop', positionSchemaVersion: 1,
    dealtPlayerCount: size, dealtPosition: i === size - 1 ? 'BB' : 'SB' });
  return rows;
}
function history(sizes, rate) {
  var rows = [];
  sizes.forEach(function (size, hand) { rows.push.apply(rows, handEvents(hand, size, rate)); });
  return rows;
}
function dashboard(core, self, tableSize) {
  return Dashboard.render({ open: true, playerId: 'subject', selfPlayerId: self ? 'subject' : 'other',
    displayName: 'Subject', mode: 'session', situation: 'overall', tableSize: tableSize || 'all',
    opponentMode: 'overall', coreStats: core, relationalStats: {}, requestToken: 3 });
}
function sample(rate, size) {
  var result = Filtered.sessionStatsFiltered(history(Array(100).fill(size), rate), 'subject', {});
  assert.equal(result.counters.vpipMade, rate);
  assert.equal(result.coverage.tableSizeHands[size === 2 ? 'HU' : size <= 5 ? '3_TO_5' : 'SIX_PLUS'], 100);
  return result;
}
var hu40 = sample(40, 2); var hu20 = sample(20, 2); var hu80 = sample(80, 2);
var three40 = sample(40, 3); var three60 = sample(60, 3); var six40 = sample(40, 6);
assert.match(dashboard(hu40, false), /VPIP<\/span><strong>40\.0%<\/strong>/);
assert.doesNotMatch(dashboard(hu40, false), /data-insight-id="vpip-high"|implication-vpip-high/);
assert.doesNotMatch(dashboard(hu40, true), /self-vpip-high/);
assert.match(dashboard(hu20, false), /data-insight-id="vpip-low"/);
assert.match(dashboard(hu80, false), /data-insight-id="vpip-high"/);
assert.match(dashboard(hu80, true), /self-vpip-high/);
assert.doesNotMatch(dashboard(three40, false), /data-insight-id="vpip-high"/);
assert.match(dashboard(three60, false), /data-insight-id="vpip-high"/);
assert.match(dashboard(six40, false), /data-insight-id="vpip-high"/);

var mixedRows = history(Array(50).fill(2).concat(Array(50).fill(6)), 40);
var mixed = Filtered.sessionStatsFiltered(mixedRows, 'subject', {});
assert.deepEqual([mixed.counters.hands, mixed.coverage.tableSizeHands.HU, mixed.coverage.tableSizeHands.SIX_PLUS], [100, 50, 50]);
assert.match(dashboard(mixed, false), /Select a table-size segment for calibrated player analysis/);
assert.doesNotMatch(dashboard(mixed, false), /pnhud-dashboard-insights/);
assert.doesNotMatch(dashboard(mixed, true), /pnhud-dashboard-review-signals/);
var hu = Filtered.sessionStatsFiltered(mixedRows, 'subject', { tableSize: 'HU' });
var six = Filtered.sessionStatsFiltered(mixedRows, 'subject', { tableSize: 'SIX_PLUS' });
assert.deepEqual([hu.counters.hands, six.counters.hands], [50, 50]);
assert.doesNotMatch(dashboard(hu, false, 'HU'), /data-insight-id="vpip-high"/);
assert.match(dashboard(six, false, 'SIX_PLUS'), /data-insight-id="vpip-high"/);
var maintained = Filtered.rebuildSessionContexts(mixedRows);
assert.deepEqual(Filtered.sessionContextResult(maintained, 'subject', { tableSize: 'HU' }).counters, hu.counters);
assert.deepEqual(Filtered.sessionContextResult(maintained, 'subject', { tableSize: 'SIX_PLUS' }).counters, six.counters);
var incremental = Filtered.createSessionContextState();
for (var hand = 0; hand < 100; hand += 1) Filtered.appendSessionContextHand(incremental, handEvents(hand, hand < 50 ? 2 : 6, 40));
assert.deepEqual(incremental, maintained);
var situated = handEvents(200, 2, 40).concat(handEvents(201, 6, 40));
situated.filter(function (event) { return event.playerId === 'subject'; }).forEach(function (event) { event.postflopSituation = 'ip'; });
var situatedState = Filtered.rebuildSessionContexts(situated);
for (var size of ['HU', 'SIX_PLUS']) {
  var expected = Filtered.sessionStatsFiltered(situated, 'subject', { tableSize: size, situation: 'ip' });
  var actual = Filtered.sessionContextResult(situatedState, 'subject', { tableSize: size, situation: 'ip' });
  assert.deepEqual(actual, expected, size + ' × IP maintained Session result matches direct filtering');
}
var weak = structuredClone(hu80); weak.counters.vpipMade = 10; weak.counters.vpipOpportunities = 14;
assert.doesNotMatch(dashboard(weak, false), /data-insight-id="vpip-high"/);
var switched = { open: true, playerId: 'subject', mode: 'career', position: null, situation: 'overall', tableSize: 'HU', opponentMode: 'overall', requestToken: 3 };
var snapshot = { playerId: 'subject', mode: 'career', position: null, situation: 'overall', tableSize: 'HU', opponentMode: 'overall', requestToken: 3 };
assert.equal(Dashboard.requestMatches(switched, snapshot), true);
switched.tableSize = 'SIX_PLUS'; assert.equal(Dashboard.requestMatches(switched, snapshot), false);
console.log('Disjoint table-size populations, HU calibration, mixed All, Session equivalence, Evidence, and request fencing passed.');
