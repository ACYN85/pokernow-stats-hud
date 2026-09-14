'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');
var position = require('./potOddsPosition.js');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointer = require('./testSupport/productionPointerEventHarness.js');

function activeState(handId, values) {
  return Object.assign({
    hI: handId, gT: ['holdem', 0], board: [], pot: 120,
    tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  }, values || {});
}

function frame(harness, eventName, patch, label, duration) {
  harnessApi.dispatchFrame(harness, harnessApi.socket(eventName, patch), label, harness.now());
  harness.runFor(duration === undefined ? 360 : duration, 16);
}

function click(harness, selector) {
  var element = harness.document.querySelector(selector);
  assert.ok(element, 'click target exists: ' + selector);
  pointer.bubble(harness, element, pointer.pointerEvent('click', element, { button: 0 }));
  harness.runFor(80, 16);
}

function drag(harness, deltaX, deltaY, pointerId) {
  var host = harness.document.getElementById('pnhud-hero-pot-odds');
  var handle = host.querySelector('.pnhud-pot-odds-title');
  pointer.installPointerCapture(handle);
  pointer.bubble(harness, handle, pointer.pointerEvent('pointerdown', handle, { pointerId: pointerId, clientX: 100, clientY: 100, button: 0 }));
  pointer.documentPointer(harness, 'pointermove', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  pointer.documentPointer(harness, 'pointerup', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  harness.runFor(96, 16);
}

function snapshot(harness, label) {
  var actual = harnessApi.actualDomVisibility(harness);
  var placement = harnessApi.placement(harness);
  var info = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
  assert.strictEqual(actual.visible, true, label + ': persistent panel is visible');
  assert.ok(info.layoutEpochId, label + ': layout epoch exists');
  assert.ok(info.tableOwnerSource, label + ': stable table owner is diagnosed');
  assert.ok(info.canonicalBoardLocalRect && info.canonicalBoardViewportRect, label + ': local and viewport canonical geometry exist');
  assert.ok(info.canonicalLeftCompanionRect && info.canonicalRightCompanionRect, label + ': LEFT and RIGHT share the model');
  return {
    label: label,
    epoch: info.layoutEpochId,
    local: info.canonicalBoardLocalRect,
    board: info.canonicalBoardViewportRect,
    left: info.canonicalLeftCompanionRect,
    right: info.canonicalRightCompanionRect,
    panel: { left: actual.pillRect.left, top: actual.pillRect.top, width: actual.pillRect.width, height: actual.pillRect.height },
    offset: [placement.persistedOffsetX, placement.persistedOffsetY],
    settingsVisible: info.settingsVisible,
    host: actual.host
  };
}

function assertSameBase(reference, sample, label) {
  assert.strictEqual(sample.epoch, reference.epoch, label + ': same layout epoch');
  assert.deepStrictEqual(sample.local, reference.local, label + ': same canonical boardLocalRect');
  assert.deepStrictEqual(sample.board, reference.board, label + ': same canonical board viewport rect');
  assert.deepStrictEqual(sample.left, reference.left, label + ': same canonical LEFT');
  assert.deepStrictEqual(sample.right, reference.right, label + ': same canonical RIGHT');
}

function assertPanel(sample, left, top, label) {
  assert.deepStrictEqual([sample.panel.left, sample.panel.top], [left, top], label + ': exact panel coordinates');
}

var defaults = settings.merge(settings.DEFAULTS, { selectedSettingsSection: 'hud' });
var harness = harnessApi.createHarness({
  gameId: 'stable-table-local-board-companion', layout: 'live-full', liveCardDom: true, boardDom: false, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 1000, initialStorage: { hudUiPreferences: defaults }
});

frame(harness, 'registered', {
  currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
  gameState: { pot: 0, board: [], iHPI: [], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: activeState('x').players }
}, 'between-hands');
var zeroReference = snapshot(harness, '1 between hands');
assertPanel(zeroReference, 410, 270, 'PHOTO-B default model');
assert.deepStrictEqual(zeroReference.offset, [0, 0]);

frame(harness, 'gC', activeState('STABLE-1'), 'first-preflop');
var zeroSamples = [snapshot(harness, '2 first preflop')];

harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'flop');
zeroSamples.push(snapshot(harness, '3 flop'));
var turnRects = harnessApi.boardRectsForLayout('live-full').concat([harnessApi.rect(706, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(turnRects);
frame(harness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'turn');
zeroSamples.push(snapshot(harness, '4 turn'));
var riverRects = turnRects.concat([harnessApi.rect(768, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(riverRects);
frame(harness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'], showdown: true }, 'river-showdown');
zeroSamples.push(snapshot(harness, '5 river/showdown'));
frame(harness, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'hand-end');
zeroSamples.push(snapshot(harness, '6 hand end'));
harness.fixture.removeCommunityBoard(); harness.runFor(240, 16);
zeroSamples.push(snapshot(harness, '7 between hands after board unmount'));
frame(harness, 'gC', activeState('STABLE-2'), 'next-preflop');
zeroSamples.push(snapshot(harness, '8 next preflop'));
zeroSamples.forEach(function (sample) { assertSameBase(zeroReference, sample, sample.label); assertPanel(sample, 410, 270, sample.label); });

var stableHost = zeroReference.host;
drag(harness, 75, -30, 201);
var manualReference = snapshot(harness, '9 drag +75/-30');
assertSameBase(zeroReference, manualReference, 'drag cannot mutate canonical layer');
assert.deepStrictEqual(manualReference.offset, [75, -30]);
assertPanel(manualReference, 485, 240, 'manual canonical + offset');

frame(harness, 'gC', activeState('STABLE-3'), 'manual-preflop');
var manualPreflop = snapshot(harness, '10 manual preflop');
assertSameBase(manualReference, manualPreflop, manualPreflop.label); assert.deepStrictEqual(manualPreflop.offset, [75, -30]); assertPanel(manualPreflop, 485, 240, manualPreflop.label);
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full')); frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'manual-flop');
var canonicalSamples = [snapshot(harness, '11 first measured board resets manual offset')];
harness.fixture.mountCommunityBoard(turnRects); frame(harness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'manual-turn'); canonicalSamples.push(snapshot(harness, '12 turn'));
harness.fixture.mountCommunityBoard(riverRects); frame(harness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'] }, 'manual-river'); canonicalSamples.push(snapshot(harness, '13 river'));
frame(harness, 'gC', { pGS: { playerA: 'fold', playerB: 'inGame' }, cPI: 'playerB', pITT: 'playerB' }, 'manual-fold'); canonicalSamples.push(snapshot(harness, '14 fold remains persistent'));
frame(harness, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'manual-hand-end'); harness.fixture.removeCommunityBoard(); harness.runFor(240, 16); canonicalSamples.push(snapshot(harness, '15 between hands'));
frame(harness, 'gC', activeState('STABLE-4', { players: { playerA: { id: 'playerA', name: 'playerA', stack: 0, allIn: true }, playerB: { id: 'playerB', name: 'playerB', stack: 0, allIn: true } } }), 'manual-allin-next-hand'); canonicalSamples.push(snapshot(harness, '16 all-in next hand'));
canonicalSamples.forEach(function (sample) { assertSameBase(zeroReference, sample, sample.label); assert.deepStrictEqual(sample.offset, [0, 0], sample.label + ': exact feature offset'); assertPanel(sample, 410, 270, sample.label); assert.strictEqual(sample.host, stableHost, sample.label + ': same host'); });

click(harness, '#pnhud-settings-launcher');
var settingsOpen = snapshot(harness, '17 Settings opens');
assertSameBase(zeroReference, settingsOpen, 'Settings open'); assertPanel(settingsOpen, 410, 270, 'Settings open'); assert.strictEqual(settingsOpen.settingsVisible, true);
click(harness, '[data-settings-section="general"]');
var tabChanged = snapshot(harness, '18 Settings switches tabs');
assertSameBase(zeroReference, tabChanged, 'Settings tab switch'); assertPanel(tabChanged, 410, 270, 'Settings tab switch');
click(harness, '[data-settings-section="hud"]');
var epochBeforeReset = snapshot(harness, 'Settings HUD tab restored').epoch;
click(harness, '.pnhud-reset-pot-odds-position');
var reset = snapshot(harness, '19 Reset while Settings open');
assert.strictEqual(reset.epoch, epochBeforeReset, 'reset cannot create an epoch');
assert.deepStrictEqual(reset.offset, [0, 0], 'reset owns only feature offset');
assertPanel(reset, 410, 270, 'reset returns to stable canonical LEFT');
click(harness, '.pnhud-settings-close');
var settingsClosed = snapshot(harness, '20 Settings closes');
assertSameBase(zeroReference, settingsClosed, 'Settings close'); assertPanel(settingsClosed, 410, 270, 'Settings close'); assert.strictEqual(settingsClosed.settingsVisible, false);

harness.fixture.replaceBoardSlotOwner(); harness.runFor(280, 16);
var wrapperRemount = snapshot(harness, '21 board wrapper replacement'); assertSameBase(zeroReference, wrapperRemount, 'board wrapper replacement'); assertPanel(wrapperRemount, 410, 270, 'board wrapper replacement');
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full')); harness.runFor(240, 16);
var cardsMount = snapshot(harness, '22 cards mount'); assertSameBase(zeroReference, cardsMount, 'cards mount');
harness.fixture.removeCommunityBoard(); harness.runFor(240, 16);
var cardsUnmount = snapshot(harness, '23 cards unmount'); assertSameBase(zeroReference, cardsUnmount, 'cards unmount');

// Offer a different board-slot rectangle without changing viewport/table geometry.
// The immutable epoch guard must reject it rather than recreating the live jump.
harness.fixture.setLayout('live-narrow'); harness.triggerResizeObserver(harness.fixture.boardSlot); harness.flushMutationObservers(); harness.runFor(300, 16);
var illegalRejected = snapshot(harness, '24 same-table shifted card/slot evidence rejected');
assertSameBase(zeroReference, illegalRejected, 'illegal same-epoch proposal'); assertPanel(illegalRejected, 410, 270, 'illegal same-epoch proposal');
var illegalInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().latestIllegalCanonicalGeometryChange)'));
assert.strictEqual(illegalInfo.type, 'ILLEGAL_CANONICAL_GEOMETRY_CHANGE');
assert.strictEqual(illegalInfo.layoutEpochId, zeroReference.epoch);

// Manual layer is preserved when a genuine responsive viewport/table epoch changes.
drag(harness, 75, -30, 202);
var beforeResize = snapshot(harness, '25 manual offset before genuine resize');
assert.deepStrictEqual(beforeResize.offset, [75, -30]);
harness.setViewport(900, 665, true); harness.runFor(420, 16);
var resized = snapshot(harness, '26 genuine viewport/responsive table change');
assert.notStrictEqual(resized.epoch, zeroReference.epoch, 'genuine viewport/table geometry creates a new epoch');
assert.deepStrictEqual(resized.offset, [75, -30], 'genuine epoch change preserves exact feature offset');
assertPanel(resized, resized.left.left + 75, resized.left.top - 30, 'new canonical + unchanged offset');
var resizedInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.match(resizedInfo.lastAcceptedCanonicalChangeReason, /viewport|table\/stage/);
assert.ok(resizedInfo.acceptedLayoutEpochChanges.every(function (entry) { return entry.reason; }), 'every accepted epoch change has an explicit reason');

var leftWithOwnOffset = position.place(resized.left, { x: 75, y: -30 }, { width: 900, height: 665 });
var rightWithIndependentOffset = position.place(resized.right, { x: -20, y: 15 }, { width: 900, height: 665 });
assert.deepStrictEqual([leftWithOwnOffset.persistedOffsetX, leftWithOwnOffset.persistedOffsetY], [75, -30], '27 LEFT feature owns its offset');
assert.deepStrictEqual([rightWithIndependentOffset.persistedOffsetX, rightWithIndependentOffset.persistedOffsetY], [-20, 15], '28 future RIGHT feature owns an independent offset');
assert.strictEqual(resized.left.right, resized.board.left - 10, 'LEFT formula uses shared canonical board');
assert.strictEqual(resized.right.left, resized.board.right + 10, 'RIGHT formula uses the same shared canonical board');

var diagnostic = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.captureLayoutSnapshot())'));
['layoutEpochId', 'tableOwnerSource', 'tableViewportRect', 'tableTransform', 'canonicalBoardLocalRect', 'canonicalBoardViewportRect', 'canonicalLeftCompanionRect', 'canonicalRightCompanionRect', 'featureOffset', 'actualPotOddsRect', 'boardCardCount', 'validationOnlyActualCardRects', 'canonicalGeometryChanged', 'lastAcceptedCanonicalChangeReason', 'settingsVisible'].forEach(function (key) {
  assert.ok(Object.prototype.hasOwnProperty.call(diagnostic, key), '29 diagnostic snapshot exposes ' + key);
});
assert.match(diagnostic.fixtureWorkflow, /capture in live PokerNow DevTools, sanitize, save exact geometry/);
assert.ok(!/playerA|playerB|Ah|Kd|2c|7s|Jh/.test(JSON.stringify(diagnostic)), 'diagnostic snapshot remains privacy-safe');
var history = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.eventHistory())'));
assert.ok(history.events.some(function (event) { return event.type === 'ILLEGAL_CANONICAL_GEOMETRY_CHANGE'; }), '30 meaningful history records rejected same-epoch geometry');
assert.ok(history.events.some(function (event) { return event.type === 'canonical-revision' && /viewport|table|coordinate owner/.test(event.reason); }), '31 meaningful history explains accepted epoch changes');
assert.ok(history.count <= 160, 'event history remains bounded');

assert.deepStrictEqual(harness.evaluationErrors, []);

// Real cards arrive after the preflop bootstrap, with no persistent slot DOM.
// The visible flop is only 182px wide; its complete five-card slot is 306px.
var delayed = harnessApi.createHarness({
  gameId: 'delayed-measured-board', layout: 'live-full', liveCardDom: true,
  boardDom: false, persistentBoardSlot: false, viewport: { width: 1280, height: 665 }, initialNow: 1000,
  initialStorage: { hudUiPreferences: settings.merge(settings.DEFAULTS, { potOddsOffsetX: 40, potOddsOffsetY: -15 }) }
});
frame(delayed, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA' }, gameState: activeState('DELAYED-1') }, 'delayed-preflop');
var bootstrap = snapshot(delayed, 'unmeasured preflop');
assert.deepStrictEqual(bootstrap.offset, [40, -15], 'provisional preflop placement preserves the prior user offset');
var measuredCards = Array.from({ length: 5 }, function (_unused, index) { return harnessApi.rect(430 + 62 * index, 260, 58, 80); });
delayed.fixture.mountCommunityBoard(measuredCards.slice(0, 3));
frame(delayed, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'delayed-first-flop');
var calibrated = snapshot(delayed, 'measured flop replaces bootstrap');
assert.deepStrictEqual(calibrated.offset, [0, 0], 'first measured flop both corrects provisional geometry and resets the offset');
assert.strictEqual(calibrated.epoch, bootstrap.epoch, 'first measurement completes the existing table epoch');
assert.strictEqual(calibrated.board.left, 430, 'bootstrap cannot remain authoritative after credible flop geometry arrives');
assert.strictEqual(calibrated.board.width, 306, 'full five-card envelope, never the visible three-card union');
assertPanel(calibrated, 320, 270, 'measured canonical LEFT');
assert.strictEqual(calibrated.panel.left + calibrated.panel.width, calibrated.board.left - 10, 'default panel cannot overlap measured board');
assert.strictEqual(calibrated.right.left, calibrated.board.right + 10, 'reserved RIGHT still derives from the shared board');
[4, 5, 0, 3].forEach(function (count) {
  if (count) delayed.fixture.mountCommunityBoard(measuredCards.slice(0, count));
  else delayed.fixture.removeCommunityBoard();
  frame(delayed, 'gC', { gT: ['holdem', count === 4 ? 2 : count === 5 ? 3 : count ? 1 : 0], board: ['Ah', 'Kd', '2c', '7s', 'Jh'].slice(0, count) }, 'delayed-street-' + count);
  assertSameBase(calibrated, snapshot(delayed, 'street/remount ' + count), 'street/remount ' + count);
});
drag(delayed, -35, 20, 203);
var calibratedDrag = snapshot(delayed, 'drag after bootstrap completion');
assertSameBase(calibrated, calibratedDrag, 'drag preserves completed model');
assert.deepStrictEqual(calibratedDrag.offset, [-35, 20]);
assertPanel(calibratedDrag, 285, 290, 'feature offset remains relative to corrected LEFT');
assert.deepStrictEqual(delayed.evaluationErrors, []);
console.log('Stable table-local BoardCompanion production regressions passed:', JSON.stringify({ zero: zeroReference.panel, manual: manualReference.panel, resized: resized.panel, epochs: resizedInfo.acceptedLayoutEpochChanges.length, illegal: illegalInfo.type }));
