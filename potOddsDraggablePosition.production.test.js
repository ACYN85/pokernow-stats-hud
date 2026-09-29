'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointer = require('./testSupport/productionPointerEventHarness.js');

function frame(harness, eventName, patch, label) {
  harnessApi.dispatchFrame(harness, harnessApi.socket(eventName, patch), label, harness.now());
  harness.runFor(320, 16);
}

function activeState(handId, values) {
  return Object.assign({
    hI: handId, gT: ['holdem', 0], board: [], pot: 120,
    tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  }, values || {});
}

function assertRelative(harness, x, y, label) {
  var placement = harnessApi.placement(harness);
  var actual = harnessApi.actualDomVisibility(harness);
  assert.strictEqual(actual.visible, true, label + ': visible');
  assert.strictEqual(placement.selectedSide, 'left', label + ': LEFT remains selected');
  assert.deepStrictEqual([placement.persistedOffsetX, placement.persistedOffsetY], [x, y], label + ': persisted offsets');
  assert.strictEqual(actual.pillRect.left, placement.canonicalLeftCompanionRect.left + x, label + ': relative x');
  assert.strictEqual(actual.pillRect.top, placement.canonicalLeftCompanionRect.top + y, label + ': relative y');
  assert.strictEqual(placement.viewportClampApplied, false, label + ': unclamped');
  var boardInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
  assert.deepStrictEqual(boardInfo.canonicalLeftCompanionRect, placement.canonicalLeftCompanionRect, label + ': shared diagnostics retain canonical LEFT');
  assert.deepStrictEqual([boardInfo.persistedOffsetX, boardInfo.persistedOffsetY], [x, y], label + ': shared diagnostics expose persisted offset');
  assert.deepStrictEqual(boardInfo.unclampedActualRect, placement.unclampedActualRect, label + ': shared diagnostics expose requested rectangle');
  assert.deepStrictEqual(boardInfo.actualPanelRect, placement.actualPanelRect, label + ': shared diagnostics expose rendered rectangle');
  assert.strictEqual(boardInfo.viewportClampApplied, false, label + ': shared diagnostics expose clamp state');
  return { placement: placement, actual: actual };
}

function drag(harness, deltaX, deltaY, pointerId) {
  var host = harness.document.getElementById('pnhud-hero-pot-odds');
  var handle = host.querySelector('.pnhud-pot-odds-title');
  pointer.installPointerCapture(handle);
  var down = pointer.pointerEvent('pointerdown', handle, { pointerId: pointerId, clientX: 100, clientY: 100, button: 0 });
  pointer.bubble(harness, handle, down);
  assert.strictEqual(down.defaultPrevented, true, 'accepted title pointerdown claims the drag gesture before browser button defaults can compete');
  assert.strictEqual(handle.hasPointerCapture(pointerId), true, 'title owns pointer capture');
  var move = pointer.documentPointer(harness, 'pointermove', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  assert.strictEqual(move.defaultPrevented, true, 'movement beyond threshold is consumed');
  assert.strictEqual(host.classList.contains('pnhud-pot-odds-dragging'), true, 'feature-owned dragging class is active');
  assert.strictEqual(JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().draggingNow)')), true, 'diagnostics report active drag');
  var up = pointer.documentPointer(harness, 'pointerup', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  assert.strictEqual(up.defaultPrevented, true, 'moved pointerup commits the drag');
  assert.strictEqual(host.classList.contains('pnhud-pot-odds-dragging'), false);
  assert.strictEqual(handle.hasPointerCapture(pointerId), false, 'pointer capture is released');
  return harness.storage.hudUiPreferences;
}

var initialPreferences = settings.merge(settings.DEFAULTS, { selectedSettingsSection: 'hud' });
var harness = harnessApi.createHarness({
  gameId: 'draggable-pot-odds', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 1000, initialStorage: { hudUiPreferences: initialPreferences }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
frame(harness, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-1') }, 'initial');
var initial = assertRelative(harness, 0, 0, '1 default');
assert.deepStrictEqual([initial.actual.pillRect.left, initial.actual.pillRect.top], [434, 272], 'compact default remains exact');
var rightBeforeDrag = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)'));

var valueTarget = harness.document.querySelector('.pnhud-pot-odds-label');
var valueDown = pointer.pointerEvent('pointerdown', valueTarget, { pointerId: 40, clientX: 100, clientY: 100 });
pointer.bubble(harness, valueTarget, valueDown);
assert.strictEqual(valueDown.defaultPrevented, false, 'values never initiate drag');
assert.strictEqual((harness.document._listeners.pointermove || []).length, 0, 'value press installs no drag listeners');

drag(harness, -40, -20, 41);
assertRelative(harness, -40, -20, '2 drag left/up');
drag(harness, 75, 50, 42);
assertRelative(harness, 35, 30, '3 drag right/down');
var manualOverrideStorageKey = Object.keys(harness.storage).find(function (key) { return /^pokerNowHudPotOddsBoardReset:/.test(key); });
var atomicDragWrite = harness.storageWrites[harness.storageWrites.length - 1];
assert.ok(manualOverrideStorageKey && atomicDragWrite.hudUiPreferences && atomicDragWrite[manualOverrideStorageKey], '3 drag persists offset and current-hand override in one storage write');

var sameHandPreflopReload = harnessApi.createHarness({
  gameId: 'draggable-pot-odds', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 3500, initialStorage: harness.storage
});
assert.deepStrictEqual(sameHandPreflopReload.evaluationErrors, []);
frame(sameHandPreflopReload, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-1') }, 'same-hand-preflop-reload');
assertRelative(sameHandPreflopReload, 35, 30, '3 same-hand preflop reload restores manual intent');
sameHandPreflopReload.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
frame(sameHandPreflopReload, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'same-hand-reload-flop');
assertRelative(sameHandPreflopReload, 35, 30, '3 same-hand preflop reload preserves drag through flop');

var reloaded = harnessApi.createHarness({
  gameId: 'draggable-pot-odds', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 5000, initialStorage: harness.storage
});
assert.deepStrictEqual(reloaded.evaluationErrors, []);
frame(reloaded, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-1') }, 'reload');
assertRelative(reloaded, 35, 30, '4 same-hand reload restores offset');
var stableHost = reloaded.document.getElementById('pnhud-hero-pot-odds');

var enabled = harnessApi.clone(reloaded.storage.hudUiPreferences);
var disabled = Object.assign({}, enabled, { showPotOdds: false });
reloaded.emitStorageChange({ hudUiPreferences: { oldValue: enabled, newValue: disabled } });
reloaded.runFor(180, 16);
assert.strictEqual(harnessApi.actualDomVisibility(reloaded).visible, false, '5 setting OFF hides');
reloaded.emitStorageChange({ hudUiPreferences: { oldValue: disabled, newValue: enabled } });
reloaded.runFor(240, 16);
assertRelative(reloaded, 35, 30, '5 setting ON preserves offset');

reloaded.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
frame(reloaded, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'flop');
assertRelative(reloaded, 35, 30, '6 first measured flop preserves preflop drag');
assert.deepStrictEqual([reloaded.storage.hudUiPreferences.potOddsOffsetX, reloaded.storage.hudUiPreferences.potOddsOffsetY], [35, 30], '6 first measured flop never rewrites the manual offset');
var turn = harnessApi.boardRectsForLayout('live-full').concat([harnessApi.rect(706, 260, 58, 80)]);
reloaded.fixture.mountCommunityBoard(turn);
frame(reloaded, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'turn');
assertRelative(reloaded, 35, 30, '7 turn preserves post-flop move');
var river = turn.concat([harnessApi.rect(768, 260, 58, 80)]);
reloaded.fixture.mountCommunityBoard(river);
frame(reloaded, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'] }, 'river');
assertRelative(reloaded, 35, 30, '7 river preserves post-flop move');

reloaded.fixture.replaceBoardSlotOwner();
reloaded.runFor(260, 16);
assertRelative(reloaded, 35, 30, '9 board DOM remount');
frame(reloaded, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'terminal');
reloaded.runFor(240, 16);
assertRelative(reloaded, 35, 30, '8 between hands');
var nextHandPositionWrites = reloaded.storageWrites.length;
frame(reloaded, 'gC', activeState('DRAG-NEXT'), 'next-hand');
assertRelative(reloaded, 35, 30, '8 next hand keeps user offset despite stale prior-flop DOM');
assert.strictEqual(reloaded.storageWrites.slice(nextHandPositionWrites).some(function (write) { return Object.keys(write).some(function (key) { return /PotOddsBoardReset|hudUiPreferences/.test(key); }); }), false, '8 new hand does not write a position reset');
reloaded.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
frame(reloaded, 'gC', { gT: ['holdem', 1], board: ['Qs', 'Jd', '3c'] }, 'next-flop');
assertRelative(reloaded, 35, 30, '8 next hand first measured flop preserves saved offset');
assert.strictEqual(reloaded.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'same host survives lifecycle');

var postflopReload = harnessApi.createHarness({
  gameId: 'draggable-pot-odds', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 12000, initialStorage: reloaded.storage
});
assert.deepStrictEqual(postflopReload.evaluationErrors, []);
postflopReload.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
frame(postflopReload, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-NEXT', { gT: ['holdem', 1], board: ['Qs', 'Jd', '3c'] }) }, 'same-hand-postflop-reload');
assertRelative(postflopReload, 35, 30, '8 same-hand postflop reload preserves drag');

frame(reloaded, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'next-terminal');
frame(reloaded, 'gC', activeState('DRAG-NEXT-2'), 'second-following-hand');
assertRelative(reloaded, 35, 30, '8 second following hand also keeps user offset');
var nextHandReload = harnessApi.createHarness({
  gameId: 'draggable-pot-odds', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 14000, initialStorage: reloaded.storage
});
frame(nextHandReload, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-NEXT-2') }, 'next-hand-reload');
assertRelative(nextHandReload, 35, 30, '8 next-hand reload preserves saved user placement');

reloaded.fixture.setLayout('live-narrow');
reloaded.setViewport(900, 665, true);
reloaded.triggerResizeObserver(reloaded.fixture.boardSlot);
reloaded.runFor(320, 16);
var resized = assertRelative(reloaded, 35, 30, '10 viewport/layout resize');
assert.deepStrictEqual([resized.placement.canonicalLeftCompanionRect.left, resized.placement.canonicalLeftCompanionRect.top], [284, 262]);

var beforeExtremeRight = JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)'));
var extremePreferences = drag(reloaded, 5000, 5000, 43);
var extremePlacement = harnessApi.placement(reloaded);
assert.deepStrictEqual([extremePreferences.potOddsOffsetX, extremePreferences.potOddsOffsetY], [5035, 5030], '11 extreme requested offset remains persisted');
assert.strictEqual(extremePlacement.viewportClampApplied, true, '11 viewport clamp applied');
assert.deepStrictEqual([extremePlacement.actualPanelRect.left, extremePlacement.actualPanelRect.top], [816, 601], '11 panel remains within 8px viewport margin');
assert.ok(extremePlacement.unclampedActualRect.left > reloaded.contextWindow.innerWidth, 'unclamped requested rectangle remains diagnostic');
var extremeBoardInfo = JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.strictEqual(extremeBoardInfo.viewportClampApplied, true, 'shared diagnostics report extreme clamp');
assert.deepStrictEqual([extremeBoardInfo.persistedOffsetX, extremeBoardInfo.persistedOffsetY], [5035, 5030]);
assert.deepStrictEqual(extremeBoardInfo.actualPanelRect, extremePlacement.actualPanelRect);
assert.deepStrictEqual(JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)')), beforeExtremeRight, '13 RIGHT geometry ignores pot-odds drag');

var resetButton = reloaded.document.querySelector('.pnhud-reset-pot-odds-position');
assert.ok(resetButton, '12 Settings exposes reset action');
pointer.bubble(reloaded, resetButton, pointer.pointerEvent('click', resetButton, { button: 0 }));
reloaded.runFor(120, 16);
var reset = assertRelative(reloaded, 0, 0, '12 reset position');
var resetBoardStateKey = Object.keys(reloaded.storage).find(function (key) { return /^pokerNowHudPotOddsBoardReset:/.test(key); });
var atomicResetWrite = reloaded.storageWrites[reloaded.storageWrites.length - 1];
assert.ok(resetBoardStateKey && atomicResetWrite.hudUiPreferences && atomicResetWrite[resetBoardStateKey], '12 Reset persists zero offset and cleared manual override atomically');
assert.deepStrictEqual([reset.actual.pillRect.left, reset.actual.pillRect.top], [284, 262], 'reset returns immediately to current canonical LEFT slot');
frame(reloaded, 'gC', activeState('DRAG-AFTER-RESET'), 'hand-after-reset');
assertRelative(reloaded, 0, 0, '12 hand after Reset remains canonical LEFT');
assert.deepStrictEqual(JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)')), beforeExtremeRight, 'reset also leaves RIGHT geometry untouched');
assert.deepStrictEqual(rightBeforeDrag, { left: 836, top: 270, width: 100, height: 60, right: 936, bottom: 330 }, 'original RIGHT contract remains certified');

// Synthetic table-transform changes exercise the coordinate math used when
// PokerNow rescales its table during browser zoom. This is not a Chrome Ctrl+/Ctrl-
// automation substitute; signed-in page-zoom remains a manual smoke boundary.
var zoomHarness = harnessApi.createHarness({
  gameId: 'draggable-pot-odds-zoom-scale', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 18000, initialStorage: { hudUiPreferences: initialPreferences }
});
frame(zoomHarness, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-ZOOM') }, 'zoom-preflop');
zoomHarness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
drag(zoomHarness, 40, -20, 71);
assertRelative(zoomHarness, 40, -20, '14 preflop table-local drag with stale board DOM');

var zoomGeometry = {
  table: harnessApi.rect(0, 0, 1280, 665),
  boardSlot: zoomHarness.fixture.boardSlot.getBoundingClientRect(),
  slots: zoomHarness.fixture.boardSlots.map(function (slot) { return slot.getBoundingClientRect(); }),
  cards: zoomHarness.fixture.board.elements.map(function (card) { return card.getBoundingClientRect(); })
};
function scaledRect(value, scale) { return harnessApi.rect(value.left * scale, value.top * scale, value.width * scale, value.height * scale); }
function applyTableScale(scale, devicePixelRatio, label) {
  zoomHarness.setViewport(zoomGeometry.table.width * scale, zoomGeometry.table.height * scale, false);
  zoomHarness.fixture.table.clientWidth = zoomGeometry.table.width;
  zoomHarness.fixture.table.clientHeight = zoomGeometry.table.height;
  zoomHarness.fixture.table.style.transform = scale === 1 ? 'none' : 'matrix(' + scale + ', 0, 0, ' + scale + ', 0, 0)';
  zoomHarness.contextWindow.devicePixelRatio = devicePixelRatio;
  zoomHarness.contextWindow.visualViewport.scale = 1;
  zoomHarness.fixture.boardSlot.setRect(scaledRect(zoomGeometry.boardSlot, scale));
  zoomHarness.fixture.boardSlots.forEach(function (slot, index) { slot.setRect(scaledRect(zoomGeometry.slots[index], scale)); });
  zoomHarness.fixture.board.elements.forEach(function (card, index) { card.setRect(scaledRect(zoomGeometry.cards[index], scale)); });
  zoomHarness.dispatchWindowEvent('resize');
  zoomHarness.triggerResizeObserver(zoomHarness.fixture.table);
  zoomHarness.runFor(360, 16);
  var placement = harnessApi.placement(zoomHarness); var actual = harnessApi.actualDomVisibility(zoomHarness);
  assert.strictEqual(actual.visible, true, label + ': panel remains onscreen and painted');
  assert.strictEqual(Math.round((placement.canonicalBoardRect.left - placement.canonicalLeftCompanionRect.right) * 10) / 10, 10, label + ': canonical LEFT gap');
  assert.strictEqual(Math.round((placement.rightCompanionRect.left - placement.canonicalBoardRect.right) * 10) / 10, 10, label + ': canonical RIGHT gap');
  assert.strictEqual(Math.round(((placement.canonicalLeftCompanionRect.top + placement.canonicalLeftCompanionRect.height / 2) - (placement.canonicalBoardRect.top + placement.canonicalBoardRect.height / 2)) * 10) / 10, 0, label + ': vertical center alignment');
  return { placement: placement, actual: actual };
}
function assertScaledOffset(result, x, y, scale, label) {
  assert.deepStrictEqual([result.placement.persistedOffsetX, result.placement.persistedOffsetY], [x, y], label + ': table-local offset persists');
  assert.strictEqual(Math.round((result.actual.pillRect.left - result.placement.canonicalLeftCompanionRect.left) * 10) / 10, Math.round(x * scale * 10) / 10, label + ': x displacement is projected');
  assert.strictEqual(Math.round((result.actual.pillRect.top - result.placement.canonicalLeftCompanionRect.top) * 10) / 10, Math.round(y * scale * 10) / 10, label + ': y displacement is projected');
}
function clickZoomReset(label) {
  var button = zoomHarness.document.querySelector('.pnhud-reset-pot-odds-position');
  pointer.bubble(zoomHarness, button, pointer.pointerEvent('click', button, { button: 0 }));
  zoomHarness.runFor(160, 16);
  var placement = harnessApi.placement(zoomHarness); var actual = harnessApi.actualDomVisibility(zoomHarness);
  assert.deepStrictEqual([placement.persistedOffsetX, placement.persistedOffsetY], [0, 0], label + ': reset stores exact local zero');
  assert.deepStrictEqual([actual.pillRect.left, actual.pillRect.top], [placement.canonicalLeftCompanionRect.left, placement.canonicalLeftCompanionRect.top], label + ': reset resolves to current canonical LEFT');
}

var at125 = applyTableScale(0.8, 1.25, '15 125% equivalent');
assertScaledOffset(at125, 40, -20, 0.8, '15 125% equivalent');
frame(zoomHarness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'zoom-flop-after-preflop-manual-drag');
assertScaledOffset({ placement: harnessApi.placement(zoomHarness), actual: harnessApi.actualDomVisibility(zoomHarness) }, 40, -20, 0.8, '15 preflop drag survives zoom and first measured flop');
frame(zoomHarness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'zoom-turn-after-manual-flop');
assertScaledOffset({ placement: harnessApi.placement(zoomHarness), actual: harnessApi.actualDomVisibility(zoomHarness) }, 40, -20, 0.8, '15 turn preserves manual override');
frame(zoomHarness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'] }, 'zoom-river-after-manual-flop');
assertScaledOffset({ placement: harnessApi.placement(zoomHarness), actual: harnessApi.actualDomVisibility(zoomHarness) }, 40, -20, 0.8, '15 river preserves manual override');
clickZoomReset('15 125% equivalent');
drag(zoomHarness, 32, -16, 72);
assertScaledOffset({ placement: harnessApi.placement(zoomHarness), actual: harnessApi.actualDomVisibility(zoomHarness) }, 40, -20, 0.8, '15 drag at 125% equivalent');
var backFrom125 = applyTableScale(1, 1, '16 100% restored from 125%');
assertScaledOffset(backFrom125, 40, -20, 1, '16 100% restored from 125%');
clickZoomReset('16 100% restored from 125%');

var at80 = applyTableScale(1.25, 0.8, '17 80% equivalent');
clickZoomReset('17 80% equivalent');
drag(zoomHarness, 50, -25, 73);
assertScaledOffset({ placement: harnessApi.placement(zoomHarness), actual: harnessApi.actualDomVisibility(zoomHarness) }, 40, -20, 1.25, '17 drag at 80% equivalent');
var backFrom80 = applyTableScale(1, 1, '18 100% restored from 80%');
assertScaledOffset(backFrom80, 40, -20, 1, '18 100% restored from 80%');
clickZoomReset('18 100% restored from 80%');
assert.deepStrictEqual(zoomHarness.evaluationErrors, []);

console.log('Draggable pot-odds production regressions passed.');
