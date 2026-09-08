'use strict';

var assert = require('assert');
var position = require('./leaderboardHudPosition.js');

assert.deepStrictEqual(position.normalize(undefined).value, { version: 1, x: null, y: null, locked: true });
assert.deepStrictEqual(position.normalize({ version: 1, x: 120, y: 80, locked: false }).value, { version: 1, x: 120, y: 80, locked: false });
assert.deepStrictEqual(position.normalize({ version: 1, x: 'bad', y: 80, locked: false }).value, { version: 1, x: null, y: null, locked: false });
assert.deepStrictEqual(position.defaultPosition({ width: 400, height: 200 }, { width: 1200, height: 800 }), { x: 782, y: 18 });

var clamped = position.clamp({ x: -50, y: 900 }, { width: 400, height: 200 }, { width: 1200, height: 800 });
assert.deepStrictEqual(clamped, { x: 8, y: 592, clamped: true });
assert.deepStrictEqual(position.clamp({ x: 100, y: 90 }, { width: 400, height: 200 }, { width: 1200, height: 800 }), { x: 100, y: 90, clamped: false });
assert.deepStrictEqual(position.clamp({ x: 900, y: 500 }, { width: 600, height: 350 }, { width: 1000, height: 700 }), { x: 392, y: 342, clamped: true }, 'resize or size growth re-clamps accessibly');
assert.strictEqual(position.equal({ version: 1, x: 10, y: 20, locked: true }, { version: 1, x: 10, y: 20, locked: true }), true);

console.log('Leaderboard HUD position normalization and viewport clamping tests passed.');
