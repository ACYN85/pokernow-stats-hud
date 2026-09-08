'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var harness = harnessSupport.createHarness({
  gameId: 'performance-staged-action',
  transformContentSource: function (source) {
    source = source.replace('function refreshHud() {', 'function refreshHud() { globalThis.__PNHUD_TEST_FULL_RENDER_COUNT__ = Number(globalThis.__PNHUD_TEST_FULL_RENDER_COUNT__ || 0) + 1;');
    return source.replace(/\n\}\)\(\);\s*$/, '\n  globalThis.__PNHUD_TEST_PERFORMANCE__ = { setWebsocketReady: function () { websocketStatsSourceAvailable = true; }, acceptHandEvent: acceptHandEvent };\n})();\n');
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
harness.evaluateInIsolatedWorld('__PNHUD_TEST_PERFORMANCE__.setWebsocketReady()');
var rendersBefore = harness.evaluateInIsolatedWorld('Number(__PNHUD_TEST_FULL_RENDER_COUNT__ || 0)');
var writesBefore = harness.storageWrites.length;
harness.evaluateInIsolatedWorld("__PNHUD_TEST_PERFORMANCE__.acceptHandEvent({ handId: 'staged-only', playerId: 'p1', player: 'Alice', action: 'call', street: 'preflop', amount: 2, timestamp: 10, eventKey: 'staged-only-1' }, 'Alice calls 2', 'websocket', null)");
var rendersAfter = harness.evaluateInIsolatedWorld('Number(__PNHUD_TEST_FULL_RENDER_COUNT__ || 0)');
var stagedWrites = harness.storageWrites.slice(writesBefore);
var liveKey = harnessSupport.storageKeys('performance-staged-action').liveEvents;
assert.strictEqual(rendersAfter - rendersBefore, 0, 'staged action with unchanged finalized revision does not rebuild the leaderboard');
assert.ok(stagedWrites.length >= 1, 'active-hand recovery remains persisted');
assert.ok(stagedWrites.every(function (write) { return !Object.prototype.hasOwnProperty.call(write, liveKey); }), 'staged recovery writes omit unchanged finalized history');

console.log('Production staged-action HUD invalidation and recovery-only persistence cadence passed.');
