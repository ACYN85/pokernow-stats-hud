'use strict';

var assert = require('assert');
var fs = require('fs');
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

function assertCanonicalCenters(sample) {
  var boardCenter = sample.board.top + sample.board.height / 2;
  assert.ok(Math.abs(sample.left.top + sample.left.height / 2 - boardCenter) < 0.1, sample.label + ': complete LEFT footprint centers on the five-card board envelope');
  assert.ok(Math.abs(sample.right.top + sample.right.height / 2 - boardCenter) < 0.1, sample.label + ': RIGHT independently shares the board center');
  if (sample.offset[0] === 0 && sample.offset[1] === 0) assert.ok(Math.abs(sample.panel.top + sample.panel.height / 2 - boardCenter) < 0.1, sample.label + ': default painted panel is centered without a visual fudge');
}

function assertPanel(sample, left, top, label) {
  assert.deepStrictEqual([sample.panel.left, sample.panel.top], [left, top], label + ': exact panel coordinates');
}

function rectsOverlap(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function completeRect(value) {
  return Object.assign({}, value, { right: value.left + value.width, bottom: value.top + value.height });
}

var defaults = settings.merge(settings.DEFAULTS, { selectedSettingsSection: 'hud' });
// The fixture has no browser line boxes; guard the paint rule that removes the
// signed-in inline-grid baseline gap between positioned host and visible pill.
assert.match(fs.readFileSync(require.resolve('./hud.css'), 'utf8'), /#pnhud-pot-odds-root \.pnhud-pot-odds \{ display: grid;/);
var harness = harnessApi.createHarness({
  gameId: 'stable-table-local-board-companion', layout: 'live-full', liveCardDom: true, boardDom: false, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 1000, initialStorage: { hudUiPreferences: defaults }
});
var occupiedWideLeftSeatMain = harnessApi.rect(330, 255, 86, 75);
harness.fixture.opponent.info.setRect(occupiedWideLeftSeatMain);

frame(harness, 'registered', {
  currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
  gameState: { pot: 0, board: [], iHPI: [], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: activeState('x').players }
}, 'between-hands');
var zeroReference = snapshot(harness, '1 between hands');
assertPanel(zeroReference, 434, 272, 'PHOTO-B compact default model');
assert.deepStrictEqual(zeroReference.offset, [0, 0]);
assert.deepStrictEqual([zeroReference.panel.width, zeroReference.panel.height], [76, 56], 'compact Pot Odds footprint is production-sized');
assert.deepStrictEqual([zeroReference.right.left, zeroReference.right.top, zeroReference.right.width, zeroReference.right.height], [836, 270, 100, 60], 'future RIGHT keeps its independent footprint');
assert.strictEqual(rectsOverlap(completeRect(zeroReference.panel), occupiedWideLeftSeatMain), false, 'occupied wide left seat main region has no material overlap');
assert.strictEqual(zeroReference.panel.left - occupiedWideLeftSeatMain.right, 18, 'occupied wide left seat gains clearance');
var legacyWideFootprint = harnessApi.rect(zeroReference.board.left - 10 - 100, zeroReference.board.top + (zeroReference.board.height - 60) / 2, 100, 60);
assert.strictEqual(rectsOverlap(legacyWideFootprint, occupiedWideLeftSeatMain), true, 'the prior wider footprint reproduces the signed-in collision');
harness.fixture.opponent.info.setRect(harnessApi.rect(0, 0, 0, 0));
harness.triggerResizeObserver(harness.fixture.opponent.info); harness.runFor(96, 16);
assertPanel(snapshot(harness, '1 empty wide left seat'), 434, 272, 'empty wide left seat keeps canonical placement');

frame(harness, 'gC', activeState('STABLE-1'), 'first-preflop');
var zeroSamples = [snapshot(harness, '2 first preflop')];
assert.deepStrictEqual(zeroSamples[0].offset, [0, 0], 'new hand starts with zero offset before the flop');
assert.strictEqual(JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())')).manualOverride, false);

harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
var untouchedFlopWrites = harness.storageWrites.length;
frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'flop');
zeroSamples.push(snapshot(harness, '3 flop'));
assert.strictEqual(harness.storageWrites.slice(untouchedFlopWrites).some(function (write) { return Object.keys(write).some(function (key) { return /PotOddsBoardReset|hudUiPreferences/.test(key); }); }), false, 'untouched first flop cannot write a position reset');
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
zeroSamples.forEach(function (sample) { assertSameBase(zeroReference, sample, sample.label); assertPanel(sample, 434, 272, sample.label); assertCanonicalCenters(sample); });

frame(harness, 'gC', activeState('STABLE-3'), 'manual-preflop');
var stableHost = zeroReference.host;
drag(harness, 75, -30, 201);
var manualReference = snapshot(harness, '9 current-hand preflop drag +75/-30');
assertSameBase(zeroReference, manualReference, 'drag cannot mutate canonical layer');
assert.deepStrictEqual(manualReference.offset, [75, -30]);
assertPanel(manualReference, 509, 242, 'manual canonical + offset');
var manualPreflop = snapshot(harness, '10 manual preflop');
assertSameBase(manualReference, manualPreflop, manualPreflop.label); assert.deepStrictEqual(manualPreflop.offset, [75, -30]); assertPanel(manualPreflop, 509, 242, manualPreflop.label);
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full')); frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'manual-flop');
var manualSamples = [snapshot(harness, '11 first measured board preserves manual override')];
assert.strictEqual(JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())')).manualOverride, true, 'flop preserves preflop override');
harness.fixture.mountCommunityBoard(turnRects); frame(harness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'manual-turn'); manualSamples.push(snapshot(harness, '12 turn'));
harness.fixture.mountCommunityBoard(riverRects); frame(harness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'] }, 'manual-river'); manualSamples.push(snapshot(harness, '13 river'));
frame(harness, 'gC', { pGS: { playerA: 'fold', playerB: 'inGame' }, cPI: 'playerB', pITT: 'playerB' }, 'manual-fold'); manualSamples.push(snapshot(harness, '14 fold remains persistent'));
frame(harness, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'manual-hand-end'); harness.fixture.removeCommunityBoard(); harness.runFor(240, 16); manualSamples.push(snapshot(harness, '15 between hands'));
manualSamples.forEach(function (sample) { assertSameBase(zeroReference, sample, sample.label); assert.deepStrictEqual(sample.offset, [75, -30], sample.label + ': persistent user offset'); assertPanel(sample, 509, 242, sample.label); assert.strictEqual(sample.host, stableHost, sample.label + ': same host'); assertCanonicalCenters(sample); });
var manualNextHandWrites = harness.storageWrites.length;
frame(harness, 'gC', activeState('STABLE-4', { players: { playerA: { id: 'playerA', name: 'playerA', stack: 0, allIn: true }, playerB: { id: 'playerB', name: 'playerB', stack: 0, allIn: true } } }), 'manual-allin-next-hand');
var nextHandRearmed = snapshot(harness, '16 all-in next hand keeps user placement');
assert.deepStrictEqual(nextHandRearmed.offset, [75, -30], 'next hand keeps the table-local offset');
assertPanel(nextHandRearmed, 509, 242, 'next hand uses its canonical LEFT plus the saved offset');
assert.strictEqual(JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())')).manualOverride, true);
assert.strictEqual(harness.storageWrites.slice(manualNextHandWrites).some(function (write) { return Object.keys(write).some(function (key) { return /PotOddsBoardReset|hudUiPreferences/.test(key); }); }), false, 'new hand cannot write a position reset');

click(harness, '#pnhud-settings-launcher');
var settingsOpen = snapshot(harness, '17 Settings opens');
assertSameBase(zeroReference, settingsOpen, 'Settings open'); assertPanel(settingsOpen, 509, 242, 'Settings open preserves persistent user placement'); assert.strictEqual(settingsOpen.settingsVisible, true);
click(harness, '[data-settings-section="general"]');
var tabChanged = snapshot(harness, '18 Settings switches tabs');
assertSameBase(zeroReference, tabChanged, 'Settings tab switch'); assertPanel(tabChanged, 509, 242, 'Settings tab switch preserves persistent user placement');
click(harness, '[data-settings-section="hud"]');
var epochBeforeReset = snapshot(harness, 'Settings HUD tab restored').epoch;
click(harness, '.pnhud-reset-pot-odds-position');
var reset = snapshot(harness, '19 Reset while Settings open');
assert.strictEqual(reset.epoch, epochBeforeReset, 'reset cannot create an epoch');
assert.deepStrictEqual(reset.offset, [0, 0], 'reset owns only feature offset');
assertPanel(reset, 434, 272, 'reset returns to stable canonical LEFT');
assertCanonicalCenters(reset);
click(harness, '.pnhud-settings-close');
var settingsClosed = snapshot(harness, '20 Settings closes');
assertSameBase(zeroReference, settingsClosed, 'Settings close'); assertPanel(settingsClosed, 434, 272, 'Settings close'); assert.strictEqual(settingsClosed.settingsVisible, false);
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
var resetThenFlopWrites = harness.storageWrites.length;
frame(harness, 'gC', { gT: ['holdem', 1], board: ['9h', '8s', '2d'] }, 'reset-then-first-flop');
var resetThenFlop = snapshot(harness, '20 Reset Position clears override before flop');
assert.deepStrictEqual(resetThenFlop.offset, [0, 0], 'untouched/reset current hand follows canonical LEFT when measured flop arrives');
assert.strictEqual(harness.storageWrites.slice(resetThenFlopWrites).some(function (write) { return Object.keys(write).some(function (key) { return /PotOddsBoardReset|hudUiPreferences/.test(key); }); }), false, 'flop after Reset does not perform another offset write');
frame(harness, 'gC', activeState('STABLE-5'), 'post-reset-next-hand');
var postResetNextHand = snapshot(harness, 'post-reset next hand');
assert.deepStrictEqual(postResetNextHand.offset, [0, 0], 'Reset persists into later hands');
assertCanonicalCenters(postResetNextHand);

harness.fixture.replaceBoardSlotOwner(); harness.runFor(280, 16);
var wrapperRemount = snapshot(harness, '21 board wrapper replacement'); assertSameBase(zeroReference, wrapperRemount, 'board wrapper replacement'); assertPanel(wrapperRemount, 434, 272, 'board wrapper replacement');
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full')); harness.runFor(240, 16);
var cardsMount = snapshot(harness, '22 cards mount'); assertSameBase(zeroReference, cardsMount, 'cards mount');
harness.fixture.removeCommunityBoard(); harness.runFor(240, 16);
var cardsUnmount = snapshot(harness, '23 cards unmount'); assertSameBase(zeroReference, cardsUnmount, 'cards unmount');

// Native lane/slot reflow may precede any viewport/table metrics change.
// Follow current semantic structure without retaining the previous origin.
harness.fixture.setLayout('live-narrow'); harness.triggerResizeObserver(harness.fixture.boardSlot); harness.flushMutationObservers(); harness.runFor(300, 16);
var reflowed = snapshot(harness, '24 native slot reflow within current owner');
assert.strictEqual(reflowed.board.left, 370);
assert.strictEqual(reflowed.left.right, reflowed.board.left - 10);
assert.strictEqual(reflowed.right.left, reflowed.board.right + 10);

// Manual layer is preserved when a genuine responsive viewport/table epoch changes.
drag(harness, 75, -30, 202);
var beforeResize = snapshot(harness, '25 manual offset before genuine resize');
assert.deepStrictEqual(beforeResize.offset, [75, -30]);
harness.setViewport(900, 665, true);
var unrelatedAfterResize = harness.document.createElement('div');
unrelatedAfterResize.className = 'unrelated-table-child';
harness.fixture.table.appendChild(unrelatedAfterResize);
harness.runFor(48, 16);
var pendingAfterUnrelatedMutation = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.strictEqual(pendingAfterUnrelatedMutation.awaitingPostTransitionGeometry, false, 'current structure needs no history-dependent settlement gate');
harness.triggerResizeObserver(harness.fixture.boardSlot);
harness.runFor(420, 16);
var resized = snapshot(harness, '26 genuine viewport/responsive table change');
assert.notStrictEqual(resized.epoch, zeroReference.epoch, 'genuine viewport/table geometry creates a new epoch');
assert.deepStrictEqual(resized.offset, [75, -30], 'genuine epoch change preserves exact feature offset');
assert.ok(Math.abs(resized.panel.left - (resized.left.left + 75)) < 0.1 && Math.abs(resized.panel.top - (resized.left.top - 30)) < 0.1, 'new canonical + unchanged offset');
var resizedInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.match(resizedInfo.lastAcceptedCanonicalChangeReason, /viewport|table\/stage|current semantic board structure updated/);
assert.strictEqual(resizedInfo.awaitingPostTransitionGeometry, false, 'current structural evidence leaves no zoom-transition settlement pending: ' + JSON.stringify({ canonical: resizedInfo.canonicalBoardLocalRect, candidate: resizedInfo.transitionEntryCandidate, table: resizedInfo.tableTransform }));
assert.ok(resizedInfo.acceptedLayoutEpochChanges.some(function (entry) { return /viewport|table\/stage/.test(entry.reason); }), 'epoch history retains the initiating viewport/table change');
assert.ok(resizedInfo.acceptedLayoutEpochChanges.every(function (entry) { return entry.reason; }), 'every accepted epoch change has an explicit reason');

var leftWithOwnOffset = position.place(resized.left, { x: 75, y: -30 }, { width: 900, height: 665 });
var rightWithIndependentOffset = position.place(resized.right, { x: -20, y: 15 }, { width: 900, height: 665 });
assert.deepStrictEqual([leftWithOwnOffset.persistedOffsetX, leftWithOwnOffset.persistedOffsetY], [75, -30], '27 LEFT feature owns its offset');
assert.deepStrictEqual([rightWithIndependentOffset.persistedOffsetX, rightWithIndependentOffset.persistedOffsetY], [-20, 15], '28 future RIGHT feature owns an independent offset');
assert.strictEqual(resized.left.right, resized.board.left - 10, 'LEFT formula uses shared canonical board');
assert.strictEqual(resized.right.left, resized.board.right + 10, 'RIGHT formula uses the same shared canonical board');

var diagnostic = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.captureLayoutSnapshot())'));
['layoutEpochId', 'tableOwnerSource', 'tableViewportRect', 'tableTransform', 'canonicalBoardLocalRect', 'canonicalBoardViewportRect', 'canonicalLeftCompanionRect', 'canonicalRightCompanionRect', 'featureOffset', 'actualPotOddsRect', 'boardCardCount', 'validationOnlyActualCardRects', 'canonicalGeometryChanged', 'lastAcceptedCanonicalChangeReason', 'awaitingPostTransitionGeometry', 'transitionEntryCandidate', 'settingsVisible'].forEach(function (key) {
  assert.ok(Object.prototype.hasOwnProperty.call(diagnostic, key), '29 diagnostic snapshot exposes ' + key);
});
assert.match(diagnostic.fixtureWorkflow, /capture in live PokerNow DevTools, sanitize, save exact geometry/);
assert.ok(!/playerA|playerB|Ah|Kd|2c|7s|Jh/.test(JSON.stringify(diagnostic)), 'diagnostic snapshot remains privacy-safe');
var history = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.eventHistory())'));
assert.ok(history.events.some(function (event) { return event.type === 'canonical-revision'; }), '30 meaningful history records structural geometry changes');
assert.ok(history.events.some(function (event) { return event.type === 'canonical-revision' && /viewport|table|coordinate owner/.test(event.reason); }), '31 meaningful history explains accepted epoch changes');
assert.ok(history.count <= 160, 'event history remains bounded');

assert.deepStrictEqual(harness.evaluationErrors, []);

// Exact sanitized preflop lane from signed-in PokerNow (2026-09-25).
// Card dimensions/pitch below come from the inspected native stylesheet.
function nativeHarness(storage, bodyOwner, handId) {
  var h = harnessApi.createHarness({ gameId: 'native-empty-lane', layout: 'live-full', liveCardDom: true, boardDom: false, persistentBoardSlot: false, viewport: { width: 1280, height: 665 }, initialNow: 1000, initialStorage: storage || { hudUiPreferences: defaults } });
  h.fixture.table.tagName = 'DIV'; h.fixture.table.className = bodyOwner ? 'unmatched-native-stage' : 'table';
  h.nativeLane = h.document.createElement('div'); h.nativeLane.className = 'table-cards run-1'; h.nativeLane.style.display = 'flex';
  h.fixture.table.appendChild(h.nativeLane);
  nativeGeometry(h, 1, 0);
  frame(h, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA' }, gameState: activeState(handId || 'NATIVE-1') }, 'native-preflop');
  return h;
}
function nativeGeometry(h, scale, count) {
  h.fixture.table.setRect(harnessApi.rect(78.86458587646484 * scale, 0, 1122.25 * scale, 530.3125 * scale));
  var left = 393.09375 * scale, top = 185.6041717529297 * scale, width = 488.8958435058594 * scale;
  var unit = width / 24.2;
  h.nativeLane.setRect(harnessApi.rect(left, top, width, count ? unit * 5.5 : 0));
  h.nativeLane.children.slice().forEach(function (card) { card.remove(); });
  for (var index = 0; index < count; index += 1) {
    var card = h.document.createElement('div'); card.className = 'card-container big card-h card-s-K';
    card.setRect(harnessApi.rect(left + index * 4.9 * unit, top, 4.5 * unit, 5.5 * unit)); h.nativeLane.appendChild(card);
  }
  h.flushMutationObservers(); h.triggerResizeObserver(h.nativeLane); h.runFor(160, 16);
}
function nativeInfo(h) { return JSON.parse(h.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.captureLayoutSnapshot())')); }
function nativeReset(h) {
  click(h, '#pnhud-settings-launcher'); click(h, '[data-settings-section="hud"]');
  click(h, '.pnhud-reset-pot-odds-position'); click(h, '.pnhud-settings-close');
}
var native = nativeHarness();
var nativePreflop = snapshot(native, 'native preflop: no cards or empty slots');
assertCanonicalCenters(nativePreflop);
var preflopInfo = nativeInfo(native);
assert.match(preflopInfo.semanticAnchorSource, /persistent PokerNow .*run-1 lane/);
assert.match(preflopInfo.tableOwnerSource, /^\.table /);
assert.strictEqual(preflopInfo.boardCandidates[0].laneRect.height, 0);
assert.strictEqual(preflopInfo.boardCardCount, 0);
assert.strictEqual(preflopInfo.explicitSlotRects.length, 0);
assert.deepStrictEqual([nativePreflop.panel.width, nativePreflop.panel.height], [76, 56]);
assert.ok(Math.abs(nativePreflop.board.left - 393.09375) < 0.1);
assert.ok(Math.abs(nativePreflop.left.right - (nativePreflop.board.left - 10)) < 0.1);
[3, 4, 5].forEach(function (count) {
  nativeGeometry(native, 1, count);
  frame(native, 'gC', { gT: ['holdem', count - 2], board: ['Ah', 'Kd', '2c', '7s', 'Jh'].slice(0, count) }, 'native-street-' + count);
  var current = snapshot(native, 'native street ' + count);
  assertSameBase(nativePreflop, current, 'native virtual to measured ' + count);
  assert.deepStrictEqual(current.panel, nativePreflop.panel, 'untouched panel never waits for flop to establish its origin');
  assertCanonicalCenters(current);
  var info = nativeInfo(native); assert.strictEqual(info.virtualModelMismatch, false);
  assert.doesNotMatch(JSON.stringify(info.dom), /card-h|card-s-K/, 'geometry diagnostics exclude native card values');
  Object.values(info.virtualToMeasuredDelta).forEach(function (delta) { assert.ok(Math.abs(delta) < 0.001); });
  assert.ok(Math.abs(info.measuredBoardViewportRect.top + info.measuredBoardViewportRect.height / 2 - (current.board.top + current.board.height / 2)) < 0.1, 'measured street and virtual preflop envelope share the same vertical center');
});
nativeGeometry(native, 1, 0); frame(native, 'gC', activeState('NATIVE-2'), 'native-next-hand');
drag(native, 25, -10, 701);
assert.strictEqual(nativeInfo(native).manualOverride, true);
var preflopManual = snapshot(native, 'native manual preflop');
[0.75, 1, 1.25, 1, 0.75, 1, 1.25, 1].forEach(function (scale) {
  native.setViewport(1280 * scale, 665 * scale, false); nativeGeometry(native, scale, 0); native.dispatchWindowEvent('resize'); native.runFor(320, 16);
  var current = snapshot(native, 'native zoom ' + scale);
  assert.deepStrictEqual(current.offset, [25, -10]);
  assert.strictEqual(nativeInfo(native).semanticAnchorSource, preflopInfo.semanticAnchorSource);
  if (scale === 1) assert.deepStrictEqual(current.panel, preflopManual.panel, '75/125/repeated cycles converge with override');
});
nativeGeometry(native, 1, 3); frame(native, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'native-manual-flop');
assert.deepStrictEqual(snapshot(native, 'native manual flop').panel, preflopManual.panel);
assert.strictEqual(nativeInfo(native).manualOverride, true);
var reloaded = nativeHarness(native.storage, false, 'NATIVE-2');
frame(reloaded, 'gC', activeState('NATIVE-2'), 'restore-same-hand');
nativeGeometry(reloaded, 1, 3); frame(reloaded, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'] }, 'reloaded-flop');
assert.deepStrictEqual(snapshot(reloaded, 'native reload').offset, [25, -10]);
assert.strictEqual(nativeInfo(reloaded).manualOverride, true);
var nativeHost = native.document.getElementById('pnhud-hero-pot-odds'); nativeHost.remove(); native.flushMutationObservers(); frame(native, 'gC', { pot: 160 }, 'native-host-remount-render');
assert.deepStrictEqual(snapshot(native, 'native host remount').panel, preflopManual.panel);
[4, 5].forEach(function (count) { nativeGeometry(native, 1, count); frame(native, 'gC', { gT: ['holdem', count - 2], board: ['Ah', 'Kd', '2c', '7s', 'Jh'].slice(0, count) }, 'manual-later-street'); assert.deepStrictEqual(snapshot(native, 'native manual later street').offset, [25, -10]); });
nativeGeometry(native, 1, 0); frame(native, 'gC', activeState('NATIVE-3'), 'native-next-hand-rearms');
assert.strictEqual(nativeInfo(native).manualOverride, true);
assert.deepStrictEqual(snapshot(native, 'native next hand with saved placement').offset, [25, -10]);
assert.deepStrictEqual(snapshot(native, 'native next hand with saved placement').panel, preflopManual.panel);
drag(native, 5, 5, 702); nativeReset(native);
assert.strictEqual(nativeInfo(native).manualOverride, false);
assert.deepStrictEqual(snapshot(native, 'native reset before flop').offset, [0, 0]);
assert.deepStrictEqual(snapshot(native, 'native reset before flop').panel, nativePreflop.panel);
nativeGeometry(native, 1, 0); frame(native, 'gC', activeState('NATIVE-4'), 'native-hand-after-reset');
assert.deepStrictEqual(snapshot(native, 'native hand after reset').offset, [0, 0]);
assert.strictEqual(nativeInfo(native).manualOverride, false);
[0.75, 1, 1.25, 1].forEach(function (scale) {
  native.setViewport(1280 * scale, 665 * scale, false); nativeGeometry(native, scale, 0); native.dispatchWindowEvent('resize'); native.runFor(320, 16); nativeReset(native);
  var current = snapshot(native, 'native reset zoom ' + scale); assert.deepStrictEqual(current.offset, [0, 0]);
  assert.ok(Math.abs(current.panel.left - current.left.left) < 0.1);
  if (scale === 1) assert.deepStrictEqual(current.panel, nativePreflop.panel);
});
var bodyNative = nativeHarness(null, true);
assert.match(nativeInfo(bodyNative).tableOwnerSource, /body projection-only/);
assert.deepStrictEqual(snapshot(bodyNative, 'native body projection owner').board, nativePreflop.board);
assert.deepStrictEqual(snapshot(bodyNative, 'native body projection owner').right, nativePreflop.right);
[native, reloaded, bodyNative].forEach(function (h) { assert.deepStrictEqual(h.evaluationErrors, []); });

var narrowClearance = harnessApi.createHarness({
  gameId: 'narrow-left-seat-clearance', layout: 'live-narrow', liveCardDom: true, boardDom: false, persistentBoardSlot: true,
  viewport: { width: 900, height: 665 }, initialNow: 9000, initialStorage: { hudUiPreferences: defaults }
});
var occupiedNarrowLeftSeatMain = harnessApi.rect(180, 245, 86, 75);
narrowClearance.fixture.opponent.info.setRect(occupiedNarrowLeftSeatMain);
frame(narrowClearance, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA' }, gameState: activeState('NARROW-CLEARANCE') }, 'narrow-occupied-left-seat');
var narrowOccupied = snapshot(narrowClearance, 'narrow occupied left seat');
assertPanel(narrowOccupied, 284, 262, 'narrow occupied left seat canonical placement');
assert.strictEqual(rectsOverlap(completeRect(narrowOccupied.panel), occupiedNarrowLeftSeatMain), false, 'occupied narrow left seat main region has no material overlap');
assert.strictEqual(narrowOccupied.panel.left - occupiedNarrowLeftSeatMain.right, 18, 'occupied narrow left seat gains clearance');
var legacyNarrowFootprint = harnessApi.rect(narrowOccupied.board.left - 10 - 100, narrowOccupied.board.top + (narrowOccupied.board.height - 60) / 2, 100, 60);
assert.strictEqual(rectsOverlap(legacyNarrowFootprint, occupiedNarrowLeftSeatMain), true, 'prior footprint reproduces the narrow signed-in collision');
narrowClearance.fixture.opponent.info.setRect(harnessApi.rect(0, 0, 0, 0));
narrowClearance.triggerResizeObserver(narrowClearance.fixture.opponent.info); narrowClearance.runFor(96, 16);
assertPanel(snapshot(narrowClearance, 'narrow empty left seat'), 284, 262, 'narrow empty left seat keeps canonical placement');
assert.deepStrictEqual(narrowClearance.evaluationErrors, []);
console.log('Stable table-local BoardCompanion production regressions passed:', JSON.stringify({ zero: zeroReference.panel, manual: manualReference.panel, resized: resized.panel, epochs: resizedInfo.acceptedLayoutEpochChanges.length, nativePreflop: nativePreflop.panel }));
