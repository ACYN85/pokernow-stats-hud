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
assert.deepStrictEqual([initial.actual.pillRect.left, initial.actual.pillRect.top], [410, 270], 'certified default remains exact');
var rightBeforeDrag = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)'));

var valueTarget = harness.document.querySelector('.pnhud-pot-odds-label');
var valueDown = pointer.pointerEvent('pointerdown', valueTarget, { pointerId: 40, clientX: 100, clientY: 100 });
pointer.bubble(harness, valueTarget, valueDown);
assert.strictEqual(valueDown.defaultPrevented, false, 'values never initiate drag');
assert.strictEqual((harness.document._listeners.pointermove || []).length, 0, 'value press installs no drag listeners');

drag(harness, -40, -20, 41);
assertRelative(harness, -40, -20, '2 drag left/up');
var persisted = drag(harness, 75, 50, 42);
assertRelative(harness, 35, 30, '3 drag right/down');

var reloaded = harnessApi.createHarness({
  gameId: 'draggable-pot-odds-reload', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 5000, initialStorage: { hudUiPreferences: persisted }
});
assert.deepStrictEqual(reloaded.evaluationErrors, []);
frame(reloaded, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-RELOAD') }, 'reload');
assertRelative(reloaded, 35, 30, '4 reload restores offset');
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
assertRelative(reloaded, 35, 30, '6 preflop to flop');
var turn = harnessApi.boardRectsForLayout('live-full').concat([harnessApi.rect(706, 260, 58, 80)]);
reloaded.fixture.mountCommunityBoard(turn);
frame(reloaded, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'turn');
assertRelative(reloaded, 35, 30, '7 turn');
var river = turn.concat([harnessApi.rect(768, 260, 58, 80)]);
reloaded.fixture.mountCommunityBoard(river);
frame(reloaded, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'] }, 'river');
assertRelative(reloaded, 35, 30, '7 river');

reloaded.fixture.replaceBoardSlotOwner();
reloaded.runFor(260, 16);
assertRelative(reloaded, 35, 30, '9 board DOM remount');
frame(reloaded, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'terminal');
reloaded.fixture.removeCommunityBoard();
reloaded.runFor(240, 16);
assertRelative(reloaded, 35, 30, '8 between hands');
frame(reloaded, 'gC', activeState('DRAG-NEXT'), 'next-hand');
assertRelative(reloaded, 35, 30, '8 next hand');
assert.strictEqual(reloaded.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'same host survives lifecycle');

reloaded.fixture.setLayout('live-narrow');
reloaded.setViewport(900, 665, true);
reloaded.runFor(320, 16);
var resized = assertRelative(reloaded, 35, 30, '10 viewport/layout resize');
assert.deepStrictEqual([resized.placement.canonicalLeftCompanionRect.left, resized.placement.canonicalLeftCompanionRect.top], [260, 260]);

var beforeExtremeRight = JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)'));
var extremePreferences = drag(reloaded, 5000, 5000, 43);
var extremePlacement = harnessApi.placement(reloaded);
assert.deepStrictEqual([extremePreferences.potOddsOffsetX, extremePreferences.potOddsOffsetY], [5035, 5030], '11 extreme requested offset remains persisted');
assert.strictEqual(extremePlacement.viewportClampApplied, true, '11 viewport clamp applied');
assert.deepStrictEqual([extremePlacement.actualPanelRect.left, extremePlacement.actualPanelRect.top], [792, 597], '11 panel remains within 8px viewport margin');
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
assert.deepStrictEqual([reset.actual.pillRect.left, reset.actual.pillRect.top], [260, 260], 'reset returns immediately to current canonical LEFT slot');
assert.deepStrictEqual(JSON.parse(reloaded.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().rightCompanionRect)')), beforeExtremeRight, 'reset also leaves RIGHT geometry untouched');
assert.deepStrictEqual(rightBeforeDrag, { left: 836, top: 270, width: 100, height: 60, right: 936, bottom: 330 }, 'original RIGHT contract remains certified');

console.log('Draggable pot-odds production regressions passed.');
