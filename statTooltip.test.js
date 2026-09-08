'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var registry = require('./overlayStats.js');
var tooltip = require('./statTooltip.js');

Object.keys(registry.STAT_CATALOG).forEach(function (id) {
  assert.ok(registry.STAT_CATALOG[id].explanation, id + ' has registry-owned explanation metadata');
  assert.strictEqual(typeof registry.STAT_CATALOG[id].explanation.getBreakdown, 'function');
});

var events = [
  { handId: 'h1', player: 'PlayerA', action: 'call', street: 'preflop', amount: 2, timestamp: 1 },
  { handId: 'h1', player: 'PlayerA', action: 'raise', street: 'preflop', amount: 8, timestamp: 2 },
  { handId: 'h1', player: 'PlayerA', action: 'bet', street: 'flop', amount: 10, timestamp: 3 },
  { handId: 'h1', player: 'PlayerA', action: 'raise', street: 'turn', amount: 20, timestamp: 4 },
  { handId: 'h1', player: 'PlayerA', action: 'call', street: 'river', amount: 20, timestamp: 5 },
  { handId: 'walk', player: 'PlayerA', action: 'blind', street: 'preflop', amount: 2, blindType: 'big', timestamp: 6 },
  { handId: 'walk', player: 'PlayerB', action: 'blind', street: 'preflop', amount: 1, blindType: 'small', timestamp: 7 },
  { handId: 'walk', player: 'PlayerB', action: 'fold', street: 'preflop', amount: 0, timestamp: 8 }
];
var playerStats = stats.computePlayerStats(events, 'PlayerA');
assert.deepStrictEqual(playerStats.vpipDetails, { qualifiedHands: 1, opportunities: 1, callHands: 1, raiseHands: 1, walksExcluded: 1, finalizedHands: 2 });
assert.deepStrictEqual(playerStats.pfrDetails, { raisedHands: 1, opportunities: 1, walksExcluded: 1, finalizedHands: 2 });

var vpip = tooltip.buildModel(registry.STAT_CATALOG.vpip, playerStats, { playerName: 'PlayerA', playerId: 'p1', scope: 'Session', displayedValue: '100.0%' });
assert.strictEqual(vpip.numerator.value, 1);
assert.strictEqual(vpip.denominator.value, 1);
assert.strictEqual(vpip.exclusions[0].value, 1);
assert.strictEqual(vpip.components[0].value, 1);
assert.strictEqual(vpip.components[1].value, 1);
assert.ok(vpip.notes[0].includes('may overlap'));
assert.strictEqual(vpip.displayedValue, '100.0%');

var pfr = tooltip.buildModel(registry.STAT_CATALOG.pfr, playerStats, { playerName: 'PlayerA', scope: 'All-time', displayedValue: '100.0%' });
assert.strictEqual(pfr.numerator.value, 1);
assert.strictEqual(pfr.denominator.value, 1);
assert.strictEqual(pfr.scope, 'All-time');

var af = tooltip.buildModel(registry.STAT_CATALOG.af, playerStats, { playerName: 'PlayerA', scope: 'Session', displayedValue: '2.0' });
assert.deepStrictEqual(af.components.map(function (item) { return item.label; }), ['Bets', 'Raises']);
assert.deepStrictEqual(af.displayRows.map(function (item) { return item.label; }), ['Aggressive actions', 'Bets', 'Raises', 'Calls']);
assert.strictEqual(af.displayRows.filter(function (item) { return item.label === 'Calls'; }).length, 1, 'AF displays exactly one Calls row');
assert.strictEqual(af.numerator.value, 2);
assert.strictEqual(af.denominator.value, 1);
assert.strictEqual(af.formulaLabel, '(Bets + Raises) \u00f7 Calls');
assert.strictEqual(af.calculation, '(1 + 1) \u00f7 1 = 2.0');
assert.strictEqual(af.displayedValue, '2.0');
assert.ok(af.eligibilityNotes.some(function (note) { return note.includes('Checks and folds are excluded'); }));

var noCallStats = stats.computePlayerStats([{ handId: 'x', player: 'Zoe', action: 'bet', street: 'flop', amount: 5, timestamp: 1 }], 'Zoe');
var infinity = tooltip.buildModel(registry.STAT_CATALOG.af, noCallStats, { displayedValue: '\u221e' });
assert.ok(infinity.specialValueNote.includes('\u221e'));
assert.deepStrictEqual(infinity.displayRows.map(function (item) { return item.label; }), ['Aggressive actions', 'Bets', 'Raises', 'Calls']);
assert.strictEqual(infinity.denominator.value, 0, 'zero-call denominator remains unchanged');
assert.strictEqual(infinity.displayRows.filter(function (item) { return item.label === 'Calls'; }).length, 1);

assert.strictEqual(vpip.displayRows, null, 'VPIP keeps generic tooltip row rendering');
assert.strictEqual(pfr.displayRows, null, 'PFR keeps generic tooltip row rendering');
var hands = tooltip.buildModel(registry.STAT_CATALOG.hands, playerStats, { displayedValue: '2' });
assert.strictEqual(hands.displayRows, null, 'Hands keeps generic tooltip row rendering');

var cbetStats = Object.assign({}, playerStats, {
  flopCBetMade: 8,
  flopCBetOpportunities: 13,
  foldToFlopCBet: 4,
  foldToFlopCBetOpportunities: 9
});
var cbet = tooltip.buildModel(registry.STAT_CATALOG.flopCBet, cbetStats, { playerName: 'PlayerA', scope: 'Session', displayedValue: '62%' });
assert.strictEqual(cbet.fullName, 'Flop CBet');
assert.strictEqual(cbet.summary, '8 made from 13 opportunities');
assert.deepStrictEqual([cbet.numerator.value, cbet.denominator.value], [8, 13]);
assert.strictEqual(cbet.displayedValue, '62%');
assert.ok(cbet.description.includes('final supported preflop aggressor'));
assert.ok(cbet.eligibilityNotes.some(function (note) { return note.includes('Donk bets'); }));

var foldCbet = tooltip.buildModel(registry.STAT_CATALOG.foldToFlopCBet, cbetStats, { playerName: 'PlayerA', scope: 'Session', displayedValue: '44%' });
assert.strictEqual(foldCbet.fullName, 'Fold to Flop CBet');
assert.strictEqual(foldCbet.summary, '4 folds from 9 opportunities');
assert.deepStrictEqual([foldCbet.numerator.value, foldCbet.denominator.value], [4, 9]);
assert.strictEqual(foldCbet.displayedValue, '44%');
assert.ok(foldCbet.description.includes('directly faces a qualifying flop CBet'));
assert.ok(foldCbet.eligibilityNotes.some(function (note) { return note.includes('Calls and raises'); }));

var future = {
  id: 'future',
  label: 'Future',
  getValue: function (record) { return record.future || 0; },
  formatValue: String,
  explanation: {
    fullName: 'Future Statistic',
    description: 'Generic future metadata.',
    formulaLabel: 'A generic formula',
    getBreakdown: function (record) { return { components: [{ label: 'Observed', value: record.future }] }; }
  }
};
var futureModel = tooltip.buildModel(future, { future: 7 }, { playerName: 'Test', scope: 'Session' });
assert.strictEqual(futureModel.components[0].value, 7);
assert.strictEqual(futureModel.displayRows, null, 'generic future-stat rendering is unaffected');
assert.deepStrictEqual(tooltip.buildModel({ id: 'minimal', label: 'Minimal', getValue: function () { return 0; }, formatValue: String }, {}, {} ).components, [], 'missing optional metadata is safe');

var placed = tooltip.choosePlacement({ left: 980, right: 1000, top: 740, bottom: 760, width: 20, height: 20 }, { width: 300, height: 180 }, { width: 1024, height: 768 }, 8);
assert.ok(placed.left >= 8 && placed.top >= 8 && placed.left + 300 <= 1016 && placed.top + 180 <= 760);

console.log('Registry explanation models, exact source counters, and viewport tooltip placement tests passed.');
