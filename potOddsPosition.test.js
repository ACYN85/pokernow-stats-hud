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

var extreme = position.place(resizedCanonicalLeft, { x: 5000, y: -5000 }, { width: 900, height: 665 });
assert.strictEqual(extreme.viewportClampApplied, true);
assert.deepStrictEqual([extreme.actualPanelRect.left, extreme.actualPanelRect.top], [792, 8], 'minimal 8px safety margin keeps the panel accessible');
assert.deepStrictEqual([extreme.persistedOffsetX, extreme.persistedOffsetY], [5000, -5000], 'viewport safety never rewrites the requested offset');
assert.deepStrictEqual(board.companionRect(canonicalBoard, 'right', { width: 140, height: 60 }, 10), canonicalRight, 'pot-odds offsets cannot mutate reserved RIGHT geometry');

var fallback = position.deterministicFallback({ width: 100, height: 60 }, { x: 35, y: 30 }, { width: 900, height: 665 });
assert.strictEqual(fallback.fallback, 'deterministic viewport-relative companion pending canonical board geometry');
assert.deepStrictEqual([fallback.persistedOffsetX, fallback.persistedOffsetY], [35, 30], 'initial fallback honors the feature-owned offset');
assert.ok(fallback.actualPanelRect.left >= 8 && fallback.actualPanelRect.top >= 8, 'initial fallback is viewport-accessible');

console.log('Relative pot-odds position unit regressions passed.');
