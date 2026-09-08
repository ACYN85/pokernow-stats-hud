'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var statsEngine = require('./stats.js');
var registry = require('./overlayStats.js');
var seatOverlay = require('./seatOverlay.js');
var leaderboard = require('./leaderboardStats.js');
var tooltip = require('./statTooltip.js');

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function rowLabels(stats, ids, layout) {
  return plain(seatOverlay.compactStatRows(stats, ids, layout).map(function (row) {
    return row.map(function (item) { return item.label; });
  }));
}

function renderSeatThroughContent(entry, content) {
  var start = content.indexOf('  function seatOverlayContent(entry)');
  var end = content.indexOf('  function overlayStatItemHtml(', start);
  assert.ok(start >= 0 && end > start, 'the real content.js seat renderer can be isolated');
  var context = {
    PokerOverlayStats: registry,
    PokerSeatOverlay: seatOverlay,
    debugSeatIdentity: false,
    currentStatsScope: 'session',
    preflopDebug: function () {},
    preflopCounterFields: function (value) { return value; },
    escapeHtml: function (value) { return String(value); },
    registerTooltipPlayer: function () { return 'player:test'; },
    statTooltipTargetHtml: function (definition, value) { return '<span tabindex="0" data-stat="' + definition.id + '">' + value + '</span>'; },
    entry: entry,
    rendered: null
  };
  vm.runInNewContext(content.slice(start, end) + '\nrendered = seatOverlayContent(entry);', context);
  return context.rendered;
}

function renderLeaderboardCellsThroughContent(playerStats, definitions, content) {
  var start = content.indexOf('      var cells = leaderboardDefinitions.map');
  var end = content.indexOf("      return '<tr><td>'", start);
  assert.ok(start >= 0 && end > start, 'the real content.js leaderboard renderer can be isolated');
  var context = {
    PokerLeaderboardStats: leaderboard,
    leaderboardDefinitions: definitions,
    stat: playerStats,
    playerKey: 'player:test',
    currentStatsScope: 'session',
    statTooltipTargetHtml: function (definition, value) { return '<span tabindex="0" data-stat="' + definition.id + '">' + value + '</span>'; },
    cells: null,
    renderedCells: null
  };
  vm.runInNewContext(content.slice(start, end) + '\nrenderedCells = cells;', context);
  return context.renderedCells;
}

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var persisted = statsEngine.combinePlayerStats('Alice', [{
  handsPlayed: 50,
  vpipOpportunities: 50,
  vpipHands: 14,
  pfrOpportunities: 50,
  pfrHands: 11,
  threeBetMade: 2,
  threeBetOpportunities: 25,
  foldToThreeBet: 3,
  foldToThreeBetOpportunities: 6,
  flopCBetMade: 8,
  flopCBetOpportunities: 13,
  foldToFlopCBet: 4,
  foldToFlopCBetOpportunities: 9,
  sawFlopForWTSD: 24,
  wentToShowdown: 7,
  showdownsForWSD: 11,
  wonMoneyAtShowdown: 6
}]);

assert.deepStrictEqual(registry.DEFAULT_DISPLAYED_STAT_IDS.slice(-4), ['flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.deepStrictEqual(registry.definitionsFor(['wtsd', 'wsd']).map(function (definition) {
  return [definition.id, definition.label, definition.shortLabel, definition.tableLabel, definition.explanation.fullName];
}), [
  ['wtsd', 'WTSD', 'WTSD', 'WTSD', 'Went to Showdown'],
  ['wsd', 'W$SD', 'W$SD', 'W$SD', 'Won Money at Showdown']
]);
assert.deepStrictEqual(plain(registry.STAT_CATALOG.wtsd.getValue(persisted)), { numerator: 7, denominator: 24 });
assert.deepStrictEqual(plain(registry.STAT_CATALOG.wsd.getValue(persisted)), { numerator: 6, denominator: 11 });

var expectedCombined = [
  ['H 50', 'VPIP 28%', 'PFR 22%', 'AF 0.0'],
  ['3B 8%', 'F3B 50%', 'CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
];
var expectedStacked = [
  ['H 50', 'VPIP 28%', 'PFR 22%', 'AF 0.0'],
  ['3B 8%', 'F3B 50%'],
  ['CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
];
assert.deepStrictEqual(rowLabels(persisted, registry.DEFAULT_DISPLAYED_STAT_IDS, 'combined'), expectedCombined);
assert.deepStrictEqual(rowLabels(persisted, registry.DEFAULT_DISPLAYED_STAT_IDS, 'stacked'), expectedStacked);
assert.deepStrictEqual(rowLabels(persisted, ['hands', 'wtsd'], 'combined'), [['H 50'], ['WTSD 29%']]);
assert.deepStrictEqual(rowLabels(persisted, ['hands'], 'combined'), [['H 50']], 'hiding both showdown stats leaves no blank row');

var renderedSeat = renderSeatThroughContent({ playerId: 'P1', name: 'Alice', stats: persisted, displayedStatIds: registry.DEFAULT_DISPLAYED_STAT_IDS, opportunityStatsLayout: 'combined' }, content);
assert.ok(renderedSeat.includes('data-stat="wtsd">WTSD 29%</span>'));
assert.ok(renderedSeat.includes('data-stat="wsd">W$SD 55%</span>'));
assert.ok(!renderedSeat.includes('(7/24)') && !renderedSeat.includes('(6/11)'), 'seat output remains percentage-only');

var showdownDefinitions = leaderboard.definitions(['wtsd', 'wsd']);
assert.deepStrictEqual(showdownDefinitions.map(leaderboard.tableLabel), ['WTSD', 'W$SD']);
assert.deepStrictEqual(showdownDefinitions.map(function (definition) { return leaderboard.formatValue(definition, persisted); }), ['29%', '55%']);
var renderedCells = renderLeaderboardCellsThroughContent(persisted, showdownDefinitions, content);
assert.ok(renderedCells.includes('data-stat="wtsd">29%</span>'));
assert.ok(renderedCells.includes('data-stat="wsd">55%</span>'));
assert.ok(!renderedCells.includes('(7/24)') && !renderedCells.includes('(6/11)'), 'leaderboard output remains percentage-only');

var zero = statsEngine.combinePlayerStats('Zero', [{ handsPlayed: 5, sawFlopForWTSD: 5, wentToShowdown: 0, showdownsForWSD: 3, wonMoneyAtShowdown: 0 }]);
var unavailable = statsEngine.combinePlayerStats('Initial', [{ handsPlayed: 0 }]);
var legacy = statsEngine.combinePlayerStats('Legacy', [{ handsPlayed: 10 }]);
assert.deepStrictEqual(seatOverlay.compactStatLabels(zero, ['wtsd', 'wsd']), ['WTSD 0%', 'W$SD 0%']);
assert.deepStrictEqual(seatOverlay.compactStatLabels(unavailable, ['wtsd', 'wsd']), ['WTSD ---', 'W$SD ---']);
assert.deepStrictEqual(seatOverlay.compactStatLabels(legacy, ['wtsd', 'wsd']), ['WTSD ---', 'W$SD ---']);
assert.deepStrictEqual(showdownDefinitions.map(function (definition) { return leaderboard.formatValue(definition, unavailable); }), ['---', '---']);

var wtsdModel = plain(tooltip.buildModel(registry.STAT_CATALOG.wtsd, persisted, { playerName: 'Alice', scope: 'Session', displayedValue: '29%' }));
var wsdModel = plain(tooltip.buildModel(registry.STAT_CATALOG.wsd, persisted, { playerName: 'Alice', scope: 'Session', displayedValue: '55%' }));
assert.strictEqual(wtsdModel.summary, '7 reached showdown from 24 hands where the player saw the flop');
assert.strictEqual(wsdModel.summary, '6 won money from 11 supported showdowns');
assert.strictEqual(wtsdModel.description, 'Measures how often the player reached a contested showdown after seeing the flop.');
assert.strictEqual(wsdModel.description, 'Measures how often the player received a positive proven contested-pot award at showdown.');
assert.deepStrictEqual([wtsdModel.numerator.value, wtsdModel.denominator.value, wsdModel.numerator.value, wsdModel.denominator.value], [7, 24, 6, 11]);
assert.ok(wsdModel.eligibilityNotes.some(function (note) { return note.includes('Returned, refunded, or uncalled money'); }));

assert.ok(content.includes('class="pnhud-stat-tooltip-target" tabindex="0"'));
assert.ok(content.includes("target.setAttribute('aria-describedby', statTooltipElement.id)"));
assert.ok(content.includes("event.key === 'Escape' && statTooltipUiDiagnostics.tooltipVisible") && content.includes("closeStatTooltip('escape-key')"));
assert.ok(!/text-decoration:\s*underline\s+dotted|border-bottom:\s*[^;]*dotted/.test(css));

var migratedOverlay = registry.normalizePreference({ version: 2, displayedStatIds: ['pfr', 'threeBet'] });
assert.deepStrictEqual(migratedOverlay.normalizedDisplayedStatIds, ['pfr', 'threeBet', 'wtsd', 'wsd']);
var hiddenCurrent = registry.normalizePreference({ version: 3, displayedStatIds: ['pfr', 'wsd'] });
assert.deepStrictEqual(hiddenCurrent.normalizedDisplayedStatIds, ['pfr', 'wsd']);
var migratedLeaderboard = leaderboard.normalize({ version: 1, syncWithOverlay: false, displayedStatIds: ['af', 'hands'] });
assert.deepStrictEqual(migratedLeaderboard.preference.displayedStatIds, ['af', 'hands', 'wtsd', 'wsd']);
assert.strictEqual(migratedLeaderboard.preference.syncWithOverlay, false);

assert.deepStrictEqual(seatOverlay.compactStatLabels(persisted, ['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet']), ['VPIP 28%', 'PFR 22%', 'AF 0.0', '3B 8%', 'F3B 50%', 'CB 62%', 'FCB 44%'], 'existing visible statistics remain value-for-value unchanged');
assert.ok(content.includes('PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout)'));
assert.ok(content.includes('PokerLeaderboardStats.formatValue(definition, stat)'));

console.log('Visible WTSD/W$SD registry, production seat/leaderboard, tooltip, restoration, legacy, and preference paths passed.');
