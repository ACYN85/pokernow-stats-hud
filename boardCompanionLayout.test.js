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

function scaledEntries(entries, scaleX, scaleY) {
  return entries.map(function (entry) {
    return Object.assign({}, entry, { rect: rect(entry.rect.left * scaleX, entry.rect.top * scaleY, entry.rect.width * scaleX, entry.rect.height * scaleY) });
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
var resizedEvidence = {
  viewport: { width: 1080, height: 620, devicePixelRatio: 1, visualViewportScale: 1 }, tableRect: rect(0, 0, 1080, 620),
  tableTransform: { transform: 'none', transformOrigin: null, scaleX: 1, scaleY: 1, localWidth: 1080, localHeight: 620, layoutMode: 'game-table narrow' },
  slotEntries: resizedSlots,
  wrapperCandidates: [{ key: 'resized-wrapper', element: { isConnected: true }, rect: rect(330, 220, 500, 120), innerRect: rect(330, 220, 500, 120), classes: 'table-cards', justifyContent: 'center', transform: 'none', slotEntries: resizedSlots, cardEntries: [] }]
};
var resizedTransition = resolve(state, resizedEvidence, { trigger: 'genuine viewport resize', street: 'preflop' });
var resized = resolve(state, resizedEvidence, { trigger: 'resized board geometry settled', street: 'preflop', geometrySettlementSignal: true });
assert.notStrictEqual(resized.layoutEpochId, epochOne, '12 genuine viewport/table change creates a new epoch');
assert.strictEqual(resized.layoutEpochId, resizedTransition.layoutEpochId, 'settlement completes the current geometry epoch without another history-dependent epoch');
assert.match(resizedTransition.info.canonicalGeometryChangeReason, /viewport|table\/stage/);
assert.strictEqual(resized.canonicalBoardRect.left, 420, 'new epoch establishes current structural model');
assert.strictEqual(resized.leftCompanionRect.right, resized.canonicalBoardRect.left - 10, 'new LEFT derives from new epoch model');
assert.strictEqual(resized.rightCompanionRect.left, resized.canonicalBoardRect.right + 10, 'new RIGHT derives from the same model');

var zoomState = layout.createState({ tableId: 'zoom-local-board' });
var zoomOwner = { isConnected: true };
var baseSlots = slots(520, 260, 58, 80, 62);
function resolveZoom(scale, devicePixelRatio, label) {
  var tableRect = rect(0, 0, 1280 * scale, 665 * scale);
  var result = resolve(zoomState, {
    tableId: 'zoom-local-board', tableElement: zoomOwner,
    viewport: { width: tableRect.width, height: tableRect.height, devicePixelRatio: devicePixelRatio, visualViewportScale: 1 },
    tableRect: tableRect,
    tableTransform: { transform: scale === 1 ? 'none' : 'matrix(' + scale + ', 0, 0, ' + scale + ', 0, 0)', transformOrigin: '0px 0px', scaleX: scale, scaleY: scale, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' },
    slotEntries: scaledEntries(baseSlots, scale, scale), wrapperCandidates: [], cardEntries: []
  }, { trigger: label, street: 'preflop' });
  assert.deepStrictEqual(result.info.canonicalBoardLocalRect, rect(520, 260, 306, 80), label + ': canonical board remains table-local');
  assert.strictEqual(Math.round((result.canonicalBoardRect.left - result.leftCompanionRect.right) * 10) / 10, 10, label + ': LEFT gap is stable');
  assert.strictEqual(Math.round((result.rightCompanionRect.left - result.canonicalBoardRect.right) * 10) / 10, 10, label + ': RIGHT gap is stable');
  assert.strictEqual(Math.round(((result.leftCompanionRect.top + result.leftCompanionRect.height / 2) - (result.canonicalBoardRect.top + result.canonicalBoardRect.height / 2)) * 10) / 10, 0, label + ': LEFT stays vertically centered');
  return result;
}
var zoom100 = resolveZoom(1, 1, '100% baseline');
var zoom125 = resolveZoom(0.8, 1.25, '125% equivalent');
var zoom100From125 = resolveZoom(1, 1, '100% restored from 125%');
var zoom80 = resolveZoom(1.25, 0.8, '80% equivalent');
var zoom100From80 = resolveZoom(1, 1, '100% restored from 80%');
assert.deepStrictEqual(zoom100From125.canonicalBoardRect, zoom100.canonicalBoardRect, '100 -> 125 -> 100 restores canonical viewport geometry');
assert.deepStrictEqual(zoom100From80.canonicalBoardRect, zoom100.canonicalBoardRect, '100 -> 80 -> 100 restores canonical viewport geometry');
assert.notStrictEqual(zoom125.layoutEpochId, zoom100.layoutEpochId, '125% equivalent creates a diagnosed scale epoch');
assert.notStrictEqual(zoom80.layoutEpochId, zoom100From125.layoutEpochId, '80% equivalent creates a diagnosed scale epoch');

function resolveHistoryConvergence(startScale, label, historyState, owner, tableId) {
  tableId = tableId || 'zoom-history-' + label;
  historyState = historyState || layout.createState({ tableId: tableId });
  owner = owner || { isConnected: true };
  var startRect = rect(0, 0, 1280 * startScale, 665 * startScale);
  resolve(historyState, {
    tableId: tableId, tableElement: owner,
    viewport: { width: startRect.width, height: startRect.height, devicePixelRatio: 1 / startScale, visualViewportScale: 1 },
    tableRect: startRect,
    tableTransform: { transform: 'matrix(' + startScale + ', 0, 0, ' + startScale + ', 0, 0)', transformOrigin: '0px 0px', scaleX: startScale, scaleY: startScale, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' },
    slotEntries: scaledEntries(baseSlots, startScale, startScale), wrapperCandidates: [], cardEntries: []
  }, { trigger: label + ' starting zoom', street: 'preflop' });

  // Chrome updates viewport metrics before PokerNow always finishes its own
  // responsive relayout. The first final-100% observation can therefore carry
  // slot pixels from the preceding zoom, followed by current slot pixels under
  // the already-stable 100% table signature.
  var staleAt100 = resolve(historyState, {
    tableId: tableId, tableElement: owner,
    viewport: { width: 1280, height: 665, devicePixelRatio: 1, visualViewportScale: 1 },
    tableRect: rect(0, 0, 1280, 665),
    tableTransform: { transform: 'none', transformOrigin: '0px 0px', scaleX: 1, scaleY: 1, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' },
    slotEntries: scaledEntries(baseSlots, startScale, startScale), wrapperCandidates: [], cardEntries: []
  }, { trigger: label + ' -> 100 viewport resize before PokerNow relayout', street: 'preflop' });
  var unrelatedAt100 = resolve(historyState, {
    tableId: tableId, tableElement: owner,
    viewport: { width: 1280, height: 665, devicePixelRatio: 1, visualViewportScale: 1 },
    tableRect: rect(0, 0, 1280, 665),
    tableTransform: { transform: 'none', transformOrigin: '0px 0px', scaleX: 1, scaleY: 1, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' },
    slotEntries: scaledEntries(baseSlots, startScale, startScale), wrapperCandidates: [], cardEntries: []
  }, { trigger: label + ' unrelated table child mutation', street: 'preflop' });
  var settledAt100 = resolve(historyState, {
    tableId: tableId, tableElement: owner,
    viewport: { width: 1280, height: 665, devicePixelRatio: 1, visualViewportScale: 1 },
    tableRect: rect(0, 0, 1280, 665),
    tableTransform: { transform: 'none', transformOrigin: '0px 0px', scaleX: 1, scaleY: 1, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' },
    slotEntries: baseSlots, wrapperCandidates: [], cardEntries: []
  }, { trigger: label + ' -> 100 bounded geometry remeasure', street: 'preflop' });
  assert.deepStrictEqual(staleAt100.info.canonicalBoardRect, rect(520 * startScale, 260 * startScale, 306 * startScale, 80 * startScale), label + ': current structural pixels are followed until native reflow moves them');
  assert.strictEqual(unrelatedAt100.info.awaitingPostTransitionGeometry, false, label + ': no settlement heuristic or prior-epoch coordinate origin');
  assert.deepStrictEqual(settledAt100.canonicalBoardRect, rect(520, 260, 306, 80), label + ': settled 100% geometry is authoritative');
  return settledAt100;
}
var final100From75 = resolveHistoryConvergence(1.25, '75%');
var final100From125 = resolveHistoryConvergence(0.8, '125%');
assert.deepStrictEqual(final100From75.canonicalBoardRect, final100From125.canonicalBoardRect, '75 -> 100 and 125 -> 100 converge to one canonical board');
assert.deepStrictEqual(final100From75.leftCompanionRect, final100From125.leftCompanionRect, 'same final geometry yields identical LEFT regardless of zoom history');
assert.deepStrictEqual(final100From75.rightCompanionRect, final100From125.rightCompanionRect, 'same final geometry yields identical RIGHT regardless of zoom history');
var multiCycleState = layout.createState({ tableId: 'zoom-history-multiple' });
var multiCycleOwner = { isConnected: true };
var multiCycle75 = resolveHistoryConvergence(1.25, '100 -> 75 -> 100 cycle', multiCycleState, multiCycleOwner, 'zoom-history-multiple');
var multiCycle125 = resolveHistoryConvergence(0.8, '100 -> 125 -> 100 cycle', multiCycleState, multiCycleOwner, 'zoom-history-multiple');
assert.deepStrictEqual(multiCycle75.leftCompanionRect, multiCycle125.leftCompanionRect, 'multiple zoom cycles on one state converge to identical Reset/LEFT geometry');
assert.strictEqual(multiCycle125.info.awaitingPostTransitionGeometry, false, 'the final structural settlement leaves no history-bearing transition pending');

var modelState = layout.createState({ tableId: 'no-semantic-structure' });
var modelPreflop = resolve(modelState, { wrapperCandidates: [], slotEntries: [], cardEntries: [] }, { street: 'preflop' });
assert.strictEqual(modelPreflop.canonicalBoardRect, null, 'body/table dimensions alone cannot invent a semantic board origin');
assert.strictEqual(modelPreflop.leftCompanionRect, null);
assert.strictEqual(modelPreflop.rightCompanionRect, null);

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
assert.match(bootstrapRevisionEvents[0].reason, /current semantic board structure updated/);
var laterShift = resolve(bootstrapState, { slotEntries: [], wrapperCandidates: [], cardEntries: cards(4, 450) });
assert.deepStrictEqual(laterShift.canonicalBoardRect, measured.canonicalBoardRect, 'verified geometry cannot be recalibrated by later streets');
assert.strictEqual(bootstrapRevisionEvents.length, 1);
var translatedOwner = resolve(bootstrapState, { tableElement: { isConnected: true }, tableRect: rect(30, 20, 1280, 665), slotEntries: [], wrapperCandidates: [] });
assert.notStrictEqual(translatedOwner.layoutEpochId, measured.layoutEpochId, 'table owner remount still creates an epoch');
assert.strictEqual(translatedOwner.canonicalBoardRect, null, 'owner replacement cannot recover a board from body/table ratios or prior-epoch coordinates');
var scaledOwner = resolve(bootstrapState, {
  tableElement: bootstrapState.tableElement, tableRect: rect(30, 20, 1024, 532), slotEntries: [], wrapperCandidates: [],
  tableTransform: { transform: 'matrix(0.8, 0, 0, 0.8, 0, 0)', scaleX: 0.8, scaleY: 0.8, localWidth: 1280, localHeight: 665, layoutMode: 'game-table' }
});
assert.strictEqual(scaledOwner.canonicalBoardRect, null, 'scaling a coordinate owner does not supply missing semantic evidence');
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

// Sanitized live preflop capture, 2026-09-25: .table-cards.run-1 exists,
// has no children and height 0. The lane is a landmark, not a card union.
var liveLane = rect(393.09375, 185.6041717529297, 488.8958435058594, 0);
function laneEvidence(scale, owner, count, shift) {
  var lane = rect(liveLane.left * scale, liveLane.top * scale, liveLane.width * scale, 0);
  var unit = lane.width / 24.2;
  return evidence({
    tableElement: owner, tableRect: rect(78.86458587646484 * scale, 0, 1122.25 * scale, 530.3125 * scale),
    viewport: { width: 1280 * scale, height: 665 * scale, devicePixelRatio: 1 / scale },
    slotEntries: [], wrapperCandidates: [{ persistentLane: true, rect: lane, classes: 'table-cards run-1' }],
    cardEntries: count ? cards(count, lane.left + (shift || 0), lane.top, 4.5 * unit, 5.5 * unit, 4.9 * unit) : []
  });
}
function liveResolve(state, scale, owner, count, shift) {
  return layout.resolveEvidence(state, laneEvidence(scale, owner, count, shift), { leftSize: { width: 76, height: 56 } });
}
var laneState = layout.createState(); var laneOwner = { isConnected: true };
var beforeFlop = liveResolve(laneState, 1, laneOwner, 0);
assert.ok(beforeFlop.canonicalBoardRect && beforeFlop.leftCompanionRect && beforeFlop.rightCompanionRect);
function assertBoardCentered(result, label) {
  var boardCenter = result.canonicalBoardRect.top + result.canonicalBoardRect.height / 2;
  assert.ok(Math.abs(result.leftCompanionRect.top + result.leftCompanionRect.height / 2 - boardCenter) < 0.001, label + ': complete 76×56 LEFT panel centers on the five-card envelope');
  assert.ok(Math.abs(result.rightCompanionRect.top + result.rightCompanionRect.height / 2 - boardCenter) < 0.001, label + ': independent RIGHT uses the same center');
}
assert.deepStrictEqual([beforeFlop.leftCompanionRect.width, beforeFlop.leftCompanionRect.height], [76, 56]);
assertBoardCentered(beforeFlop, 'zero-card virtual preflop board');
assert.strictEqual(beforeFlop.canonicalBoardRect.left, liveLane.left);
assert.strictEqual(beforeFlop.canonicalBoardRect.top, liveLane.top);
assert.strictEqual(beforeFlop.leftCompanionRect.right, liveLane.left - 10);
assert.strictEqual(beforeFlop.rightCompanionRect.left, beforeFlop.canonicalBoardRect.right + 10);
assert.match(beforeFlop.source, /persistent PokerNow .*run-1 lane/);
assert.ok(Math.abs(beforeFlop.info.expectedFirstSlotRect.width - liveLane.width / 24.2 * 4.5) < 0.1, 'preflop first-card diagnostic uses the native card width');
[3, 4, 5, 0].forEach(function (count) {
  var result = liveResolve(laneState, 1, laneOwner, count);
  assert.deepStrictEqual(result.canonicalBoardRect, beforeFlop.canonicalBoardRect, 'card count cannot create a second origin');
  assert.deepStrictEqual(result.leftCompanionRect, beforeFlop.leftCompanionRect);
  assertBoardCentered(result, count ? count === 3 ? 'flop' : count === 4 ? 'turn' : 'river' : 'between hands');
  assert.strictEqual(result.source, beforeFlop.source);
  if (count) {
    assert.strictEqual(result.info.virtualModelMismatch, false);
    Object.values(result.info.virtualToMeasuredDelta).forEach(function (value) { assert.ok(Math.abs(value) < 0.001); });
  }
});
var disagree = liveResolve(laneState, 1, laneOwner, 3, 80);
assert.strictEqual(disagree.info.virtualModelMismatch, true, 'large measured delta diagnoses an incorrect model, never silently snaps');
assert.ok(Math.abs(disagree.info.virtualToMeasuredDelta.left - 80) < 0.001);
assert.deepStrictEqual(disagree.canonicalBoardRect, beforeFlop.canonicalBoardRect);
[0.75, 1, 1.25, 1, 0.75, 1, 1.25, 1].forEach(function (scale) {
  var result = liveResolve(laneState, scale, laneOwner, 0);
  assert.strictEqual(result.source, beforeFlop.source);
  assert.ok(Math.abs(result.canonicalBoardRect.left - liveLane.left * scale) < 0.001);
  if (scale === 1) {
    assert.deepStrictEqual(result.leftCompanionRect, beforeFlop.leftCompanionRect, 'every final 100% Reset target converges');
    assert.deepStrictEqual(result.rightCompanionRect, beforeFlop.rightCompanionRect);
  }
});
var bodyEvidence = laneEvidence(1, { isConnected: true, tagName: 'BODY' }, 0);
bodyEvidence.tableRect = rect(0, 0, 2000, 1200);
bodyEvidence.tableTransform = { scaleX: 1, scaleY: 1, localWidth: 2000, localHeight: 1200 };
var bodyFrame = layout.resolveEvidence(layout.createState(), bodyEvidence, { leftSize: { width: 76, height: 56 } });
assert.deepStrictEqual(bodyFrame.canonicalBoardRect, beforeFlop.canonicalBoardRect, 'body is only a projection owner');
assert.deepStrictEqual(bodyFrame.rightCompanionRect, beforeFlop.rightCompanionRect);
var independentRight = layout.resolveEvidence(laneState, laneEvidence(1, laneOwner, 0), { leftSize: { width: 188, height: 56 }, context: { persistedOffsetX: 400, persistedOffsetY: 100 } });
assert.deepStrictEqual(independentRight.rightCompanionRect, beforeFlop.rightCompanionRect, 'LEFT width/offset cannot affect RIGHT');
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
