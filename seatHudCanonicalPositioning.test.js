'use strict';

var assert = require('assert');
var fs = require('fs');
var seatOverlay = require('./seatOverlay.js');

function seatsAt(count, viewport) {
  var centerX = viewport.width / 2;
  var centerY = viewport.height / 2;
  var radiusX = viewport.width * 0.34;
  var radiusY = viewport.height * 0.32;
  return Array.from({ length: count }, function (_, index) {
    var angle = Math.PI / 2 + index * Math.PI * 2 / count;
    var visualRect = { left: centerX + Math.cos(angle) * radiusX - 42, top: centerY + Math.sin(angle) * radiusY - 23, width: 84, height: 46 };
    var asymmetricLeftExtension = index % 2 === 0 ? 64 : 12;
    var asymmetricRightExtension = index % 2 === 0 ? 10 : 58;
    return {
      playerId: 'player-' + index,
      seatId: 'seat-dom-' + index,
      seatIndex: index,
      physicalSeat: index,
      rect: { left: visualRect.left - asymmetricLeftExtension, top: visualRect.top - 8, width: visualRect.width + asymmetricLeftExtension + asymmetricRightExtension, height: visualRect.height + 20 },
      identityAnchorRect: { left: visualRect.left - asymmetricLeftExtension, top: visualRect.top - 8, width: visualRect.width + asymmetricLeftExtension + asymmetricRightExtension, height: visualRect.height + 20 },
      visualRect: visualRect,
      visualAnchorSource: 'visible-name-stack-union'
    };
  });
}

function sizesFor(seats) {
  return seats.reduce(function (result, seat) { result[seat.playerId] = { width: 168, height: 36 }; return result; }, {});
}

[2, 3, 4, 6, 9].forEach(function (count) {
  var viewport = { width: 1280, height: 720 };
  var seats = seatsAt(count, viewport);
  var tableRect = seatOverlay.tableRectForSeats(seats);
  var first = seatOverlay.layoutCanonicalSeatHudOverlays(seats, sizesFor(seats), viewport, {}, tableRect);
  var second = seatOverlay.layoutCanonicalSeatHudOverlays(seats.map(function (seat) {
    return Object.assign({}, seat, { seatId: 'replacement-' + seat.seatIndex });
  }), sizesFor(seats), viewport, {}, tableRect);
  var movedSeats = seats.map(function (seat) { return Object.assign({}, seat, { rect: Object.assign({}, seat.rect, { left: seat.rect.left + 12, top: seat.rect.top + 7 }), identityAnchorRect: Object.assign({}, seat.identityAnchorRect, { left: seat.identityAnchorRect.left + 12, top: seat.identityAnchorRect.top + 7 }), visualRect: Object.assign({}, seat.visualRect, { left: seat.visualRect.left + 12, top: seat.visualRect.top + 7 }) }); });
  var moved = seatOverlay.layoutCanonicalSeatHudOverlays(movedSeats, sizesFor(movedSeats), viewport, {}, seatOverlay.tableRectForSeats(movedSeats));
  seats.forEach(function (seat) {
    var placement = first.placements.get(seat.playerId);
    var replacement = second.placements.get(seat.playerId);
    var movedPlacement = moved.placements.get(seat.playerId);
    var diagnostic = first.diagnostics.get(seat.playerId);
    assert.ok(placement, count + '-handed seat ' + seat.seatIndex + ' has a canonical placement');
    assert.ok(placement.left >= 4 && placement.top >= 4 && placement.right <= viewport.width - 4 && placement.bottom <= viewport.height - 4, count + '-handed seat stays entirely accessible');
    assert.strictEqual(placement.gripAccessible, true, count + '-handed seat has a recoverable grip');
    assert.deepStrictEqual([replacement.left, replacement.top, replacement.kind], [placement.left, placement.top, placement.kind], 'physical-seat placement survives DOM remount');
    assert.strictEqual(placement.kind, 'below', count + '-handed canonical intent is underneath every physical seat');
    assert.strictEqual(placement.canonicalRect.left + placement.canonicalRect.width / 2, seat.visualRect.left + seat.visualRect.width / 2, count + '-handed HUD center aligns with the actual player visual center');
    assert.notStrictEqual(placement.canonicalRect.left + placement.canonicalRect.width / 2, seat.rect.left + seat.rect.width / 2, count + '-handed asymmetric fold/avatar/badge extensions do not shift the HUD to the broad wrapper center');
    assert.strictEqual(placement.canonicalRect.top, seat.visualRect.top + seat.visualRect.height + 8, count + '-handed HUD uses the consistent eight-pixel gap beneath the player visual rectangle');
    assert.strictEqual(Math.round(movedPlacement.canonicalRect.left - placement.canonicalRect.left), 12, 'connected replacement anchor immediately updates canonical X');
    assert.strictEqual(Math.round(movedPlacement.canonicalRect.top - placement.canonicalRect.top), 7, 'connected replacement anchor immediately updates canonical Y');
    assert.strictEqual(diagnostic.physicalSeat, seat.seatIndex);
    assert.deepStrictEqual(diagnostic.identityAnchorRect, Object.assign({}, seat.identityAnchorRect, { right: seat.identityAnchorRect.left + seat.identityAnchorRect.width, bottom: seat.identityAnchorRect.top + seat.identityAnchorRect.height }));
    assert.strictEqual(diagnostic.visualAnchorSource, 'visible-name-stack-union');
    assert.strictEqual(diagnostic.viewportClampApplied, false);
  });
  var bottomSeat = seats.slice().sort(function (left, right) { return right.visualRect.top - left.visualRect.top; })[0];
  var bottomPlacement = first.placements.get(bottomSeat.playerId);
  assert.strictEqual(bottomPlacement.kind, 'below', count + '-handed bottom seat retains the same under-player canonical intent');
  assert.strictEqual(bottomPlacement.requestedRect.top, bottomSeat.visualRect.top + bottomSeat.visualRect.height + 8, count + '-handed bottom requested position remains underneath the player visual region');
});

var bottomViewport = { width: 640, height: 360 };
var bottomAnchor = [{ playerId: 'bottom-player', seatId: 'bottom-seat', seatIndex: 0, physicalSeat: 0, rect: { left: 238, top: 318, width: 164, height: 48 }, visualRect: { left: 278, top: 326, width: 84, height: 28 }, visualAnchorSource: 'visible-name-stack-union' }];
var bottomCompact = seatOverlay.layoutCanonicalSeatHudOverlays(bottomAnchor, { 'bottom-player': { width: 168, height: 36 } }, bottomViewport, {}, seatOverlay.tableRectForSeats(bottomAnchor));
var bottomCompactPlacement = bottomCompact.placements.get('bottom-player');
assert.strictEqual(bottomCompactPlacement.canonicalRect.top, 362, 'bottom canonical location remains eight pixels underneath even beyond the viewport');
assert.strictEqual(bottomCompactPlacement.requestedRect.top, 362, 'the requested default is the true under-player canonical location');
assert.strictEqual(bottomCompactPlacement.viewportClampApplied, true, 'only rendered geometry is clamped for a short viewport');
assert.strictEqual(bottomCompactPlacement.gripAccessible, true, 'the bottom grip remains accessible after the minimum rendered clamp');
var bottomExpanded = seatOverlay.layoutCanonicalSeatHudOverlays(bottomAnchor, { 'bottom-player': { width: 168, height: 36 } }, { width: 640, height: 440 }, {}, seatOverlay.tableRectForSeats(bottomAnchor)).placements.get('bottom-player');
assert.strictEqual(bottomExpanded.viewportClampApplied, false, 'viewport expansion restores the requested under-player geometry');
assert.strictEqual(bottomExpanded.top, bottomExpanded.requestedRect.top);

var viewport = { width: 900, height: 560 };
var seats = seatsAt(6, viewport);
var tableRect = seatOverlay.tableRectForSeats(seats);
var offsets = { 'player-1': { offsetX: 47, offsetY: -31 } };
var beforeOffsets = JSON.parse(JSON.stringify(offsets));
var initial = seatOverlay.layoutCanonicalSeatHudOverlays(seats, sizesFor(seats), viewport, offsets, tableRect);
var initialPlacement = initial.placements.get('player-1');
assert.strictEqual(initialPlacement.requestedRect.left - initialPlacement.canonicalRect.left, 47);
assert.strictEqual(initialPlacement.requestedRect.top - initialPlacement.canonicalRect.top, -31);

var widerViewport = { width: 1320, height: 760 };
var resizedSeats = seatsAt(6, widerViewport);
var resized = seatOverlay.layoutCanonicalSeatHudOverlays(resizedSeats, sizesFor(resizedSeats), widerViewport, offsets, seatOverlay.tableRectForSeats(resizedSeats));
var resizedPlacement = resized.placements.get('player-1');
assert.strictEqual(resizedPlacement.requestedRect.left - resizedPlacement.canonicalRect.left, 47, 'genuine resize preserves the requested X offset');
assert.strictEqual(resizedPlacement.requestedRect.top - resizedPlacement.canonicalRect.top, -31, 'genuine resize preserves the requested Y offset');
assert.deepStrictEqual(offsets, beforeOffsets, 'layout and resize never mutate persisted offsets');

var extremeOffsets = { 'player-0': { offsetX: 850, offsetY: 460 } };
var extremeBefore = JSON.parse(JSON.stringify(extremeOffsets));
var compact = seatOverlay.layoutCanonicalSeatHudOverlays(seats, sizesFor(seats), viewport, extremeOffsets, tableRect);
var compactPlacement = compact.placements.get('player-0');
assert.strictEqual(compactPlacement.viewportClampApplied, true, 'extreme historical offset is temporarily accessibility-clamped');
assert.strictEqual(compactPlacement.gripAccessible, true, 'extreme historical offset cannot strand the drag grip');
assert.deepStrictEqual(extremeOffsets, extremeBefore, 'temporary clamp does not rewrite the stored requested offset');
var expandedViewport = { width: 2400, height: 1600 };
var expanded = seatOverlay.layoutCanonicalSeatHudOverlays(seats, sizesFor(seats), expandedViewport, extremeOffsets, tableRect);
var expandedPlacement = expanded.placements.get('player-0');
assert.strictEqual(expandedPlacement.viewportClampApplied, false, 'viewport expansion exposes the original requested geometry');
assert.deepStrictEqual([expandedPlacement.left, expandedPlacement.top], [Math.round(expandedPlacement.requestedRect.left), Math.round(expandedPlacement.requestedRect.top)]);

var fallbackEntry = [{ playerId: 'fallback', seatId: 'fallback-seat', rect: { left: 300, top: 200, width: 120, height: 50 } }];
var fallbackPlacement = seatOverlay.layoutCanonicalSeatHudOverlays(fallbackEntry, { fallback: { width: 160, height: 36 } }, { width: 900, height: 600 }, {}, seatOverlay.tableRectForSeats(fallbackEntry));
assert.strictEqual(fallbackPlacement.placements.get('fallback').canonicalRect.left + 80, 360, 'missing visual child falls back to the authoritative broad seat center');
assert.strictEqual(fallbackPlacement.placements.get('fallback').canonicalRect.top, 258, 'missing visual child falls back to the authoritative broad seat bottom plus eight pixels');
assert.strictEqual(fallbackPlacement.diagnostics.get('fallback').visualAnchorSource, 'authoritative-seat-fallback');

var content = fs.readFileSync('./content.js', 'utf8');
var seatOverlaySource = fs.readFileSync('./seatOverlay.js', 'utf8');
assert.ok(content.includes('resolvePlayerVisualGeometry(element, mapping.name, seat.displayedStack)') && content.includes("source: 'painted-player-identity-with-card-clearance'"), 'reconciliation re-resolves painted identity geometry and card clearance inside the authoritative seat subtree');
assert.ok(!content.includes('var anchorRect = seat.anchorBox'), 'accepted seat HUD positioning never trusts the obsolete cached anchor box');
assert.ok(content.includes("scheduleSeatOverlayReconcile('PokerNow seat/table DOM mutation')") || content.includes("scheduleSeatDiscovery('PokerNow seat/table DOM mutation')"), 'seat subtree replacement immediately enters the authoritative discovery/reconcile path');
assert.ok(content.includes("Object.keys(saved || {}).filter(function (key) { return key.indexOf(prefix) === 0; })"), 'Reset Seat HUD Positions clears every per-game manual-offset namespace');
assert.ok(content.includes("scheduleSeatOverlayReconcile('all manual overlay positions reset to canonical under-player positions')"), 'reset remounts current HUDs underneath connected players without reload');
['identityAnchorRect', 'visualAnchorSource', 'visualAnchorRect', 'canonicalHudRect', 'manualOffsetX', 'manualOffsetY', 'requestedHudRect', 'renderedHudRect', 'viewportClampApplied', 'gripAccessible', 'connectedAnchorState'].forEach(function (field) {
  assert.ok((content + seatOverlaySource).includes(field), 'copied runtime diagnostics include ' + field);
});

console.log('Seat HUD 2/3/4/6/9-handed canonical positioning, anchor refresh, clamp, offset, resize, and reset tests passed.');
