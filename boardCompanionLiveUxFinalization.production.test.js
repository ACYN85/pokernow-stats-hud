'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointer = require('./testSupport/productionPointerEventHarness.js');

function activeState(handId, callAmount) {
  callAmount = Number(callAmount || 10);
  return {
    hI: handId, gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'], pot: 120,
    tB: { playerA: 'check', playerB: callAmount }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  };
}

function frame(harness, eventName, patch, label) {
  harnessApi.dispatchFrame(harness, harnessApi.socket(eventName, patch), label, harness.now());
  harness.runFor(320, 16);
}

function click(harness, selector) {
  var target = harness.document.querySelector(selector);
  assert.ok(target, 'click target exists: ' + selector);
  pointer.bubble(harness, target, pointer.pointerEvent('click', target, { button: 0 }));
  harness.runFor(32, 16);
  return target;
}

function drag(harness, deltaX, deltaY, pointerId) {
  var host = harness.document.getElementById('pnhud-hero-pot-odds');
  var handle = host.querySelector('.pnhud-pot-odds-title');
  pointer.installPointerCapture(handle);
  var down = pointer.pointerEvent('pointerdown', handle, { pointerId: pointerId, clientX: 100, clientY: 100, button: 0 });
  pointer.bubble(harness, handle, down);
  assert.strictEqual(down.defaultPrevented, true, 'delegated title pointerdown is accepted');
  assert.strictEqual(handle.hasPointerCapture(pointerId), true, 'pointer capture is established');
  var belowThreshold = pointer.documentPointer(harness, 'pointermove', handle, { pointerId: pointerId, clientX: 102, clientY: 101 });
  assert.strictEqual(belowThreshold.defaultPrevented, false, 'movement below 4px threshold is not consumed');
  var move = pointer.documentPointer(harness, 'pointermove', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  assert.strictEqual(move.defaultPrevented, true, 'movement over threshold renders immediately');
  pointer.documentPointer(harness, 'pointerup', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  harness.runFor(64, 16);
}

function invariantSnapshot(harness) {
  var info = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
  var actual = harnessApi.actualDomVisibility(harness);
  assert.strictEqual(actual.visible, true);
  return {
    epoch: info.layoutEpochId, owner: info.tableOwnerSource, viewport: info.viewport, table: info.tableViewportRect, transform: info.tableTransform,
    local: info.canonicalBoardLocalRect, board: info.canonicalBoardViewportRect, left: info.canonicalLeftCompanionRect,
    right: info.canonicalRightCompanionRect, offset: info.featureOffset, panel: { left: actual.pillRect.left, top: actual.pillRect.top }, info: info
  };
}

function assertInvariant(reference, current, label) {
  ['epoch', 'owner', 'viewport', 'table', 'transform', 'local', 'board', 'left', 'right', 'offset', 'panel'].forEach(function (key) {
    assert.deepStrictEqual(current[key], reference[key], label + ': ' + key + ' remains stable');
  });
}

var preferences = settings.merge(settings.DEFAULTS, { selectedSettingsSection: 'hud' });
var harness = harnessApi.createHarness({
  gameId: 'board-companion-live-ux-finalization', layout: 'live-full', liveCardDom: true, boardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 1000, initialStorage: { hudUiPreferences: preferences }
});
frame(harness, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('LIVE-UX-1', 10) }, 'initial-live-ux');

drag(harness, 25, -10, 501);
var reference = invariantSnapshot(harness);
assert.deepStrictEqual(reference.offset, { x: 25, y: -10 }, 'drag persists feature-local offset');
assert.strictEqual(reference.info.boardAlignment.firstSlotDeltaX, 0);
assert.strictEqual(reference.info.boardAlignment.firstSlotDeltaY, 0);
assert.deepStrictEqual(reference.info.boardAlignment.expectedFirstSlotRect, { left: 520, top: 260, width: 58, height: 80, right: 578, bottom: 340 });
assert.deepStrictEqual(reference.info.boardAlignment.observedFirstVisibleCardRect, reference.info.boardAlignment.expectedFirstSlotRect);
assert.strictEqual(reference.info.boardAlignment.withinTolerance, true);

// Recreate the live failure shape: Settings owns a measurable <main>, and the real
// table is later in document order. Selector priority and extension ownership must
// still retain the connected PokerNow table owner.
click(harness, '#pnhud-settings-launcher');
var settingsMain = harness.document.querySelector('#pnhud-settings-panel main');
settingsMain.setRect(harnessApi.rect(12, 50, 500, 600));
harness.fixture.table.remove();
harness.document.body.appendChild(harness.fixture.table);
harness.flushMutationObservers();
harness.runFor(160, 16);
assertInvariant(reference, invariantSnapshot(harness), 'Settings-owned main before the table');

click(harness, '[data-settings-section="appearance"]');
settingsMain = harness.document.querySelector('#pnhud-settings-panel main');
settingsMain.setRect(harnessApi.rect(12, 50, 500, 600));
harness.flushMutationObservers(); harness.runFor(48, 16);
assertInvariant(reference, invariantSnapshot(harness), 'Settings tab switch');
click(harness, '.pnhud-settings-close');
assertInvariant(reference, invariantSnapshot(harness), 'Settings close');

for (var cycle = 0; cycle < 100; cycle += 1) {
  click(harness, '#pnhud-settings-launcher');
  settingsMain = harness.document.querySelector('#pnhud-settings-panel main');
  settingsMain.setRect(harnessApi.rect(12, 50, 500, 600));
  harness.flushMutationObservers(); harness.runFor(16, 16);
  assertInvariant(reference, invariantSnapshot(harness), 'Settings open cycle ' + cycle);
  click(harness, '.pnhud-settings-close');
  assertInvariant(reference, invariantSnapshot(harness), 'Settings close cycle ' + cycle);
}

// Delegation belongs to the stable root, so both inner content refresh and an
// externally replaced host remain draggable.
var stableRoot = harness.document.getElementById('pnhud-pot-odds-root');
var host = harness.document.getElementById('pnhud-hero-pot-odds');
host.innerHTML = '';
frame(harness, 'gC', activeState('LIVE-UX-1', 60), 'content-refresh');
drag(harness, 5, 5, 502);
var afterContentRefresh = invariantSnapshot(harness);
assert.deepStrictEqual(afterContentRefresh.offset, { x: 30, y: -5 }, 'content refresh keeps delegated dragging');

host = harness.document.getElementById('pnhud-hero-pot-odds');
host.remove();
frame(harness, 'gC', activeState('LIVE-UX-2', 188), 'host-replacement');
assert.strictEqual(harness.document.getElementById('pnhud-pot-odds-root'), stableRoot, 'delegated listener root identity survives host replacement');
drag(harness, -30, 5, 503);
var afterHostReplacement = invariantSnapshot(harness);
assert.deepStrictEqual(afterHostReplacement.offset, { x: -30, y: 5 }, 'new measured hand resets first, then replacement host remains draggable');

click(harness, '#pnhud-settings-launcher');
click(harness, '[data-settings-section="hud"]');
var resetButton = harness.document.querySelector('.pnhud-reset-pot-odds-position');
assert.ok(resetButton, 'HUD Settings exposes Reset Pot Odds Position');
pointer.bubble(harness, resetButton, pointer.pointerEvent('click', resetButton, { button: 0 }));
harness.runFor(64, 16);
var reset = invariantSnapshot(harness);
assert.deepStrictEqual(reset.offset, { x: 0, y: 0 }, 'reset writes only 0/0 feature offset');
assert.deepStrictEqual(reset.panel, { left: reset.left.left, top: reset.left.top }, 'reset actual rect equals canonical LEFT');
assert.strictEqual(reset.info.offsetMutationSource.reasonCode, 'RESET_POSITION');

var widgetHtml = harness.document.querySelector('.pnhud-pot-odds').innerHTML;
var widgetTitle = harness.document.querySelector('.pnhud-pot-odds').getAttribute('title');
assert.ok(!String(widgetHtml).includes('$') && !String(widgetTitle).includes('$'), 'pot-odds UI and tooltip contain no currency symbol');

var history = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.eventHistory())'));
assert.strictEqual(history.capacity, 160);
assert.ok(history.events.some(function (event) { return event.type === 'settings-open'; }));
assert.ok(history.events.some(function (event) { return event.type === 'settings-close'; }));
assert.ok(history.events.some(function (event) { return event.type === 'drag-capture'; }));
assert.ok(history.events.every(function (event) { return event.type !== 'ILLEGAL_SETTINGS_OFFSET_CHANGE'; }), 'Settings never attempts an offset write');
assert.deepStrictEqual(harness.evaluationErrors, []);
console.log('BoardCompanion final live UX production regressions passed.');
