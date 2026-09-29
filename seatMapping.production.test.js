'use strict';

var assert = require('assert');
var fs = require('fs');
var overlays = require('./seatOverlay.js');

function player(playerId, name, stack, seatIndex, orderIndex) {
  return { playerId: playerId, name: name, stack: stack, seatIndex: seatIndex, orderIndex: orderIndex };
}

function seat(elementId, name, stack, directPlayerIds, seatIndex, clockwiseIndex) {
  return { elementId: elementId, displayedName: name, displayedStack: stack, directPlayerIds: directPlayerIds || [], seatIndex: seatIndex, clockwiseIndex: clockwiseIndex };
}

var players = [player('socket-playerA', 'PlayerA', 120, 1, 0), player('socket-playerB', 'PlayerB', 80, 2, 1)];
var seats = [seat('dom-playerA', 'PlayerA', 120, ['socket-playerA'], 1, 0), seat('dom-playerB', 'PlayerB', 80, ['socket-playerB'], 2, 1)];
var assignment = overlays.assignPlayersToSeats(players, seats);
assert.strictEqual(assignment.assignments.length, 2, 'two visible players receive two assignments');
assert.strictEqual(new Set(assignment.assignments.map(function (item) { return item.seat.elementId; })).size, 2, 'each player receives a unique DOM seat');
assert.deepStrictEqual(assignment.assignments.map(function (item) { return item.player.playerId + ':' + item.seat.elementId; }).sort(), ['socket-playerA:dom-playerA', 'socket-playerB:dom-playerB']);
var capturedPokerNowPlayers = [player('5sUmsw4kpC', 'ial', 312, 2, 0), player('Lwy-ervQBl', 'playerA', 280, 6, 1)];
var capturedPokerNowSeats = [seat('table-player-2', 'ial', 312, ['5sUmsw4kpC'], 2, 0), seat('table-player-6', 'playerA', 280, ['Lwy-ervQBl'], 6, 1)];
capturedPokerNowSeats[0].inactive = true;
var capturedAssignment = overlays.assignPlayersToSeats(capturedPokerNowPlayers, capturedPokerNowSeats);
assert.deepStrictEqual(capturedAssignment.assignments.map(function (item) { return item.player.playerId + ':' + item.seat.elementId; }).sort(), ['5sUmsw4kpC:table-player-2', 'Lwy-ervQBl:table-player-6'], 'captured PokerNow profile-link IDs assign ial and playerA to their own occupied seats');
var inactiveSeat = seat('dom-away', 'Away Player', 50, ['socket-away'], 3, 2);
inactiveSeat.occupied = false;
assert.strictEqual(overlays.assignPlayersToSeats([player('socket-away', 'Away Player', 50, 3, 2)], [inactiveSeat]).assignments.length, 0, 'sitting-out or offline seats cannot steal an occupied-player assignment');

var conflictPlayers = [player('p1', 'PlayerA', 200, 2, 0), player('p2', null, 100, 1, 1)];
var conflictSeats = [seat('seat-a', 'PlayerA', 100, ['p2'], 1, 0), seat('seat-b', 'Opponent', 200, [], 2, 1)];
var globalResult = overlays.assignPlayersToSeats(conflictPlayers, conflictSeats);
assert.deepStrictEqual(globalResult.assignments.map(function (item) { return item.player.playerId + ':' + item.seat.elementId; }).sort(), ['p1:seat-b', 'p2:seat-a'], 'global matching avoids the greedy name-match conflict and preserves the direct-ID seat');

assert.strictEqual(overlays.exactNameMatch('ial', 'playerA'), false, 'a truncated substring is never an exact normalized name match');
var truncatedOnly = overlays.assignPlayersToSeats([player('partial', 'playerA', null, null, null)], [seat('partial-seat', 'ial', null, [], null, null)]);
assert.strictEqual(truncatedOnly.assignments.length, 0, 'a truncated name cannot create a seat assignment without corroboration');
var uniqueStackOnly = overlays.assignPlayersToSeats([player('stack-only', null, 77, null, null)], [seat('stack-only-seat', 'Someone', 77, [], null, null)]);
assert.strictEqual(uniqueStackOnly.assignments.length, 0, 'a unique stack without agreeing seat order remains withheld');
var corroboratedNoName = overlays.assignPlayersToSeats([player('ordered', null, 77, 4, null)], [seat('ordered-seat', 'Someone', 77, [], 4, null)]);
assert.strictEqual(corroboratedNoName.assignments.length, 1, 'seat order plus unique stack can confirm a non-name assignment');
var offlineOwnSeat = seat('offline-seat', 'ial', 312, ['5sUmsw4kpC'], 2, 0);
offlineOwnSeat.inactive = true;
assert.strictEqual(overlays.assignPlayersToSeats([player('5sUmsw4kpC', 'ial', 312, 2, 0)], [offlineOwnSeat]).assignments.length, 1, 'an occupied offline seat can retain its own direct-ID assignment without stealing another seat');

var anchor = overlays.chooseAnchorCandidate([
  { kind: 'blind-or-bet-marker', isBlindOrBetMarker: true, rect: { left: 400, top: 200, width: 24, height: 16 }, reference: 'blind' },
  { kind: 'occupied-seat-wrapper', containsExactName: true, rect: { left: 300, top: 100, width: 220, height: 120 }, reference: 'seat' },
  { kind: 'name-stack-block', containsExactName: true, containsCurrentStack: true, rect: { left: 330, top: 120, width: 100, height: 38 }, reference: 'name-stack' },
  { kind: 'blind-or-bet-marker', isSeatNumber: true, rect: { left: 290, top: 90, width: 20, height: 20 }, reference: 'seat-number' }
]);
assert.strictEqual(anchor.selected.kind, 'name-stack-block', 'the name/stack block wins over blind, bet, and broad seat markers');
assert.ok(anchor.ranked.filter(function (candidate) { return candidate.isBlindOrBetMarker || candidate.isSeatNumber; }).every(function (candidate) { return candidate.score < 0; }), 'blind, bet, and seat-number elements are ineligible anchors');
assert.strictEqual(overlays.identityLabel('playerA', '5sUm-long-id'), 'playerA [5sUm]', 'temporary overlay label exposes the full name and short socket ID');

var placement = overlays.placeOverlay(anchor.selected.rect, { width: 140, height: 20 }, { width: 1000, height: 700 }, 6);
assert.strictEqual(placement.left, 310, 'overlay is horizontally centered on the name/stack block');
assert.strictEqual(placement.top, 164, 'overlay appears directly beneath the name/stack block');

var adapterCalls = { creates: 0, moves: 0, positions: 0 };
var controller = overlays.createController({
  create: function () { adapterCalls.creates += 1; return {}; },
  update: function () {},
  move: function () { adapterCalls.moves += 1; },
  position: function () { adapterCalls.positions += 1; },
  remove: function () {},
  skip: function () {}
});
function overlayEntry(id, name, seatId, left) { return { playerId: id, name: name, seatId: seatId, confirmed: true, rect: { left: left, top: 100, width: 100, height: 30 }, stats: { handsPlayed: 0, vpip: 0, pfr: 0, af: 0 } }; }
controller.reconcile([overlayEntry('p1', 'PlayerA', 'seat-1', 10), overlayEntry('p2', 'PlayerB', 'seat-2', 210)], { displayMode: 'seat-overlays-only' });
assert.strictEqual(controller.records.size, 2, 'zero-hand players remain eligible for seat overlays');
controller.reconcile([overlayEntry('p1', 'PlayerA', 'seat-1-new', 12), overlayEntry('p2', 'PlayerB', 'seat-2-new', 212)], { displayMode: 'seat-overlays-only' });
assert.strictEqual(controller.records.size, 2, 'seat rerender preserves both mappings without duplication');
assert.strictEqual(adapterCalls.creates, 2);
assert.strictEqual(adapterCalls.moves, 2);
assert.strictEqual(adapterCalls.positions, 2, 'both overlays are repositioned after their seat anchors are recreated');

var resizedPlacement = overlays.placeOverlay({ left: 930, top: 640, width: 100, height: 30 }, { width: 140, height: 20 }, { width: 1000, height: 700 }, 6);
assert.ok(resizedPlacement.left <= 856 && resizedPlacement.top <= 676, 'resize placement is recomputed and clamped inside the viewport');

var productionContent = fs.readFileSync('./content.js', 'utf8');
var productionCss = fs.readFileSync('./hud.css', 'utf8');
var productionPopup = fs.readFileSync('./popup.js', 'utf8');
assert.ok(productionContent.includes('data-pnhud-player-id="\' + escapeHtml(entry.playerId)'), 'production overlays route the interactive full name by canonical stable player ID');
assert.ok(productionContent.includes("String(entry.playerId || '').slice(0, 4)"), 'the optional debug identity still renders a subdued short stable ID');
assert.ok(productionContent.includes("'[HUD MAP DEBUG] pairing score'"), 'production mapping logs every scored player-seat pairing');
assert.ok(productionContent.includes("'[HUD SEAT ANCHOR] candidate'"), 'production anchor selection logs every inspected element');
assert.ok(productionContent.includes('window.visualViewport.addEventListener'), 'production placement reacts to viewport changes including docked DevTools');
assert.ok(productionContent.includes("a[href^=\"/players/\"]"), 'production identity parsing uses PokerNow player profile links as direct socket-ID evidence');
assert.ok(productionContent.includes("element.querySelector('.table-player-stack')"), 'production stack parsing prefers PokerNow actual stack element over bet chips');
assert.ok(productionContent.includes("'[HUD NAME PARSE]'"), 'production name parsing reports fragments and the selected full name');
assert.ok(productionContent.includes("'[HUD MAP DEBUG] assignment summary'"), 'production mapping reports assignment and withheld counts');
assert.ok(productionContent.includes('pnhud-withheld-placeholder'), 'production includes opt-in withheld-seat placeholders');
assert.ok(productionContent.includes('var debugSeatIdentity = false;'), 'seat identity labels are disabled by default');
assert.ok(productionContent.includes("update[STORAGE_KEYS.debugSeatIdentity] = false"), 'old presentation preferences migrate to the clean non-debug default');
assert.ok(productionContent.includes("if (!showWithheldPlaceholders || !seatOverlaysVisible()) return;"), 'withheld placeholders are invisible unless explicitly enabled');
assert.ok(productionContent.includes('debugSeatIdentity ?'), 'the identity label remains available behind its debug preference');
assert.ok(productionContent.includes('collectOverlayObstacles(cleanAnchorRect)'), 'live placement checks the name, stack, cards, markers, bets, and controls before positioning');
assert.ok(productionContent.includes('PokerSeatOverlay.layoutCanonicalSeatHudOverlays'), 'live overlays use deterministic physical-seat canonical slots plus preserved manual offsets');
assert.ok(/white-space:\s*nowrap/.test(productionCss), 'compact overlays stay on one line');
assert.ok(/pointer-events:\s*none/.test(productionCss), 'compact overlays never intercept table input');
assert.ok(/max-width:\s*min\(420px,\s*calc\(100vw - 8px\)\)/.test(productionCss), 'configurable overlays expand predictably while remaining viewport-bounded');
assert.ok(productionPopup.includes('debugSeatIdentity.checked = Boolean(saved[DEBUG_SEAT_IDENTITY_KEY])'), 'the popup restores an explicitly enabled identity-debug setting after clean defaults are installed');
assert.ok(productionPopup.includes('withheldPlaceholders.checked = Boolean(saved[SHOW_WITHHELD_PLACEHOLDERS_KEY])'), 'the popup restores an explicitly enabled withheld-placeholder setting');

assert.deepStrictEqual(overlays.visibilityForMode('seat-overlays-only'), { mode: 'seat-overlays-only', overlaysVisible: true, detailsVisible: false });
assert.deepStrictEqual(overlays.visibilityForMode('seat-overlays-leaderboard'), { mode: 'seat-overlays-leaderboard', overlaysVisible: true, detailsVisible: true });
assert.deepStrictEqual(overlays.visibilityForMode('leaderboard-only'), { mode: 'leaderboard-only', overlaysVisible: false, detailsVisible: true });

console.log('Production global seat assignment, anchor placement, zero-hand, rerender, and display-mode tests passed.');
