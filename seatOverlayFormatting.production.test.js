'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var overlayStats = require('./overlayStats.js');
var leaderboardStats = require('./leaderboardStats.js');
var seatOverlay = require('./seatOverlay.js');

var contentSource = fs.readFileSync('./content.js', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) {
  return entry.js.includes('content.js');
});

assert.ok(isolated, 'the isolated-world production content-script entry exists');
assert.ok(isolated.js.includes('seatOverlay.js'), 'production packages the root seatOverlay.js file');
assert.ok(isolated.js.indexOf('overlayStats.js') < isolated.js.indexOf('seatOverlay.js'), 'the shared catalog loads before the seat formatter');
assert.ok(isolated.js.indexOf('seatOverlay.js') < isolated.js.indexOf('content.js'), 'the seat formatter loads before the live DOM renderer');

var seatRendererSource = contentSource.slice(
  contentSource.indexOf('function seatOverlayContent(entry)'),
  contentSource.indexOf('function overlayStatItemHtml(')
);
assert.ok(seatRendererSource.includes('PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout)'), 'the live seatOverlayContent path obtains compact row-grouped labels using the selected opportunity layout');
assert.ok(seatRendererSource.includes('statTooltipTargetHtml(item.definition, item.label, playerKey, entry.statSource)'), 'the exact compact label and selected source reach the live seat-overlay tooltip path');
assert.ok(!seatRendererSource.includes('definition.formatValue(definition.getValue(entry.stats))'), 'the live seat renderer no longer bypasses the seat-only formatter');

var counters = {
  handsPlayed: 42,
  vpip: 88,
  pfr: 71,
  af: 0,
  threeBetMade: 2,
  threeBetOpportunities: 4,
  foldToThreeBet: 2,
  foldToThreeBetOpportunities: 4,
  flopCBetMade: 8,
  flopCBetOpportunities: 13,
  foldToFlopCBet: 4,
  foldToFlopCBetOpportunities: 9
};
var countersBefore = JSON.parse(JSON.stringify(counters));
var ids = ['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet'];

assert.deepStrictEqual(seatOverlay.compactStatLabels(counters, ids), ['VPIP 88%', 'PFR 71%', 'AF 0.0', '3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%']);
assert.strictEqual(seatOverlay.compactStatsLabel(counters, ids), 'VPIP 88% | PFR 71% | AF 0.0 | 3B 50% | F3B 50% | CB 62% | FCB 44%');
assert.deepStrictEqual(seatOverlay.compactStatRows(counters, ids).map(function (row) { return row.map(function (item) { return item.label; }); }), [
  ['VPIP 88%', 'PFR 71%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%']
]);
assert.deepStrictEqual(seatOverlay.compactStatLabels({}, ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']), ['3B ---', 'F3B ---', 'CB ---', 'FCB ---']);
assert.deepStrictEqual(counters, countersBefore, 'seat formatting does not mutate authoritative counters');

var definitions = leaderboardStats.definitions(['threeBet', 'foldToThreeBet']);
assert.deepStrictEqual(definitions.map(function (definition) {
  return leaderboardStats.formatValue(definition, counters);
}), ['50%', '50%'], 'leaderboard formatting is compact');
assert.strictEqual(overlayStats.formatOverlay(counters, ['threeBet', 'foldToThreeBet']), '3B 50% (2/4) | F3B 50% (2/4)', 'the shared detailed formatter used by non-seat consumers remains unchanged');
assert.deepStrictEqual(leaderboardStats.definitions(['flopCBet', 'foldToFlopCBet']).map(function (definition) {
  return leaderboardStats.formatValue(definition, counters);
}), ['62%', '44%'], 'the manifest-loaded leaderboard formatter is compact for CB/FCB');

console.log('Manifest-loaded live seat-overlay rendering path uses compact 3B/F3B/CB/FCB labels and explicit rows.');
