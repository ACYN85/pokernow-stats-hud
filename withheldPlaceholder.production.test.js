'use strict';

var assert = require('assert');
var fs = require('fs');
var overlays = require('./seatOverlay.js');

var viewport = { width: 1000, height: 700 };
var seatRect = { left: 350, top: 220, width: 100, height: 30 };
var sharedObstacles = [
  seatRect,
  { left: 330, top: 260, width: 150, height: 55 }
];
var items = [
  { playerId: 'playerA-id', seatId: 'seat-3', rect: seatRect, obstacles: sharedObstacles, outward: { x: -1, y: 0 } },
  { playerId: 'playerB-id', seatId: 'seat-3', rect: seatRect, obstacles: sharedObstacles, outward: { x: -1, y: 0 } }
];
var sizes = { 'playerA-id': { width: 170, height: 16 }, 'playerB-id': { width: 160, height: 16 } };
var acceptedHud = { left: 300, top: 180, width: 170, height: 18 };
var placements = overlays.layoutWithheldPlaceholders(items, sizes, viewport, [acceptedHud], 4);
var playerA = placements.get('playerA-id');
var playerB = placements.get('playerB-id');
assert.ok(playerA && playerB, 'both real withheld players receive safe debug placements');
assert.strictEqual(playerB.top, playerA.top + playerA.height + 4, 'withheld entries sharing a seat stack vertically with spacing');
assert.strictEqual(overlays.rectsOverlap(playerA, playerB), false, 'stacked withheld placeholders never overlap one another');
assert.strictEqual(overlays.rectsOverlap(playerA, acceptedHud), false, 'withheld placeholder avoids an accepted player HUD');
assert.strictEqual(overlays.rectsOverlap(playerB, acceptedHud), false, 'the full withheld stack avoids an accepted player HUD');
sharedObstacles.forEach(function (obstacle) {
  assert.strictEqual(overlays.rectsOverlap(playerA, obstacle), false, 'withheld placeholder avoids cards and name/stack content');
  assert.strictEqual(overlays.rectsOverlap(playerB, obstacle), false, 'stacked placeholder avoids cards and name/stack content');
});

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
assert.ok(content.includes('var showWithheldPlaceholders = false;'), 'withheld placeholders remain disabled by default');
assert.ok(content.includes('seenPlayerIds.has(playerId) || seenNames.has(normalizedName)'), 'production renders at most one placeholder per player identity');
assert.ok(content.includes('genericWithheldIdentity(playerId)'), 'generic socket records such as gamePlayer are excluded');
assert.ok(content.includes('socketRecord && seat && seat.occupied !== false'), 'transient records without a real occupied seat are excluded');
assert.ok(content.includes("'WITHHELD: ' + item.playerName + ' · ' + item.shortReason"), 'table text uses the compact player and short-reason format');
assert.ok(content.includes("placeholder.title = 'Player ID: '"), 'detailed IDs and rejection evidence remain in a tooltip');
assert.ok(content.includes('layoutWithheldPlaceholders(items, sizes'), 'production uses grouped collision-aware withheld placement');
assert.ok(/pnhud-withheld-placeholder[^\n]*max-width:\s*190px/.test(css), 'withheld placeholder remains small and single-line');
assert.ok(/pnhud-withheld-placeholder[^\n]*white-space:\s*nowrap/.test(css));

console.log('Withheld placeholder filtering, deduplication, stacking, and collision tests passed.');
