'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var settings = require('./settingsUi.js');
var leaderboard = require('./leaderboardStats.js');
var overlays = require('./overlayStats.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
var renderStart = content.indexOf('  function render(saved)');
var renderEnd = content.indexOf('  function healthPanelHtml', renderStart);
var renderer = content.slice(renderStart, renderEnd);

assert.ok(isolated.js.includes('leaderboardStats.js'));
assert.ok(isolated.js.indexOf('overlayStats.js') < isolated.js.indexOf('leaderboardStats.js'));
assert.ok(isolated.js.indexOf('leaderboardStats.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("leaderboardStatPreferences: 'leaderboardStatPreferences'"));
assert.ok(content.includes('leaderboardStatCustomizerHtml()'));
assert.ok(content.includes('bindLeaderboardStatCustomizer(settingsPanel)'));
assert.ok(content.includes('updateLeaderboardStatIds(next'));
assert.ok(content.includes('updateLeaderboardSync(event.target.checked'));
assert.ok(content.includes('PokerLeaderboardStats.definitions(effectiveLeaderboardStatIds())'));
assert.ok(content.includes('PokerLeaderboardStats.formatValue(definition, stat)'));
assert.ok(renderer.includes("var tableHeaderHtml = '<th>Player</th>'"));
assert.ok(renderer.includes('leaderboardDefinitions.map'));
assert.ok(renderer.includes('leaderboardDefinitions.length + 1'));
assert.ok(renderer.includes('pnhud-table-scroll'));
assert.strictEqual((renderer.match(/host\.innerHTML\s*=/g) || []).length, 1, 'one leaderboard render owner');
assert.ok(content.includes("lastPreferenceChangeSource: source || 'unknown'"));
assert.ok(content.includes('leaderboardStatPreferences: cloneJson(leaderboardStatPreferenceDiagnostics)'));
assert.ok(content.includes('settingsLayout: layoutDiagnostics'));
assert.ok(content.includes('if (sameStringArray(leaderboardStatPreferences.displayedStatIds'), 'no-op leaderboard changes avoid storage writes');
assert.ok(content.includes("source === 'storage-restore' ? 'storage-restore' : 'overlay-preference-propagation'"));
assert.ok(content.includes('settingsPanel.dataset.pnhudSettingsBound'), 'settings listeners remain delegated and singular');

var defaultWidth = settings.SIZE_PRESETS.default.baseWidth + settings.SIZE_PRESETS.default.perStatWidth * 4;
var smallWidth = settings.SIZE_PRESETS.small.baseWidth + settings.SIZE_PRESETS.small.perStatWidth * 4;
assert.ok(smallWidth <= defaultWidth * 0.8, 'small preferred width is at least 20% narrower for four stats');
assert.ok(css.includes('overflow-x: auto'), 'future wide tables have contained overflow');
assert.ok(css.includes('width: min(var(--pnhud-hud-width'), 'HUD width is viewport clamped');
assert.ok(!css.includes('transform: scale('), 'size presets do not blur via transform scaling');

var renderedCounters = {
  handsPlayed: 40,
  vpip: 31.25,
  pfr: 18.75,
  af: 2.5,
  threeBetMade: 2,
  threeBetOpportunities: 4,
  foldToThreeBet: 2,
  foldToThreeBetOpportunities: 4,
  flopCBetMade: 8,
  flopCBetOpportunities: 13,
  foldToFlopCBet: 4,
  foldToFlopCBetOpportunities: 9
};
var renderedBefore = JSON.parse(JSON.stringify(renderedCounters));
var renderedDefinitions = leaderboard.definitions(['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']);
assert.deepStrictEqual(renderedDefinitions.map(function (definition) {
  return leaderboard.formatValue(definition, renderedCounters);
}), ['31.3%', '18.8%', '2.5', '50%', '50%', '62%', '44%'], 'the exact live table-cell formatter keeps existing stats unchanged and renders compact CB/FCB values');
assert.deepStrictEqual(leaderboard.definitions(['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']).map(function (definition) {
  return leaderboard.formatValue(definition, {});
}), ['---', '---', '---', '---'], 'zero-opportunity leaderboard cells render three ASCII hyphens only');
assert.deepStrictEqual(renderedCounters, renderedBefore, 'leaderboard presentation does not mutate authoritative counters');
assert.strictEqual(overlays.formatStat(overlays.STAT_CATALOG.threeBet, renderedCounters), '3B 50% (2/4)', 'the shared detailed value remains available to tooltip/detail consumers');
assert.strictEqual(overlays.formatStat(overlays.STAT_CATALOG.foldToThreeBet, renderedCounters), 'F3B 50% (2/4)', 'Fold-to-3Bet tooltip/detail data remains detailed');
assert.strictEqual(overlays.formatStat(overlays.STAT_CATALOG.flopCBet, renderedCounters), 'CB 62% (8/13)', 'Flop CBet tooltip/detail data remains detailed');
assert.strictEqual(overlays.formatStat(overlays.STAT_CATALOG.foldToFlopCBet, renderedCounters), 'FCB 44% (4/9)', 'Fold-to-Flop-CBet tooltip/detail data remains detailed');
assert.deepStrictEqual(overlays.customizableDefinitionsFor(overlays.DEFAULT_DISPLAYED_STAT_IDS).map(function (definition) { return definition.id; }), ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'], 'all leaderboard columns continue through the existing visibility architecture');
assert.ok(!/text-decoration:\s*underline|border-bottom:\s*[^;]*dotted/.test(css), 'CB/FCB do not reintroduce dotted tooltip decoration');
console.log('Dynamic leaderboard production ownership, sizing, and diagnostics tests passed.');
