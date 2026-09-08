'use strict';

var assert = require('assert');
var fs = require('fs');
var support = require('./testSupport/productionContentScriptHarness');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var gameId = 'visible-flop-cbet-restore';
var keys = support.storageKeys(gameId);
var storage = {};
storage[keys.schema] = 4;
storage[keys.playerMap] = { P1: 'Alice', P2: 'Legacy' };
storage[keys.liveEvents] = Array.from({ length: 13 }, function (_unused, index) {
  return {
    handId: 'visible-hand-' + (index + 1), playerId: 'P1', player: 'Alice', action: 'dealt', street: 'preflop', amount: 0, timestamp: index + 1,
    threeBetMade: index < 2 ? 1 : 0, threeBetOpportunities: index < 4 ? 1 : 0,
    foldToThreeBet: index < 2 ? 1 : 0, foldToThreeBetOpportunities: index < 4 ? 1 : 0,
    flopCBetMade: index < 8 ? 1 : 0, flopCBetOpportunities: 1,
    foldToFlopCBet: index < 4 ? 1 : 0, foldToFlopCBetOpportunities: index < 9 ? 1 : 0
  };
});
storage[keys.liveEvents].push({ handId: 'legacy-hand', playerId: 'P2', player: 'Legacy', action: 'dealt', street: 'preflop', amount: 0, timestamp: 20 });
storage[keys.finalizedHandIds] = storage[keys.liveEvents].map(function (event) { return event.handId; });
storage.pokerNowHudDisplayMode = 'seat-overlays-leaderboard';
storage.overlayStatPreferences = { version: 2, displayedStatIds: ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet'] };
storage.leaderboardStatPreferences = { version: 1, syncWithOverlay: false, displayedStatIds: ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet'] };

var harness = support.createHarness({ gameId: gameId, initialStorage: storage, debugEnabled: true });
assert.deepStrictEqual(harness.evaluationErrors, [], 'the exact production manifest order restores the validated visible integration without an exception');

var stats = harness.context.PokerStats;
var seat = harness.context.PokerSeatOverlay;
var leaderboard = harness.context.PokerLeaderboardStats;
var registry = harness.context.PokerOverlayStats;
var tooltip = harness.context.PokerStatTooltip;
var alice = stats.computePlayerStats(harness.storage[keys.liveEvents], 'Alice');
var legacy = stats.computePlayerStats(harness.storage[keys.liveEvents], 'Legacy');

assert.deepStrictEqual(plain([
  alice.vpip, alice.pfr, alice.af,
  alice.threeBetMade, alice.threeBetOpportunities, alice.foldToThreeBet, alice.foldToThreeBetOpportunities
]), [0, 0, 0, 2, 4, 2, 4], 'restoration leaves VPIP/PFR/AF/3B/F3B value-for-value unchanged');

var rows = plain(seat.compactStatRows(alice).map(function (row) {
  return row.map(function (item) { return item.label; });
}));
assert.deepStrictEqual(rows, [
  ['H 13', 'VPIP 0%', 'PFR 0%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%'],
  ['WTSD ---', 'W$SD ---']
], 'restored authoritative counters render through the production seat row formatter');

var definitions = leaderboard.definitions(['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']);
assert.deepStrictEqual(plain(definitions.map(function (definition) {
  return leaderboard.formatValue(definition, alice);
})), ['0.0%', '0.0%', '0.0', '50%', '50%', '62%', '44%'], 'restored counters render through the production leaderboard cell formatter');
assert.deepStrictEqual(plain(leaderboard.definitions(['flopCBet', 'foldToFlopCBet']).map(function (definition) {
  return leaderboard.formatValue(definition, legacy);
})), ['---', '---'], 'legacy restored data renders ASCII unavailable placeholders without NaN');
assert.deepStrictEqual(plain(seat.compactStatLabels(legacy, ['flopCBet', 'foldToFlopCBet'])), ['CB ---', 'FCB ---']);

var cbTooltip = plain(tooltip.buildModel(registry.STAT_CATALOG.flopCBet, alice, { playerName: 'Alice', playerId: 'P1', scope: 'Session', displayedValue: '62%' }));
var fcbTooltip = plain(tooltip.buildModel(registry.STAT_CATALOG.foldToFlopCBet, alice, { playerName: 'Alice', playerId: 'P1', scope: 'Session', displayedValue: '44%' }));
assert.deepStrictEqual([cbTooltip.summary, cbTooltip.numerator.value, cbTooltip.denominator.value, cbTooltip.displayedValue], ['8 made from 13 opportunities', 8, 13, '62%']);
assert.deepStrictEqual([fcbTooltip.summary, fcbTooltip.numerator.value, fcbTooltip.denominator.value, fcbTooltip.displayedValue], ['4 folds from 9 opportunities', 4, 9, '44%']);

assert.deepStrictEqual(plain(harness.storage.overlayStatPreferences.displayedStatIds), storage.overlayStatPreferences.displayedStatIds.concat(['wtsd', 'wsd']), 'stored overlay visibility/order remain intact and gain the new showdown defaults');
assert.deepStrictEqual(plain(harness.storage.leaderboardStatPreferences.displayedStatIds), storage.leaderboardStatPreferences.displayedStatIds.concat(['wtsd', 'wsd']), 'stored independent leaderboard visibility/order remain intact and gain the new showdown defaults');
assert.deepStrictEqual(plain(registry.customizableDefinitionsFor(registry.DEFAULT_DISPLAYED_STAT_IDS).map(function (definition) { return definition.id; })), ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'], 'all visible stats use the existing customization controls');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
assert.ok(content.includes('PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout)'));
assert.ok(content.includes('PokerLeaderboardStats.formatValue(definition, stat)'));
assert.ok(content.includes('class="pnhud-stat-tooltip-target" tabindex="0"'));
assert.ok(content.includes("target.setAttribute('aria-describedby', statTooltipElement.id)"));
assert.ok(content.includes("document.addEventListener('pointerover', handleStatTooltipPointerOver, true)"));
assert.ok(content.includes("document.addEventListener('focusin', handleStatTooltipFocusIn, true)"));
assert.ok(!content.includes('pnhud-af'));
assert.ok(!/text-decoration:\s*underline\s+dotted|border-bottom:\s*[^;]*dotted/.test(css), 'no AF, CB, or FCB dotted underline is present');

console.log('Persisted authoritative CB/FCB counters render through production seat, leaderboard, tooltip, legacy, and preference paths.');
