'use strict';

var assert = require('assert');
var leaderboard = require('./leaderboardStats.js');
var overlays = require('./overlayStats.js');

var sample = { handsPlayed: 42, vpip: 27.25, pfr: 18.75, af: 2.3, threeBetMade: 1, threeBetOpportunities: 3, foldToThreeBet: 1, foldToThreeBetOpportunities: 2, flopCBetMade: 8, flopCBetOpportunities: 13, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 9, wentToShowdown: 7, sawFlopForWTSD: 24, wonMoneyAtShowdown: 6, showdownsForWSD: 11 };
var missing = leaderboard.normalize(undefined);
assert.deepStrictEqual(missing.preference, {
  version: 2,
  syncWithOverlay: true,
  displayedStatIds: ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']
});
assert.deepStrictEqual(leaderboard.effectiveDisplayedStatIds(missing.preference, overlays.DEFAULT_DISPLAYED_STAT_IDS), ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.deepStrictEqual(leaderboard.definitions(['pfr', 'hands']).map(leaderboard.tableLabel), ['PFR', 'HANDS']);
assert.deepStrictEqual(leaderboard.definitions(['pfr', 'hands']).map(function (definition) {
  return leaderboard.formatValue(definition, sample);
}), ['18.8%', '42']);
assert.deepStrictEqual(leaderboard.definitions(['threeBet', 'foldToThreeBet']).map(function (definition) {
  return leaderboard.formatValue(definition, sample);
}), ['33%', '50%']);
assert.deepStrictEqual(leaderboard.definitions(['flopCBet', 'foldToFlopCBet']).map(function (definition) {
  return leaderboard.formatValue(definition, sample);
}), ['62%', '44%']);
assert.deepStrictEqual(leaderboard.definitions(['wtsd', 'wsd']).map(function (definition) {
  return leaderboard.formatValue(definition, sample);
}), ['29%', '55%']);

var custom = leaderboard.normalize({ version: 2, syncWithOverlay: false, displayedStatIds: ['af', 'hands'] });
assert.deepStrictEqual(leaderboard.effectiveDisplayedStatIds(custom.preference, ['vpip']), ['af', 'hands']);
assert.deepStrictEqual(leaderboard.effectiveDisplayedStatIds(Object.assign({}, custom.preference, { syncWithOverlay: true }), ['vpip', 'pfr', 'hands']), ['vpip', 'pfr', 'hands']);
assert.deepStrictEqual(custom.preference.displayedStatIds, ['af', 'hands'], 'sync derivation does not overwrite the independent list');

var normalized = leaderboard.normalize({ version: 2, syncWithOverlay: false, displayedStatIds: ['pfr', 'unknown', 'hands', 'pfr'] });
assert.deepStrictEqual(normalized.preference.displayedStatIds, ['pfr', 'hands']);
assert.deepStrictEqual(normalized.invalidIdsRemoved, ['unknown']);
assert.deepStrictEqual(normalized.duplicateIdsRemoved, ['pfr']);

var empty = leaderboard.normalize({ version: 2, syncWithOverlay: false, displayedStatIds: [] });
assert.deepStrictEqual(empty.preference.displayedStatIds, []);
assert.deepStrictEqual(leaderboard.definitions(empty.preference.displayedStatIds).map(leaderboard.tableLabel), []);

var allInvalid = leaderboard.normalize({ version: 2, syncWithOverlay: false, displayedStatIds: ['retired'] });
assert.deepStrictEqual(allInvalid.preference.displayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.strictEqual(leaderboard.normalize({ version: 2, syncWithOverlay: 'yes', displayedStatIds: ['hands'] }).preference.syncWithOverlay, true);
assert.deepStrictEqual(leaderboard.DEFAULTS.displayedStatIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);

var migrated = leaderboard.normalize({ version: 1, syncWithOverlay: false, displayedStatIds: ['af', 'hands'] });
assert.deepStrictEqual(migrated.preference.displayedStatIds, ['af', 'hands', 'wtsd', 'wsd'], 'v1 leaderboard choices retain order and gain the new defaults');
assert.strictEqual(migrated.migratedFromVersion, 1);

console.log('Leaderboard preference, synchronization, ordering, and formatting tests passed.');
