'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var overlayStats = require('./overlayStats.js');
var seatOverlay = require('./seatOverlay.js');
var leaderboardStats = require('./leaderboardStats.js');
var settings = require('./settingsUi.js');

function labels(rows) {
  return rows.map(function (row) { return row.map(function (item) { return item.label; }); });
}

var opportunityIds = ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet'];
var emptyStats = { handsPlayed: 0, vpip: 0, pfr: 0, af: 0 };
var emptySeatLabels = seatOverlay.compactStatLabels(emptyStats, opportunityIds);
var emptyLeaderboardValues = leaderboardStats.definitions(opportunityIds).map(function (definition) {
  return leaderboardStats.formatValue(definition, emptyStats);
});

assert.strictEqual(overlayStats.UNAVAILABLE_PLACEHOLDER, '---');
assert.deepStrictEqual(emptySeatLabels, ['3B ---', 'F3B ---', 'CB ---', 'FCB ---']);
assert.deepStrictEqual(emptyLeaderboardValues, ['---', '---', '---', '---']);
emptySeatLabels.concat(emptyLeaderboardValues).forEach(function (value) {
  assert.ok(value.includes('---'), 'zero-opportunity output uses three ASCII hyphens');
  assert.ok(!value.includes('\u2014') && !value.includes('0%') && !value.includes('(0/0)'), 'visible zero-opportunity output contains no alternate placeholder');
});
assert.deepStrictEqual(seatOverlay.compactStatLabels(emptyStats, ['hands', 'vpip', 'pfr', 'af']), ['H 0', 'VPIP ---', 'PFR ---', 'AF ---'], 'statistics without an observed hand are unavailable');

var values = {
  handsPlayed: 42, vpip: 88, pfr: 71, af: 0,
  threeBetMade: 2, threeBetOpportunities: 4,
  foldToThreeBet: 2, foldToThreeBetOpportunities: 4,
  flopCBetMade: 8, flopCBetOpportunities: 13,
  foldToFlopCBet: 4, foldToFlopCBetOpportunities: 9,
  wentToShowdown: 7, sawFlopForWTSD: 24,
  wonMoneyAtShowdown: 6, showdownsForWSD: 11
};
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, overlayStats.DEFAULT_DISPLAYED_STAT_IDS, 'combined')), [
  ['H 42', 'VPIP 88%', 'PFR 71%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
]);
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, ['foldToThreeBet'], 'combined')), [['F3B 50%']]);
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, ['threeBet', 'flopCBet'], 'combined')), [['3B 50%', 'CB 62%']]);
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, ['foldToThreeBet', 'foldToFlopCBet'], 'combined')), [['F3B 50%', 'FCB 44%']]);
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, ['hands', 'vpip', 'pfr', 'af'], 'combined')), [['H 42', 'VPIP 88%', 'PFR 71%', 'AF 0.0']], 'hiding all four opportunity stats leaves no blank opportunity row');
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, [], 'combined')), []);
assert.deepStrictEqual(labels(seatOverlay.compactStatRows(values, overlayStats.DEFAULT_DISPLAYED_STAT_IDS, 'stacked')), [
  ['H 42', 'VPIP 88%', 'PFR 71%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%'],
  ['CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
]);

var defaults = settings.normalize(undefined);
assert.strictEqual(defaults.value.opportunityStatsLayout, 'combined');
var legacy = settings.normalize({
  version: 2,
  settingsOpen: true,
  selectedSettingsSection: 'overlay',
  hudOpacity: 0.72,
  settingsBackgroundOpacity: 0.61,
  accentTheme: 'purple',
  hudSize: 'large',
  developerToolsVisible: true,
  leaderboardCollapsedByDefault: true
});
assert.strictEqual(legacy.value.opportunityStatsLayout, 'combined');
assert.deepStrictEqual([legacy.value.settingsOpen, legacy.value.selectedSettingsSection, legacy.value.hudOpacity, legacy.value.accentTheme, legacy.value.hudSize], [true, 'overlay', 0.72, 'purple', 'large'], 'legacy UI preferences retain every existing field');
assert.deepStrictEqual(overlayStats.normalizePreference({ version: 2, displayedStatIds: ['pfr', 'threeBet', 'flopCBet'] }).normalizedDisplayedStatIds, ['pfr', 'threeBet', 'flopCBet', 'wtsd', 'wsd'], 'legacy visibility order is retained while new showdown defaults are appended');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
assert.ok(isolated && isolated.js.indexOf('settingsUi.js') < isolated.js.indexOf('seatOverlay.js') && isolated.js.indexOf('seatOverlay.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes('PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout)'), 'the browser seat renderer consumes the selected layout');
assert.ok(content.includes('opportunityStatsLayout: hudUiPreferences.opportunityStatsLayout'), 'the selected layout reaches every production seat entry');
assert.ok(content.includes('statTooltipTargetHtml(item.definition, item.label, playerKey, entry.statSource)'), 'every rendered segment retains its selected Session/Career tooltip scope');
assert.ok(content.includes('Opportunity stats layout') && content.includes('>Combined</option>') && content.includes('>Stacked</option>'));

var overlayLayer = css.match(/#pnhud-overlay-root\s*\{[^}]*z-index:\s*([^;]+)/);
var settingsLayer = css.match(/#pnhud-settings-panel\s*\{[^}]*z-index:\s*(\d+)/);
var leaderboardLayer = css.match(/#pokernow-stats-hud-root\s*\{[^}]*z-index:\s*(\d+)/);
var leaderboardToggleLayer = css.match(/\.pnhud-toggle\s*\{[^}]*z-index:\s*(\d+)/);
assert.ok(overlayLayer && settingsLayer && leaderboardLayer && leaderboardToggleLayer);
assert.strictEqual(Number(overlayLayer[1]), 2147483643, 'seat overlays sit above PokerNow surfaces, including Chat');
assert.strictEqual(Number(settingsLayer[1]), 2147483647, 'Settings remains above seat overlays');
assert.strictEqual(Number(leaderboardLayer[1]), 2147483645, 'leaderboard stays above seat overlays without covering its launcher');
assert.strictEqual(Number(leaderboardToggleLayer[1]), 2147483646, 'the top-right leaderboard launcher remains above the leaderboard surface');
assert.ok(Number(overlayLayer[1]) < Number(leaderboardLayer[1]) && Number(overlayLayer[1]) < Number(settingsLayer[1]), 'extension-owned dashboards and Settings remain above seat overlays');
assert.ok(css.includes('#pnhud-overlay-root .pnhud-seat-overlay') && css.includes('pointer-events: auto'), 'seat dragging and interaction remain enabled');
assert.ok(css.includes('.pnhud-seat-stat-row { display: inline-flex; flex-wrap: wrap;'), 'the combined row wraps rather than clipping when space is constrained');
assert.ok(!/text-decoration:\s*underline\s+dotted|border-bottom:\s*[^;]*dotted/.test(css), 'no dotted underline is introduced');

assert.deepStrictEqual(seatOverlay.compactStatLabels(values, ['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']), ['VPIP 88%', 'PFR 71%', 'AF 0.0', '3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%'], 'all statistic values remain value-for-value unchanged');

console.log('Production HUD placeholder, opportunity-row layout, preference migration, stacking, and neutrality tests passed.');
