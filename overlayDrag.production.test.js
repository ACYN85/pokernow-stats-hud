'use strict';

var assert = require('assert');
var fs = require('fs');
var overlays = require('./seatOverlay.js');

var viewport = { width: 1000, height: 700 };
var anchor = { left: 300, top: 200, width: 100, height: 30 };
var offset = { playerId: 'p1', seatId: 'seat-1', offsetX: 140, offsetY: 55 };
var manual = overlays.manualPlacement(anchor, offset, { width: 150, height: 20 }, viewport);
assert.deepStrictEqual({ left: manual.left, top: manual.top, kind: manual.kind }, { left: 440, top: 255, kind: 'manual' }, 'saved position is relative to the current player anchor');
assert.deepStrictEqual(overlays.relativeOffset(anchor, manual), { offsetX: 140, offsetY: 55 }, 'drag completion produces a persisted relative offset');

var movedAnchor = { left: 500, top: 350, width: 100, height: 30 };
var moved = overlays.manualPlacement(movedAnchor, offset, { width: 150, height: 20 }, viewport);
assert.deepStrictEqual({ left: moved.left, top: moved.top }, { left: 640, top: 405 }, 'a player moving seats reanchors the same player-specific offset');

var resized = overlays.manualPlacement({ left: 220, top: 150, width: 100, height: 30 }, offset, { width: 150, height: 20 }, { width: 800, height: 500 });
assert.deepStrictEqual({ left: resized.left, top: resized.top }, { left: 360, top: 205 }, 'resize and table movement preserve the relative position');

var entry = { playerId: 'p1', rect: anchor, obstacles: [anchor], outward: { x: 1, y: 0 } };
var firstLayout = overlays.layoutHybridOverlays([entry], { p1: { width: 150, height: 20 } }, viewport, { p1: offset });
var statsRerenderLayout = overlays.layoutHybridOverlays([entry], { p1: { width: 170, height: 20 } }, viewport, { p1: offset });
assert.strictEqual(firstLayout.placements.get('p1').left, statsRerenderLayout.placements.get('p1').left, 'stats rerender does not reset the dragged offset');
assert.strictEqual(statsRerenderLayout.placements.get('p1').manual, true);

var resetLayout = overlays.layoutHybridOverlays([entry], { p1: { width: 150, height: 20 } }, viewport, {});
assert.notStrictEqual(resetLayout.placements.get('p1').kind, 'manual', 'clearing offsets restores automatic placement');
assert.strictEqual(overlays.manualPlacement(anchor, { offsetX: 5000, offsetY: 5000 }, { width: 150, height: 20 }, viewport), null, 'completely offscreen saved positions are rejected');
var lateEntry = { playerId: 'late-player', rect: { left: 650, top: 300, width: 100, height: 30 }, obstacles: [], outward: { x: 1, y: 0 } };
var separateOffsets = { p1: offset, 'late-player': { playerId: 'late-player', seatId: 'seat-9', offsetX: -120, offsetY: 45 } };
var lateLayout = overlays.layoutHybridOverlays([entry, lateEntry], { p1: { width: 150, height: 20 }, 'late-player': { width: 150, height: 20 } }, viewport, separateOffsets);
assert.strictEqual(lateLayout.placements.get('p1').left, 440, 'initial player keeps its independent saved offset');
assert.strictEqual(lateLayout.placements.get('late-player').left, 530, 'late player receives a separate player-specific offset');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var popup = fs.readFileSync('./popup.html', 'utf8');
assert.ok(content.includes("element.addEventListener('pointerdown'"), 'production overlays bind pointer dragging');
assert.ok(content.includes("element.addEventListener('mousedown'"), 'production includes a mouse fallback');
assert.ok(content.includes("if (!overlayDraggingUnlocked || activeOverlayDrag"), 'locked overlays cannot begin dragging');
assert.ok(content.includes('var overlayDragBehaviors = new WeakMap();'), 'production tracks one drag behavior installation per overlay element');
assert.ok(content.includes('if (existing)') && content.includes("'[HUD DRAG] behavior already installed'"), 'repeated rerenders do not install duplicate listeners');
assert.ok((content.match(/installDragBehavior\(record\.element, entry\.playerId\)/g) || []).length >= 2, 'updated, returning, and seat-moved overlays reassert the same idempotent drag lifecycle');
assert.ok(content.includes('installDragBehavior(element, entry.playerId)'), 'initial and late-created overlays install drag behavior during creation');
assert.ok(content.includes('cleanupDragBehavior(record.element, record.playerId, reason)'), 'removing one player cleans up only that overlay behavior');
assert.ok(content.includes("'[HUD DRAG] drag started'") && content.includes("'[HUD DRAG] offset persisted'") && content.includes("'[HUD DRAG] cleanup'"), 'production logs the requested drag lifecycle stages');
assert.ok(content.includes("update[STORAGE_KEYS.manualOverlayPositions] = manualOverlayPositions"), 'drag offsets persist in table-scoped storage');
assert.ok(content.includes('manualOverlayPositions = {};') && content.includes('update[STORAGE_KEYS.manualOverlayPositions] = {};'), 'reset positions clears both initial and late-player offsets');
assert.ok(content.includes("PokerSeatOverlay.layoutCanonicalSeatHudOverlays"), 'production rerenders reuse saved offsets on deterministic canonical physical-seat positions');
assert.ok(content.includes("if (!showOverlayBoxes || !seatOverlaysVisible()) return;"), 'identity labels do not enable raw anchor boxes');
assert.ok(content.includes("placeholder.textContent = 'WITHHELD: ' + item.playerName"), 'withheld placeholders do not print internal rejection diagnostics on the table');
assert.ok(!content.includes("placeholder.textContent = 'WITHHELD: ' + item.playerName + ' · ' + item.reason"), 'raw withheld reasons remain off-table');
assert.ok(/white-space:\s*nowrap/.test(css), 'identity and compact statistics remain on one line');
assert.ok(/pointer-events:\s*auto/.test(css) && /cursor:\s*grab/.test(css), 'unlocked overlays capture pointer input and show a drag cursor');
assert.ok(popup.includes('Unlock overlay dragging') && popup.includes('Lock overlay positions') && popup.includes('Reset overlay positions'), 'popup exposes unlock, lock, and reset controls');
assert.strictEqual(overlays.identityLabel('playerA', 'P1'), 'playerA [P1]', 'debug identity is a clean name plus short ID');

console.log('Hybrid automatic/manual overlay dragging and persistence tests passed.');
