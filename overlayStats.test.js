'use strict';

var assert = require('assert');
var overlayStats = require('./overlayStats.js');

var sample = { handsPlayed: 42, vpip: 27, pfr: 19, af: 2.3, threeBetMade: 1, threeBetOpportunities: 3, foldToThreeBet: 1, foldToThreeBetOpportunities: 2, flopCBetMade: 8, flopCBetOpportunities: 13, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 9, wentToShowdown: 7, sawFlopForWTSD: 24, wonMoneyAtShowdown: 6, showdownsForWSD: 11 };
var missing = overlayStats.normalizePreference(undefined);
assert.deepStrictEqual(missing.normalizedDisplayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.strictEqual(missing.defaultUsed, true);
assert.strictEqual(overlayStats.formatOverlay(sample, missing.normalizedDisplayedStatIds), 'H 42 | VPIP 27% | PFR 19% | AF 2.3 | 3B 33% (1/3) | F3B 50% (1/2) | CB 62% (8/13) | FCB 44% (4/9) | WTSD 29% | W$SD 55%');

var reordered = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['af', 'hands', 'pfr'] });
assert.deepStrictEqual(reordered.normalizedDisplayedStatIds, ['af', 'hands', 'pfr']);
assert.strictEqual(overlayStats.formatOverlay(sample, reordered.normalizedDisplayedStatIds), 'AF 2.3 | H 42 | PFR 19%');

var disabled = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['hands', 'pfr', 'af'] });
assert.strictEqual(overlayStats.formatOverlay(sample, disabled.normalizedDisplayedStatIds).includes('VPIP'), false);
var enabledAtIndex = disabled.normalizedDisplayedStatIds.slice();
enabledAtIndex.splice(1, 0, 'vpip');
assert.strictEqual(overlayStats.formatOverlay(sample, enabledAtIndex), 'H 42 | VPIP 27% | PFR 19% | AF 2.3');

var invalid = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['hands', 'retired-stat', 'af'] });
assert.deepStrictEqual(invalid.normalizedDisplayedStatIds, ['hands', 'af']);
assert.deepStrictEqual(invalid.invalidIdsRemoved, ['retired-stat']);
assert.strictEqual(invalid.defaultUsed, false);

var duplicate = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['pfr', 'hands', 'pfr', 'af', 'hands'] });
assert.deepStrictEqual(duplicate.normalizedDisplayedStatIds, ['pfr', 'hands', 'af']);
assert.deepStrictEqual(duplicate.duplicateIdsRemoved, ['pfr', 'hands']);

var malformed = overlayStats.normalizePreference({ version: 3, displayedStatIds: 'hands' });
assert.deepStrictEqual(malformed.normalizedDisplayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.strictEqual(malformed.defaultUsed, true);
var allInvalid = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['gone'] });
assert.deepStrictEqual(allInvalid.normalizedDisplayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);

var empty = overlayStats.normalizePreference({ version: 3, displayedStatIds: [] });
assert.deepStrictEqual(empty.normalizedDisplayedStatIds, []);
assert.strictEqual(empty.defaultUsed, false);
assert.strictEqual(overlayStats.formatOverlay(sample, empty.normalizedDisplayedStatIds), '');
assert.deepStrictEqual(overlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice(), ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);

var testCatalog = Object.assign({}, overlayStats.STAT_CATALOG, {
  showdown: {
    id: 'showdown',
    label: 'Went to Showdown',
    shortLabel: 'WTSD',
    category: 'Showdown',
    getValue: function (stats) { return stats.showdown || 0; },
    formatValue: function (value) { return value + '%'; }
  }
});
var futureAvailable = overlayStats.availableDefinitions(['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'wtsd', 'wsd'], testCatalog);
assert.deepStrictEqual(futureAvailable.map(function (definition) { return definition.id; }), ['flopCBet', 'foldToFlopCBet', 'showdown']);
assert.deepStrictEqual(Object.keys(overlayStats.groupByCategory(futureAvailable)), ['Postflop', 'Showdown']);

assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.threeBet, {}), '3B --- (0/0)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.foldToThreeBet, {}), 'F3B --- (0/0)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.threeBet, sample), '3B 33% (1/3)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.foldToThreeBet, sample), 'F3B 50% (1/2)');
var f3bExplanation = overlayStats.STAT_CATALOG.foldToThreeBet.explanation;
assert.ok(/voluntarily entered live player/.test(f3bExplanation.description), 'F3B tooltip describes every eligible direct responder, not only the opener');
assert.ok(f3bExplanation.eligibilityNotes.some(function (note) { return /opener and prior callers/.test(note); }), 'F3B tooltip includes multiway cold callers');
assert.ok(!/Only the original opener|Cold callers.*do not contribute/.test(f3bExplanation.eligibilityNotes.join(' ')), 'F3B tooltip cannot contradict authoritative multiway reducer semantics');
assert.strictEqual(f3bExplanation.getBreakdown(sample).denominator.label, 'Supported direct responses facing a 3Bet');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.threeBet, { threeBetMade: 0, threeBetOpportunities: 2 }), '3B 0% (0/2)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.flopCBet, sample), 'CB 62% (8/13)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.foldToFlopCBet, sample), 'FCB 44% (4/9)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.flopCBet, {}), 'CB --- (0/0)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.wtsd, sample), 'WTSD 29%');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.wsd, sample), 'W$SD 55%');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.wtsd, {}), 'WTSD ---');
assert.strictEqual(overlayStats.UNAVAILABLE_PLACEHOLDER, '---', 'every visible unavailable formatter shares one ASCII placeholder');
assert.deepStrictEqual(overlayStats.customizableDefinitionsFor(overlayStats.DEFAULT_DISPLAYED_STAT_IDS).map(function (definition) { return definition.id; }), ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'], 'all visible statistics use the existing visibility controls');

var v2Preference = overlayStats.normalizePreference({ version: 2, displayedStatIds: ['pfr', 'threeBet'] });
assert.deepStrictEqual(v2Preference.normalizedDisplayedStatIds, ['pfr', 'threeBet', 'wtsd', 'wsd'], 'v2 choices and order are preserved while new showdown defaults are appended');
assert.strictEqual(v2Preference.migratedFromVersion, 2);
var currentHidden = overlayStats.normalizePreference({ version: 3, displayedStatIds: ['pfr', 'wtsd'] });
assert.deepStrictEqual(currentHidden.normalizedDisplayedStatIds, ['pfr', 'wtsd'], 'current preferences can hide W$SD independently');

var legacyPreference = overlayStats.normalizePreference({ version: 1, displayedStatIds: ['hands', 'vpip', 'pfr', 'af'] });
assert.strictEqual(legacyPreference.defaultUsed, true, 'v1 preferences migrate to the new visible-stat defaults');
assert.deepStrictEqual(legacyPreference.normalizedDisplayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);

console.log('Overlay statistic registry, normalization, and formatting tests passed.');
