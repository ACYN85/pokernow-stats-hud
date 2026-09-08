'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var observed = new Set();
function TrackingResizeObserver() {}
TrackingResizeObserver.prototype.observe = function (target) { observed.add(target); };
TrackingResizeObserver.prototype.unobserve = function (target) { observed.delete(target); };
TrackingResizeObserver.prototype.disconnect = function () { observed.clear(); };

var marker = '  function reconcileSeatOverlays(reason) {';
var harness = harnessSupport.createHarness({
  gameId: 'seat-remounts',
  ResizeObserver: TrackingResizeObserver,
  transformContentSource: function (source) {
    var injection = [
      '  globalThis.__PNHUD_SEAT_CLEANUP_TEST__ = {',
      '    installObserver: function (observer) { seatResizeObserver = observer; },',
      '    seed: function (playerId, name, seatId, seatElement, anchorElement) { domSeatElements.set(seatId, seatElement); domSeatAnchorElements.set(seatId, anchorElement); confirmedSeatMappings.set(playerId, { playerId: playerId, name: name, seatElementId: seatId, seatElement: seatElement }); observeSeatElement(seatElement); },',
      '    prune: function (seats) { identityDiagnostics.domSeats = seats; pruneDetachedSeatDomState(seats, "synthetic remount"); },',
      '    snapshot: seatDomRetentionInfo,',
      '    mappingSeat: function (playerId) { var mapping = confirmedSeatMappings.get(playerId); return mapping && mapping.seatElementId || null; },',
      '    setManualOffset: function (playerId, value) { manualOverlayPositions[playerId] = value; },',
      '    manualOffset: function (playerId) { return manualOverlayPositions[playerId]; }',
      '  };',
      ''
    ].join('\n');
    assert.ok(source.includes(marker), 'seat cleanup hook insertion point exists');
    return source.replace(marker, injection + marker);
  }
});
assert.deepStrictEqual(harness.evaluationErrors, [], 'production content path exposes the seat cleanup behavior');
var api = harness.context.__PNHUD_SEAT_CLEANUP_TEST__;
api.installObserver(new TrackingResizeObserver());
api.setManualOffset('stable-player', { x: 14, y: -9 });
var priorSeat = null;
for (var index = 0; index < 1000; index += 1) {
  if (priorSeat) priorSeat.isConnected = false;
  var seat = { isConnected: true, generation: index };
  var anchor = { isConnected: true, generation: index };
  var seatId = 'seat-' + index;
  api.seed('stable-player', 'Same Player', seatId, seat, anchor);
  api.prune([{ elementId: seatId, displayedName: 'Same Player' }]);
  priorSeat = seat;
}
var snapshot = api.snapshot();
var repeatedRemountSnapshot = JSON.parse(JSON.stringify(snapshot));
assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot)), {
  liveSeatMappingEntries: 1,
  liveAnchorMappingEntries: 1,
  observedCurrentTargets: 1,
  detachedRetainedTargets: 0,
  previousDomSeatEntries: 1,
  confirmedSeatMappings: 1
}, '1,000 remounts remain bounded to the current table state');
assert.strictEqual(observed.size, 1, 'ResizeObserver retains only the current seat target');
assert.strictEqual(api.mappingSeat('stable-player'), 'seat-999', 'stable-ID mapping follows the current remounted seat');
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.manualOffset('stable-player'))), { x: 14, y: -9 }, 'manual HUD offsets survive seat remount cleanup');
priorSeat.isConnected = false;
api.prune([]);
snapshot = api.snapshot();
assert.strictEqual(snapshot.liveSeatMappingEntries, 0, 'player leave removes the authoritative seat');
assert.strictEqual(snapshot.liveAnchorMappingEntries, 0, 'player leave removes the authoritative anchor');
assert.strictEqual(snapshot.confirmedSeatMappings, 0, 'player leave retires the stale stable-ID mapping');
assert.strictEqual(observed.size, 0, 'player leave explicitly unobserves the old seat');

var rejoinedSeat = { isConnected: true, role: 'hero' };
api.seed('stable-player', 'Same Player', 'hero-rejoined', rejoinedSeat, { isConnected: true });
api.prune([{ elementId: 'hero-rejoined', displayedName: 'Same Player' }]);
assert.strictEqual(api.mappingSeat('stable-player'), 'hero-rejoined', 'hero rejoin establishes only the new authoritative seat');

var duplicateOne = { isConnected: true }; var duplicateTwo = { isConnected: true };
api.seed('duplicate-1', 'Duplicate Name', 'duplicate-seat-1', duplicateOne, { isConnected: true });
api.seed('duplicate-2', 'Duplicate Name', 'duplicate-seat-2', duplicateTwo, { isConnected: true });
api.prune([
  { elementId: 'hero-rejoined', displayedName: 'Same Player' },
  { elementId: 'duplicate-seat-1', displayedName: 'Duplicate Name' },
  { elementId: 'duplicate-seat-2', displayedName: 'Duplicate Name' }
]);
assert.strictEqual(api.mappingSeat('duplicate-1'), 'duplicate-seat-1');
assert.strictEqual(api.mappingSeat('duplicate-2'), 'duplicate-seat-2', 'duplicate-name stable IDs retain distinct authoritative seats');

[rejoinedSeat, duplicateOne, duplicateTwo].forEach(function (seat) { seat.isConnected = false; });
var replacementSeats = [];
for (var seatIndex = 0; seatIndex < 6; seatIndex += 1) {
  var playerId = seatIndex === 0 ? 'stable-player' : 'opponent-' + seatIndex;
  var replacement = { isConnected: true, role: seatIndex === 0 ? 'hero' : 'opponent' };
  var replacementId = 'replacement-seat-' + seatIndex;
  api.seed(playerId, seatIndex === 0 ? 'Same Player' : 'Opponent ' + seatIndex, replacementId, replacement, { isConnected: true });
  replacementSeats.push({ elementId: replacementId, displayedName: seatIndex === 0 ? 'Same Player' : 'Opponent ' + seatIndex });
}
api.prune(replacementSeats);
snapshot = api.snapshot();
assert.strictEqual(snapshot.liveSeatMappingEntries, 6, 'full-table DOM replacement retains only six current seats');
assert.strictEqual(snapshot.liveAnchorMappingEntries, 6);
assert.strictEqual(snapshot.observedCurrentTargets, 6, 'hero and opponent replacements are the only observed targets');
assert.strictEqual(snapshot.detachedRetainedTargets, 0);
assert.deepStrictEqual(repeatedRemountSnapshot, { liveSeatMappingEntries: 1, liveAnchorMappingEntries: 1, observedCurrentTargets: 1, detachedRetainedTargets: 0, previousDomSeatEntries: 1, confirmedSeatMappings: 1 });
console.log('Repeated seat remount, detach, and ResizeObserver cleanup regressions passed.');
