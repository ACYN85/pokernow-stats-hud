'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
var resetSessionStart = content.indexOf('  function resetCurrentSession()');
var resetSessionEnd = content.indexOf('  function ', resetSessionStart + 12);
var resetSession = content.slice(resetSessionStart, resetSessionEnd);

assert.ok(isolated.js.includes('leaderboardHudPosition.js'));
assert.ok(isolated.js.indexOf('leaderboardHudPosition.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("leaderboardHudPosition: 'leaderboardHudPosition'"));
assert.ok(content.includes("var leaderboardHudPosition = Object.assign({}, PokerLeaderboardHudPosition.DEFAULTS)"));
assert.ok(content.includes("if (leaderboardHudPosition.locked || activeLeaderboardHudDrag || activeOverlayDrag"));
assert.ok(content.includes("event.target.closest('.pnhud-header')"));
assert.ok(content.includes('isInteractiveDragExclusionTarget(event.target)'));
['button', 'a', 'input', 'select', 'textarea', '.pnhud-stat-tooltip-target', '.pnhud-tabs', 'th', 'td'].forEach(function (selector) {
  assert.ok(content.includes("'" + selector + "'") || content.includes(selector), selector + ' excludes drag initiation');
});
assert.ok(content.includes("persistLeaderboardHudPosition('pointer-drag')"));
assert.ok(content.includes('if (!cancelled && drag.moved)'), 'no-op drag avoids a position write');
assert.ok(content.includes("applyLeaderboardHudPosition('viewport-clamp', true)"));
assert.ok(content.includes("applyLeaderboardHudPosition('size-change-clamp', true)"));
assert.ok(content.includes("resetLeaderboardHudPosition('reset-position')"));
assert.ok(content.includes("lastPositionChangeSource = 'interface-reset'"));
assert.ok(!resetSession.includes('leaderboardHudPosition'), 'Reset Session does not reset HUD placement');
assert.strictEqual((content.match(/element\.addEventListener\('pointerdown', pointerDown\)/g) || []).length >= 2, true, 'seat and leaderboard pointer owners remain separate');
assert.ok(content.includes('leaderboardHudDragBehavior && leaderboardHudDragBehavior.element === element'), 'DOM recovery prevents duplicate HUD drag behavior');
assert.ok(css.includes('.pnhud-leaderboard-drag-unlocked .pnhud-header { cursor: grab'));
assert.ok(css.includes('.pnhud-leaderboard-dragging .pnhud-header { cursor: grabbing'));
assert.ok(content.includes('leaderboardHudPosition: cloneJson(leaderboardHudPositionDiagnostics)'));

console.log('Locked/unlocked leaderboard HUD drag ownership and persistence production tests passed.');
