'use strict';

var assert = require('assert');
var overlays = require('./seatOverlay.js');
var hands = require('./handFinalization.js');
var pokerStats = require('./stats.js');

var calls = { created: [], updated: [], moved: [], removed: [], positioned: [], skipped: [] };
var adapter = {
  create: function (entry) { var element = { playerId: entry.playerId }; calls.created.push(entry); return element; },
  update: function (record, entry, reason) { calls.updated.push({ record: record, entry: entry, reason: reason }); },
  move: function (record, entry, reason) { calls.moved.push({ previousSeatId: record.seatId, entry: entry, reason: reason }); },
  position: function (record, entry) { calls.positioned.push({ record: record, entry: entry }); },
  remove: function (record, reason) { calls.removed.push({ record: record, reason: reason }); },
  skip: function (entry, reason) { calls.skipped.push({ entry: entry, reason: reason }); }
};
var controller = overlays.createController(adapter);
function stats(hands, vpip, pfr, af) { return { handsPlayed: hands, vpip: vpip, pfr: pfr, af: af }; }
function entry(playerId, name, seatId, left, playerStats, confirmed) {
  return { playerId: playerId, name: name, seatId: seatId, confirmed: confirmed !== false, rect: { left: left, top: 20, width: 100, height: 24 }, stats: playerStats };
}

var first = controller.reconcile([
  entry('p1', 'PlayerA', 'seat-1', 10, stats(24, 33, 21, 2.4)),
  entry('p2', 'Zoe', 'seat-2', 210, stats(18, 28, 14, Infinity)),
  entry('p3', 'Unconfirmed', 'seat-3', 310, stats(9, 40, 20, 1), false)
], { displayMode: 'seat-overlays-only' });
assert.deepStrictEqual(first, { created: 2, updated: 0, moved: 0, removed: 0, skipped: 1 }, 'two confirmed players should receive exactly two overlays');
assert.strictEqual(controller.records.size, 2);
assert.strictEqual(calls.skipped.length, 1, 'unconfirmed player must not receive an overlay');

var moved = controller.reconcile([
  entry('p1', 'PlayerA', 'seat-4', 400, stats(24, 33, 21, 2.4)),
  entry('p2', 'Zoe', 'seat-2', 210, stats(18, 28, 14, Infinity))
], { displayMode: 'seat-overlays-only' });
assert.strictEqual(moved.moved, 1, 'moving a confirmed player should move its existing overlay');
assert.strictEqual(moved.created, 0, 'moving must not duplicate the overlay');
assert.strictEqual(controller.records.size, 2);

var left = controller.reconcile([entry('p1', 'PlayerA', 'seat-4', 400, stats(24, 33, 21, 2.4))], { displayMode: 'seat-overlays-only' });
assert.strictEqual(left.removed, 1, 'leaving player overlay should be removed');
assert.strictEqual(controller.records.size, 1);

var rerender = controller.reconcile([entry('p1', 'PlayerA', 'seat-5', 420, stats(24, 33, 21, 2.4))], { displayMode: 'seat-overlays-only' });
assert.strictEqual(rerender.moved, 1, 'React seat recreation should reanchor the existing overlay');
assert.strictEqual(rerender.created, 0);
assert.strictEqual(controller.records.size, 1);

var statChange = controller.reconcile([entry('p1', 'PlayerA', 'seat-5', 420, stats(25, 36, 24, 3))], { displayMode: 'seat-overlays-only' });
assert.strictEqual(statChange.updated, 1, 'only changed finalized statistics should update an overlay');

var resized = controller.reconcile([entry('p1', 'PlayerA', 'seat-5', 460, stats(25, 36, 24, 3))], { displayMode: 'seat-overlays-only' });
assert.strictEqual(resized.created, 0, 'a viewport resize must not duplicate an overlay');
assert.ok(calls.positioned.length >= 1, 'a changed anchor rectangle should reposition the overlay');

var lateMapping = controller.reconcile([
  entry('p1', 'PlayerA', 'seat-5', 460, stats(25, 36, 24, 3)),
  entry('p3', 'Late Player', 'seat-7', 610, stats(0, 0, 0, 0))
], { displayMode: 'seat-overlays-leaderboard' });
assert.strictEqual(lateMapping.created, 1, 'a confirmed mapping that arrives after initial render should create its overlay, including zero-hand stats');
assert.strictEqual(controller.records.size, 2);

controller.reconcile([], { displayMode: 'leaderboard-only' });
assert.strictEqual(controller.records.size, 0, 'leaderboard-only mode removes seat overlays');
assert.strictEqual(overlays.normalizeDisplayMode(undefined), 'seat-overlays-only', 'seat overlays only is the default display preference');
assert.deepStrictEqual(overlays.visibilityForMode('seat-overlays-only'), { mode: 'seat-overlays-only', overlaysVisible: true, detailsVisible: false });
assert.deepStrictEqual(overlays.visibilityForMode('seat-overlays-leaderboard'), { mode: 'seat-overlays-leaderboard', overlaysVisible: true, detailsVisible: true });
assert.deepStrictEqual(overlays.visibilityForMode('leaderboard-only'), { mode: 'leaderboard-only', overlaysVisible: false, detailsVisible: true });
assert.deepStrictEqual(overlays.visibilityForMode('hidden'), { mode: 'hidden', overlaysVisible: false, detailsVisible: false });
assert.strictEqual(overlays.normalizeLeaderboardOpen(undefined), false, 'leaderboard is collapsed by default');
assert.strictEqual(overlays.normalizeLeaderboardOpen(true), true, 'stored open preference is restored');
assert.strictEqual(overlays.compactStatsLabel(stats(24, 33, 21, 2.4)), 'H 24 | VPIP 33% | PFR 21% | AF 2.4 | 3B --- | F3B --- | CB --- | FCB --- | WTSD --- | W$SD ---', 'normal overlay output includes whole-number VPIP/PFR percent signs');
assert.strictEqual(overlays.compactStatsLabel(stats(1, 100, 100, Infinity)), 'H 1 | VPIP 100% | PFR 100% | AF ∞ | 3B --- | F3B --- | CB --- | FCB --- | WTSD --- | W$SD ---', 'compact statistics preserve 100% and infinite aggression factor');
assert.strictEqual(overlays.compactStatsLabel(stats(0, 0, 0, 0)), 'H 0 | VPIP --- | PFR --- | AF --- | 3B --- | F3B --- | CB --- | FCB --- | WTSD --- | W$SD ---', 'zero observed hands render ASCII unavailable placeholders without NaN');
assert.strictEqual(overlays.compactStatsLabel(stats(3, 33.6, 66.4, 1)), 'H 3 | VPIP 34% | PFR 66% | AF 1.0 | 3B --- | F3B --- | CB --- | FCB --- | WTSD --- | W$SD ---', 'compact percentages round to whole numbers');
var visibleCounters = Object.assign(stats(42, 88, 71, 0), { threeBetMade: 2, threeBetOpportunities: 4, foldToThreeBet: 2, foldToThreeBetOpportunities: 4, flopCBetMade: 8, flopCBetOpportunities: 13, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 9, wentToShowdown: 7, sawFlopForWTSD: 24, wonMoneyAtShowdown: 6, showdownsForWSD: 11 });
assert.strictEqual(overlays.compactStatsLabel(visibleCounters), 'H 42 | VPIP 88% | PFR 71% | AF 0.0 | 3B 50% | F3B 50% | CB 62% | FCB 44% | WTSD 29% | W$SD 55%', 'seat HUD uses compact percentage-only formatting for all opportunity stats');
assert.strictEqual(overlays.compactStatsLabel(Object.assign(stats(42, 88, 71, 0), { threeBetMade: 1, threeBetOpportunities: 3, foldToThreeBet: 1, foldToThreeBetOpportunities: 2, flopCBetMade: 1, flopCBetOpportunities: 3, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 3, wentToShowdown: 1, sawFlopForWTSD: 3, wonMoneyAtShowdown: 1, showdownsForWSD: 3 })), 'H 42 | VPIP 88% | PFR 71% | AF 0.0 | 3B 33% | F3B 50% | CB 33% | FCB 33% | WTSD 33% | W$SD 33%', 'seat HUD uses the existing whole-number rounding behavior');
assert.deepStrictEqual(overlays.compactStatRows(visibleCounters).map(function (row) { return row.map(function (item) { return item.label; }); }), [
  ['H 42', 'VPIP 88%', 'PFR 71%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%', 'CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
], 'Combined is the default opportunity-stat layout');
assert.deepStrictEqual(overlays.compactStatRows(visibleCounters, undefined, 'stacked').map(function (row) { return row.map(function (item) { return item.label; }); }), [
  ['H 42', 'VPIP 88%', 'PFR 71%', 'AF 0.0'],
  ['3B 50%', 'F3B 50%'],
  ['CB 62%', 'FCB 44%'],
  ['WTSD 29%', 'W$SD 55%']
], 'Stacked preserves the prior three-row layout');
assert.deepStrictEqual(overlays.compactStatRows(visibleCounters, ['foldToFlopCBet'], 'combined').map(function (row) { return row.map(function (item) { return item.label; }); }), [['FCB 44%']], 'one enabled opportunity stat produces one clean row');
assert.deepStrictEqual(overlays.compactStatRows(visibleCounters, ['threeBet', 'flopCBet'], 'combined').map(function (row) { return row.map(function (item) { return item.label; }); }), [['3B 50%', 'CB 62%']], 'nonadjacent opportunity stats retain canonical order without empty separators');
assert.deepStrictEqual(overlays.compactStatRows(visibleCounters, [], 'combined'), [], 'all opportunity statistics may be hidden without a blank row');
assert.strictEqual(overlays.compactStatsLabel(stats(24, 33, 21, 2.4), ['pfr', 'hands']), 'PFR 21% | H 24', 'ordered stat IDs drive compact rendering');
assert.strictEqual(overlays.compactStatsLabel(stats(24, 33, 21, 2.4), []), '', 'zero selected statistics render no stat-value text');

var propagationCalls = { created: 0, updated: 0 };
var propagationController = overlays.createController({
  create: function () { propagationCalls.created += 1; return {}; },
  update: function () { propagationCalls.updated += 1; },
  move: function () {},
  position: function () {},
  remove: function () {},
  skip: function () {}
});
var propagationEntries = [
  Object.assign(entry('prop-1', 'One', 'prop-seat-1', 10, stats(24, 33, 21, 2.4)), { displayedStatIds: ['hands', 'vpip', 'pfr', 'af'] }),
  Object.assign(entry('prop-2', 'Two', 'prop-seat-2', 210, stats(18, 28, 14, 1.5)), { displayedStatIds: ['hands', 'vpip', 'pfr', 'af'] })
];
propagationController.reconcile(propagationEntries, { displayMode: 'seat-overlays-only' });
var preferenceUpdate = propagationEntries.map(function (item) { return Object.assign({}, item, { displayedStatIds: ['pfr', 'hands'] }); });
var propagated = propagationController.reconcile(preferenceUpdate, { displayMode: 'seat-overlays-only' });
assert.strictEqual(propagated.updated, 2, 'one preference change updates every attached overlay once');
assert.strictEqual(propagated.created, 0, 'preference propagation does not duplicate overlay elements');
assert.strictEqual(propagationCalls.created, 2);
assert.strictEqual(propagationCalls.updated, 2);

var visibilityCalls = { created: [], removed: [] };
var visibilityController = overlays.createController({
  create: function (item) { visibilityCalls.created.push(item); return {}; },
  update: function () {},
  move: function () {},
  position: function () {},
  remove: function (record) { visibilityCalls.removed.push(record); },
  skip: function () {}
});
var visibilityHandState = hands.createState();
function finalizeVisibilityHand(handId, timestamp) {
  hands.beginHand(visibilityHandState, handId, { activate: true, timestamp: timestamp });
  hands.stageEvent(visibilityHandState, { handId: handId, playerId: 'visibility-player', player: 'Visible Player', action: 'call', street: 'preflop', amount: 2, timestamp: timestamp + 1 }, { playerId: 'visibility-player', reason: 'verified call action' });
  hands.commitHand(visibilityHandState, handId, 'verified test settlement', timestamp + 2);
}
var preservedVisibilityOffsets = { 'visibility-player': { playerId: 'visibility-player', seatId: 'visibility-seat', offsetX: 28, offsetY: -9 } };
var offsetsBeforeVisibilityCycle = JSON.parse(JSON.stringify(preservedVisibilityOffsets));
finalizeVisibilityHand('visibility-hand-1', 1000);
var firstVisibleStats = pokerStats.computePlayerStats(visibilityHandState.finalizedEvents, 'Visible Player');
visibilityController.reconcile([entry('visibility-player', 'Visible Player', 'visibility-seat', 20, firstVisibleStats)], { displayMode: 'seat-overlays-only' });
assert.strictEqual(visibilityController.records.get('visibility-player').entry.stats.handsPlayed, 1, 'Seat HUD initially renders current finalized statistics');

visibilityController.reconcile([], { displayMode: 'leaderboard-only' });
assert.strictEqual(visibilityController.records.size, 0, 'Show Seat HUD OFF hides existing per-player records');
assert.strictEqual(visibilityCalls.removed.length, 1, 'hiding removes the rendered record without changing poker state');
finalizeVisibilityHand('visibility-hand-2', 2000);
var hiddenUpdatedStats = pokerStats.computePlayerStats(visibilityHandState.finalizedEvents, 'Visible Player');
assert.strictEqual(hiddenUpdatedStats.handsPlayed, 2, 'finalized statistics continue updating while the Seat HUD is hidden');
assert.deepStrictEqual(preservedVisibilityOffsets, offsetsBeforeVisibilityCycle, 'visibility changes do not mutate persisted manual offsets');

visibilityController.reconcile([entry('visibility-player', 'Visible Player', 'visibility-seat', 20, hiddenUpdatedStats)], { displayMode: 'seat-overlays-only' });
assert.strictEqual(visibilityController.records.size, 1, 'Show Seat HUD ON recreates the current player overlay without another hand');
assert.strictEqual(visibilityController.records.get('visibility-player').entry.stats.handsPlayed, 2, 're-enabled Seat HUD immediately uses statistics accumulated while hidden');
assert.strictEqual(visibilityCalls.created[visibilityCalls.created.length - 1].stats.handsPlayed, 2, 'the recreated element receives the latest current statistics');

var anchorObstacle = { left: 300, top: 100, width: 100, height: 30 };
var preferred = overlays.chooseOverlayPlacement(anchorObstacle, { width: 130, height: 18 }, { width: 900, height: 600 }, [anchorObstacle], [], { x: 0, y: -1 }, 12);
assert.strictEqual(preferred.kind, 'below', 'the unobstructed preferred placement is below the name/stack union');
assert.strictEqual(preferred.top, 142, 'normal placement uses the larger twelve-pixel gap');
assert.strictEqual(overlays.rectsOverlap(preferred, anchorObstacle), false, 'a compact strip never overlaps its name/stack anchor');

var obstructingCards = { left: 270, top: 138, width: 160, height: 70 };
var alternate = overlays.chooseOverlayPlacement(anchorObstacle, { width: 130, height: 18 }, { width: 900, height: 600 }, [anchorObstacle, obstructingCards], [], { x: 0, y: -1 }, 12);
assert.strictEqual(alternate.kind, 'above', 'the renderer tries an alternate placement when cards obstruct the area below');
assert.strictEqual(overlays.rectsOverlap(alternate, anchorObstacle), false);
assert.strictEqual(overlays.rectsOverlap(alternate, obstructingCards), false);

var collisionEntries = [
  { playerId: 'left-player', rect: { left: 200, top: 200, width: 100, height: 30 }, obstacles: [{ left: 200, top: 200, width: 100, height: 30 }], outward: { x: -1, y: 0 } },
  { playerId: 'right-player', rect: { left: 220, top: 200, width: 100, height: 30 }, obstacles: [{ left: 220, top: 200, width: 100, height: 30 }], outward: { x: 1, y: 0 } }
];
var collisionLayout = overlays.layoutOverlays(collisionEntries, { 'left-player': { width: 130, height: 18 }, 'right-player': { width: 130, height: 18 } }, { width: 900, height: 600 });
assert.ok(collisionLayout.get('left-player') && collisionLayout.get('right-player'), 'both nearby players receive a placement');
assert.strictEqual(overlays.rectsOverlap(collisionLayout.get('left-player'), collisionLayout.get('right-player'), 3), false, 'player overlays never overlap one another');
assert.strictEqual(collisionLayout.get('right-player').shifted, true, 'an overlay collision shifts the later strip along that seat\'s outward direction');

console.log('Seat overlay reconciliation and display preference tests passed.');
