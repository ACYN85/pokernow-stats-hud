'use strict';

var assert = require('assert');
var layout = require('./boardCompanionLayout.js');

function rect(left, top, width, height) {
  return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
}

function slots(left, top, width, height, pitch) {
  return Array.from({ length: 5 }, function (_unused, index) {
    return { rect: rect(left + pitch * index, top, width, height), classes: 'table-card-slot board-slot-' + (index + 1), element: { isConnected: true } };
  });
}

function cards(count, left, top, width, height, pitch) {
  return slots(left === undefined ? 520 : left, top === undefined ? 260 : top, width || 58, height || 80, pitch || 62).slice(0, count).map(function (entry, index) {
    return { rect: entry.rect, classes: 'card-container board-card-' + (index + 1), element: { isConnected: true } };
  });
}

function evidence(values) {
  values = values || {};
  var tableElement = values.tableElement || evidence.tableElement || (evidence.tableElement = { isConnected: true });
  var wrapperElement = values.wrapperElement || { isConnected: true };
  var slotEntries = values.slotEntries === undefined ? slots(520, 260, 58, 80, 62) : values.slotEntries;
  var cardEntries = values.cardEntries || [];
  var tableRect = values.tableRect || rect(0, 0, 1280, 665);
  return {
    tableId: values.tableId || 'layout-unit-table',
    viewport: values.viewport || { width: 1280, height: 665, devicePixelRatio: 1, visualViewportScale: 1 },
    tableElement: tableElement,
    tableOwnerSource: values.tableOwnerSource || '.game-table persistent PokerNow table/stage owner',
    tableRect: tableRect,
    tableTransform: values.tableTransform || { transform: 'none', transformOrigin: null, scaleX: 1, scaleY: 1, localWidth: tableRect.width, localHeight: tableRect.height, layoutMode: 'game-table' },
    potRect: values.potRect || rect(610, 205, 80, 30),
    wrapperCandidates: values.wrapperCandidates === undefined ? [{ key: 'wide-centered-wrapper', element: wrapperElement, rect: rect(430, 240, 500, 120), innerRect: rect(430, 240, 500, 120), classes: 'table-cards centered-community-wrapper', justifyContent: 'center', transform: 'none', slotEntries: slotEntries, cardEntries: cardEntries }] : values.wrapperCandidates,
    slotEntries: slotEntries,
    cardEntries: cardEntries,
    domNodes: []
  };
}

function resolve(state, values, context) {
  return layout.resolveEvidence(state, evidence(values), { leftSize: { width: 100, height: 60 }, rightSize: { width: 140, height: 60 }, context: context || {} });
}

var state = layout.createState({ tableId: 'layout-unit-table', maxHistory: 20 });
var revisionEvents = [];
var unsubscribe = layout.subscribe(state, function (event) { revisionEvents.push(event); });

var preflop = resolve(state, { cardEntries: [] }, { trigger: 'first preflop', street: 'preflop', settingsVisible: false });
assert.deepStrictEqual(preflop.canonicalBoardRect, rect(520, 260, 306, 80), '1 first preflop uses the full five-slot board rectangle');
assert.deepStrictEqual(preflop.canonicalBoardLocalRect, rect(520, 260, 306, 80), '2 canonical geometry is table-local');
assert.strictEqual(preflop.source, 'explicit five-card slot envelope', '3 persistent slot structure establishes the epoch model');
assert.deepStrictEqual(preflop.leftCompanionRect, rect(410, 270, 100, 60), '4 LEFT formula');
assert.deepStrictEqual(preflop.rightCompanionRect, rect(836, 270, 140, 60), '5 RIGHT formula');
assert.match(preflop.layoutEpochId, /layout-epoch-1$/);
var epochOne = preflop.layoutEpochId;
var stableRevision = preflop.info.revision;

[
  ['flop', 3], ['turn', 4], ['river', 5], ['showdown', 5], ['between-hands', 0], ['next-preflop', 0]
].forEach(function (sample) {
  var result = resolve(state, { cardEntries: sample[1] ? cards(sample[1]) : [] }, { trigger: sample[0] + ' semantic/render reconcile', street: sample[0], settingsVisible: false });
  assert.strictEqual(result.layoutEpochId, epochOne, sample[0] + ': card/lifecycle changes do not create an epoch');
  assert.deepStrictEqual(result.canonicalBoardRect, preflop.canonicalBoardRect, sample[0] + ': canonical viewport position is byte-for-byte stable');
  assert.deepStrictEqual(result.leftCompanionRect, preflop.leftCompanionRect, sample[0] + ': LEFT position is stable');
  assert.strictEqual(result.info.revision, stableRevision, sample[0] + ': validation-only cards do not advance canonical revision');
});

var settingsOpen = resolve(state, { cardEntries: cards(3) }, { trigger: 'Settings opened', street: 'flop', settingsVisible: true });
var settingsClosed = resolve(state, { cardEntries: cards(3) }, { trigger: 'Settings closed', street: 'flop', settingsVisible: false });
assert.strictEqual(settingsOpen.layoutEpochId, epochOne, '6 Settings open is epoch-neutral');
assert.strictEqual(settingsClosed.layoutEpochId, epochOne, '7 Settings close is epoch-neutral');
assert.deepStrictEqual(settingsOpen.canonicalBoardLocalRect, settingsClosed.canonicalBoardLocalRect, 'Settings visibility cannot alter local geometry');

var wrapperReplacement = resolve(state, { wrapperElement: { isConnected: true }, cardEntries: cards(3) }, { trigger: 'board wrapper replaced', street: 'flop' });
assert.strictEqual(wrapperReplacement.layoutEpochId, epochOne, '8 board wrapper replacement keeps the epoch');
assert.deepStrictEqual(wrapperReplacement.canonicalBoardRect, preflop.canonicalBoardRect, 'board remount retains canonical geometry');

var shiftedSlots = slots(460, 310, 58, 80, 62);
var illegal = resolve(state, { slotEntries: shiftedSlots, wrapperCandidates: [{ key: 'street-dependent-shift', element: { isConnected: true }, rect: rect(400, 290, 500, 120), innerRect: rect(400, 290, 500, 120), classes: 'table-cards', justifyContent: 'center', transform: 'none', slotEntries: shiftedSlots, cardEntries: cards(3, 460, 310) }] , cardEntries: cards(3, 460, 310) }, { trigger: 'Settings/card-count reconciliation offered shifted geometry', street: 'flop', settingsVisible: true });
assert.strictEqual(illegal.layoutEpochId, epochOne, '9 rejected proposal does not create an epoch');
assert.deepStrictEqual(illegal.canonicalBoardLocalRect, preflop.canonicalBoardLocalRect, '10 rejected proposal cannot replace canonical local geometry');
assert.strictEqual(illegal.info.latestIllegalCanonicalGeometryChange.type, 'ILLEGAL_SETTINGS_GEOMETRY_CHANGE');
assert.deepStrictEqual(illegal.info.latestIllegalCanonicalGeometryChange.rejectedCanonicalBoardLocalRect, rect(460, 310, 306, 80));

var remountWithoutBoardDom = resolve(state, { wrapperCandidates: [], slotEntries: [], cardEntries: [] }, { trigger: 'community subtree unmounted', street: 'between-hands' });
assert.strictEqual(remountWithoutBoardDom.layoutEpochId, epochOne, '11 missing board DOM cannot alter the epoch');
assert.deepStrictEqual(remountWithoutBoardDom.canonicalBoardRect, preflop.canonicalBoardRect, 'missing board DOM retains the immutable model');

var resizedSlots = slots(420, 240, 58, 80, 62);
var resized = resolve(state, {
  viewport: { width: 1080, height: 620, devicePixelRatio: 1, visualViewportScale: 1 }, tableRect: rect(0, 0, 1080, 620),
  tableTransform: { transform: 'none', transformOrigin: null, scaleX: 1, scaleY: 1, localWidth: 1080, localHeight: 620, layoutMode: 'game-table narrow' },
  slotEntries: resizedSlots,
  wrapperCandidates: [{ key: 'resized-wrapper', element: { isConnected: true }, rect: rect(330, 220, 500, 120), innerRect: rect(330, 220, 500, 120), classes: 'table-cards', justifyContent: 'center', transform: 'none', slotEntries: resizedSlots, cardEntries: [] }]
}, { trigger: 'genuine viewport resize', street: 'preflop' });
assert.notStrictEqual(resized.layoutEpochId, epochOne, '12 genuine viewport/table change creates a new epoch');
assert.match(resized.info.canonicalGeometryChangeReason, /viewport|table\/stage/);
assert.strictEqual(resized.canonicalBoardRect.left, 420, 'new epoch establishes current structural model');
assert.strictEqual(resized.leftCompanionRect.right, resized.canonicalBoardRect.left - 10, 'new LEFT derives from new epoch model');
assert.strictEqual(resized.rightCompanionRect.left, resized.canonicalBoardRect.right + 10, 'new RIGHT derives from the same model');

var modelState = layout.createState({ tableId: 'first-hand-no-board-dom' });
var modelPreflop = resolve(modelState, { tableId: 'first-hand-no-board-dom', wrapperCandidates: [], slotEntries: [], cardEntries: [] }, { trigger: 'first hand before any flop', street: 'preflop' });
assert.deepStrictEqual(modelPreflop.canonicalBoardRect, rect(520, 260, 306, 80), '13 first-hand geometry is available from the table-local production model without prior flop');
assert.match(modelPreflop.source, /table-local five-card board model/);
var modelFlop = resolve(modelState, { tableId: 'first-hand-no-board-dom', wrapperCandidates: [], slotEntries: [], cardEntries: cards(3) }, { trigger: 'first flop cards appeared', street: 'flop' });
assert.deepStrictEqual(modelFlop.canonicalBoardRect, modelPreflop.canonicalBoardRect, '14 actual cards validate but never replace first-hand table-local geometry');
assert.strictEqual(modelFlop.layoutEpochId, modelPreflop.layoutEpochId);
assert.strictEqual(modelFlop.verified, true, 'matching first measurement also completes verification');

var bootstrapState = layout.createState({ tableId: 'layout-unit-table' });
var initialBootstrap = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [] });
var bootstrapRevisionEvents = [];
layout.subscribe(bootstrapState, function (event) { bootstrapRevisionEvents.push(event); });
var incomplete = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [], cardEntries: cards(2, 430) });
assert.strictEqual(incomplete.verified, false, 'insufficient geometry cannot complete bootstrap');
var settingsOnly = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [], cardEntries: cards(3, 430) }, { trigger: 'Settings opened' });
assert.deepStrictEqual(settingsOnly.canonicalBoardRect, initialBootstrap.canonicalBoardRect, 'Settings cannot authorize bootstrap completion');
var measured = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [], cardEntries: cards(3, 430) }, { trigger: 'native board mutation' });
assert.deepStrictEqual(measured.canonicalBoardRect, rect(430, 260, 306, 80));
assert.strictEqual(measured.layoutEpochId, initialBootstrap.layoutEpochId);
assert.strictEqual(measured.info.layoutEpochChanged, false);
assert.strictEqual(measured.info.canonicalGeometryChanged, true);
assert.strictEqual(measured.info.fallback, null);
assert.strictEqual(measured.info.cachedGeometryReused, false);
assert.strictEqual(measured.info.latestIllegalCanonicalGeometryChange, null);
assert.strictEqual(bootstrapRevisionEvents.length, 1, 'one completion revision schedules production placement');
assert.match(bootstrapRevisionEvents[0].reason, /bootstrap completed/);
var laterShift = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [], cardEntries: cards(4, 450) });
assert.deepStrictEqual(laterShift.canonicalBoardRect, measured.canonicalBoardRect, 'verified geometry cannot be recalibrated by later streets');
assert.strictEqual(bootstrapRevisionEvents.length, 1);
var translatedOwner = resolve(bootstrapState, { tableElement: { isConnected: true }, tableRect: rect(30, 20, 1280, 665), slotEntries: [], wrapperCandidates: [] });
assert.notStrictEqual(translatedOwner.layoutEpochId, measured.layoutEpochId, 'table owner remount still creates an epoch');
assert.deepStrictEqual(translatedOwner.canonicalBoardRect, rect(460, 280, 306, 80), 'verified local model survives owner translation without board DOM');
var scaledOwner = resolve(bootstrapState, {
  tableElement: bootstrapState.tableElement, tableRect: rect(30, 20, 1024, 532), slotEntries: [], wrapperCandidates: [],
  tableTransform: { transform: 'matrix(0.8, 0, 0, 0.8, 0, 0)', scaleX: 0.8, scaleY: 0.8, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' }
});
assert.deepStrictEqual(scaledOwner.canonicalBoardRect, rect(374, 228, 244.8, 64), 'local-to-viewport scaling preserves the measured model');
var structuralBootstrap = layout.createState({ tableId: 'layout-unit-table' });
resolve(structuralBootstrap, { slotEntries: [], wrapperCandidates: [] });
var lateSlots = resolve(structuralBootstrap, { slotEntries: slots(430, 260, 58, 80, 62), wrapperCandidates: [] });
assert.deepStrictEqual(lateSlots.canonicalBoardRect, rect(430, 260, 306, 80), 'late explicit five-slot geometry also completes provisional bootstrap');
assert.strictEqual(lateSlots.verified, true);

var observedState = layout.createState({ tableId: 'observed-live-board' });
var observedCards = cards(3, 545, 275, 58, 80, 63);
var observedFlop = resolve(observedState, { tableId: 'observed-live-board', wrapperCandidates: [], slotEntries: [], cardEntries: observedCards }, { trigger: 'first usable live postflop layout', street: 'flop', persistedOffsetX: 0, persistedOffsetY: 0, potOddsActualRect: rect(435, 285, 100, 60) });
assert.deepStrictEqual(observedFlop.canonicalBoardRect, rect(545, 275, 310, 80), '15 credible 3-card pitch reconstructs the complete five-slot envelope at epoch establishment');
assert.match(observedFlop.source, /observed live first-card slot/);
assert.strictEqual(observedFlop.info.boardAlignment.firstSlotDeltaX, 0);
assert.strictEqual(observedFlop.info.boardAlignment.firstSlotDeltaY, 0);
assert.strictEqual(observedFlop.info.boardAlignment.potOddsDeltaX, 0);
assert.strictEqual(observedFlop.info.boardAlignment.potOddsDeltaY, 0);
assert.strictEqual(observedFlop.info.boardAlignment.withinTolerance, true);
var observedEpoch = observedFlop.layoutEpochId;
var shiftedObservedCards = cards(3, 565, 295, 58, 80, 63);
var observedShift = resolve(observedState, { tableId: 'observed-live-board', wrapperCandidates: [], slotEntries: [], cardEntries: shiftedObservedCards }, { trigger: 'same epoch visual card shift', street: 'flop' });
assert.strictEqual(observedShift.layoutEpochId, observedEpoch);
assert.deepStrictEqual(observedShift.canonicalBoardRect, observedFlop.canonicalBoardRect, '16 later card pixels validate but cannot replace same-epoch canonical geometry');
assert.strictEqual(observedShift.info.cardValidation.status, 'validation-disagreement');
var observedPreflop = resolve(observedState, { tableId: 'observed-live-board', wrapperCandidates: [], slotEntries: [], cardEntries: [] }, { trigger: 'next preflop in same epoch', street: 'preflop' });
assert.deepStrictEqual(observedPreflop.canonicalBoardRect, observedFlop.canonicalBoardRect, '17 next preflop consumes the observed first-card slot directly');
assert.strictEqual(observedPreflop.leftCompanionRect.right, observedPreflop.canonicalBoardRect.left - 10);
assert.strictEqual(observedPreflop.rightCompanionRect.left, observedPreflop.canonicalBoardRect.right + 10);

var snapshot = layout.captureLayoutSnapshot(state);
assert.strictEqual(snapshot.schemaVersion, 3);
assert.strictEqual(snapshot.privacy, 'geometry and board-layout identifiers only; no names, card values, or chat');
['layoutEpochId', 'tableOwnerSource', 'tableViewportRect', 'tableTransform', 'canonicalBoardLocalRect', 'canonicalBoardViewportRect', 'canonicalLeftCompanionRect', 'canonicalRightCompanionRect', 'featureOffset', 'validationOnlyActualCardRects', 'canonicalGeometryChanged', 'lastAcceptedCanonicalChangeReason', 'observedFirstVisibleCardRect', 'expectedFirstSlotRect', 'boardAlignment'].forEach(function (key) { assert.ok(Object.prototype.hasOwnProperty.call(snapshot, key), 'snapshot exposes ' + key); });
assert.ok(!JSON.stringify(snapshot).includes('playerA'), 'snapshot contains no player identity');
assert.ok(state.history.length <= 20, 'resolution history remains bounded');
assert.ok(revisionEvents.every(function (event) { return event.reason && event.after && Object.prototype.hasOwnProperty.call(event.after, 'layoutEpochId'); }), 'accepted revision events explain their epoch reason');
unsubscribe();

var delayedState = layout.createState({ tableId: 'delayed-layout' });
var delayedEvents = [];
layout.subscribe(delayedState, function (event) { delayedEvents.push(event); });
var unavailable = layout.resolveEvidence(delayedState, { tableId: 'delayed-layout', viewport: { width: 1280, height: 665 }, tableElement: { isConnected: true }, tableRect: null, wrapperCandidates: [], slotEntries: [], cardEntries: [], domNodes: [] }, {});
assert.strictEqual(unavailable.canonicalBoardRect, null, '15 delayed table geometry begins unavailable');
var ready = layout.resolveEvidence(delayedState, evidence({ tableId: 'delayed-layout', tableElement: delayedState.tableElement }), {});
assert.ok(ready.canonicalBoardRect, 'delayed table geometry becomes placement capable');
assert.ok(delayedEvents.some(function (event) { return event.after && event.after.geometryAvailable; }), 'not-ready to ready emits an authoritative epoch revision');

console.log('Stable table-local BoardCompanion unit regressions passed:', JSON.stringify({ epoch: epochOne, preflop: preflop.canonicalBoardRect, resizedEpoch: resized.layoutEpochId, illegalRejected: illegal.info.latestIllegalCanonicalGeometryChange.type, right: preflop.rightCompanionRect }));
