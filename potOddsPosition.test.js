'use strict';

var assert = require('assert');
var position = require('./potOddsPosition.js');
var board = require('./boardCompanionLayout.js');

var canonicalBoard = { left: 520, top: 260, width: 306, height: 80, right: 826, bottom: 340 };
var canonicalLeft = board.companionRect(canonicalBoard, 'left', { width: 100, height: 60 }, 10);
var canonicalRight = board.companionRect(canonicalBoard, 'right', { width: 140, height: 60 }, 10);

var defaults = position.place(canonicalLeft, { x: 0, y: 0 }, { width: 1280, height: 665 });
assert.deepStrictEqual(defaults.actualPanelRect, canonicalLeft, '0/0 is byte-for-byte the certified LEFT companion position');
assert.strictEqual(defaults.viewportClampApplied, false);
assert.deepStrictEqual(position.offsetFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 80 }), { x: -40, y: -20 }, 'left/up pointer delta becomes a relative offset');
assert.deepStrictEqual(position.offsetFromDrag({ x: -40, y: -20 }, { x: 100, y: 100 }, { x: 175, y: 150 }), { x: 35, y: 30 }, 'right/down pointer delta composes with the stored offset');

var moved = position.place(canonicalLeft, { x: 35, y: 30 }, { width: 1280, height: 665 });
assert.deepStrictEqual([moved.actualPanelRect.left, moved.actualPanelRect.top], [445, 300]);
var resizedCanonicalLeft = { left: 260, top: 260, width: 100, height: 60, right: 360, bottom: 320 };
var resized = position.place(resizedCanonicalLeft, { x: 35, y: 30 }, { width: 900, height: 665 });
assert.deepStrictEqual([resized.actualPanelRect.left, resized.actualPanelRect.top], [295, 290], 'canonical movement retains the same relative offset');
assert.deepStrictEqual([resized.persistedOffsetX, resized.persistedOffsetY], [35, 30]);

var zoom125 = position.place({ left: 318, top: 212, width: 100, height: 60 }, { x: 35, y: 30 }, { width: 1024, height: 532 }, undefined, { scaleX: 0.8, scaleY: 0.8 });
assert.deepStrictEqual([zoom125.actualPanelRect.left, zoom125.actualPanelRect.top], [346, 236], '125% zoom projects the table-local displacement through the current table scale');
assert.deepStrictEqual([zoom125.persistedOffsetX, zoom125.persistedOffsetY], [35, 30], 'zoom never rewrites the table-local offset');
assert.deepStrictEqual([zoom125.viewportOffsetX, zoom125.viewportOffsetY], [28, 24]);
assert.deepStrictEqual(position.offsetFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 128, y: 124 }, { scaleX: 0.8, scaleY: 0.8 }), { x: 35, y: 30 }, 'drag deltas are inverted from viewport into table-local units');
var zoom100Again = position.place(canonicalLeft, { x: 35, y: 30 }, { width: 1280, height: 665 }, undefined, { scaleX: 1, scaleY: 1 });
assert.deepStrictEqual([zoom100Again.viewportOffsetX, zoom100Again.viewportOffsetY], [35, 30], 'returning to 100% reprojects the same local displacement');
var zoom80 = position.place({ left: 650 - 10 - 100, top: 325 + (100 - 60) / 2, width: 100, height: 60 }, { x: 40, y: -16 }, { width: 1600, height: 832 }, undefined, { scaleX: 1.25, scaleY: 1.25 });
assert.deepStrictEqual([zoom80.viewportOffsetX, zoom80.viewportOffsetY], [50, -20], '80% zoom projects local displacement without stale viewport coordinates');
assert.deepStrictEqual(position.place(zoom80.canonicalLeftCompanionRect, { x: 0, y: 0 }, { width: 1600, height: 832 }, undefined, { scaleX: 1.25, scaleY: 1.25 }).actualPanelRect, zoom80.canonicalLeftCompanionRect, 'reset 0/0 is exactly the current canonical LEFT at every scale');

var extreme = position.place(resizedCanonicalLeft, { x: 5000, y: -5000 }, { width: 900, height: 665 });
assert.strictEqual(extreme.viewportClampApplied, true);
assert.deepStrictEqual([extreme.actualPanelRect.left, extreme.actualPanelRect.top], [792, 8], 'minimal 8px safety margin keeps the panel accessible');
assert.deepStrictEqual([extreme.persistedOffsetX, extreme.persistedOffsetY], [5000, -5000], 'viewport safety never rewrites the requested offset');
assert.deepStrictEqual(board.companionRect(canonicalBoard, 'right', { width: 140, height: 60 }, 10), canonicalRight, 'pot-odds offsets cannot mutate reserved RIGHT geometry');
assert.deepStrictEqual(board.companionSlots(canonicalBoard, { left: { width: 88, height: 56 }, right: { width: 140, height: 64 } }, 10), {
  left: { left: 422, top: 272, width: 88, height: 56, right: 510, bottom: 328 },
  right: { left: 836, top: 268, width: 140, height: 64, right: 976, bottom: 332 }
}, 'LEFT and RIGHT derive symmetrically from one board while retaining independent sizes');

var fallback = position.deterministicFallback({ width: 100, height: 60 }, { x: 35, y: 30 }, { width: 900, height: 665 });
assert.strictEqual(fallback.fallback, 'deterministic viewport-relative companion pending canonical board geometry');
assert.deepStrictEqual([fallback.persistedOffsetX, fallback.persistedOffsetY], [35, 30], 'initial fallback honors the feature-owned offset');
assert.ok(fallback.actualPanelRect.left >= 8 && fallback.actualPanelRect.top >= 8, 'initial fallback is viewport-accessible');

var placementState = position.createPositionPreferenceState({ handId: 'H1', applied: true, sequence: 4, manualOverride: true });
assert.deepStrictEqual(placementState, { manualOverride: true }, 'legacy hand ID and first-flop latch are discarded while the customized-placement marker survives');
assert.deepStrictEqual(position.createPositionPreferenceState(placementState), placementState, 'reload restores the marker without hand ownership');
position.setManualPlacementCustomized(placementState, false);
assert.strictEqual(placementState.manualOverride, false, 'Reset clears the customized-placement marker');
position.setManualPlacementCustomized(placementState, true);
assert.strictEqual(placementState.manualOverride, true, 'drag sets a persistent user-layout marker');
assert.deepStrictEqual(position.createPositionPreferenceState(), { manualOverride: false }, 'default install has no customized placement');

console.log('Relative pot-odds position unit regressions passed.');
