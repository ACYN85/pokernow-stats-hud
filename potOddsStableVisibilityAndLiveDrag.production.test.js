'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');
var potHarness = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointerHarness = require('./testSupport/productionPointerEventHarness.js');

function initializePotOdds(gameId) {
  var harness = potHarness.createHarness({ gameId: gameId, layout: 'full', persistentBoardSlot: true, viewport: { width: 1720, height: 900 }, initialNow: 1000 });
  assert.deepStrictEqual(harness.evaluationErrors, [], 'the exact isolated-world manifest path evaluates cleanly');
  potHarness.dispatchRegisteredCall100(harness, harness.now());
  harness.runFor(2000, 16);
  return harness;
}

function assertSingleVisiblePill(harness, boardLeft, label) {
  var decision = potHarness.decision(harness);
  var placement = potHarness.placement(harness);
  var dom = potHarness.actualDomVisibility(harness);
  assert.strictEqual(decision.status, 'supported', label + ': semantic decision remains supported');
  assert.strictEqual(placement.actualVisibility.visible, true, label + ': production connected nonzero viewport placement passes');
  assert.strictEqual(dom.visible, true, label + ': independent DOM/computed-style visibility passes');
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': shared board service owns placement');
  assert.strictEqual(placement.selectedSide, 'left', label + ': LEFT companion remains fixed');
  assert.strictEqual(placement.horizontalGap, 10, label + ': horizontal gap remains exactly 10px');
  assert.strictEqual(placement.heroCardRect, null, label + ': hero-card geometry is not a companion anchor');
  assert.strictEqual(placement.canonicalBoardRect.left, boardLeft, label + ': canonical board geometry is used');
  assert.strictEqual(dom.pillRect.right, boardLeft - 10, label + ': rendered pill is exactly 10px left of board');
  assert.strictEqual(harness.count('#pnhud-pot-odds-root'), 1, label + ': one stable root');
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1, label + ': one host');
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, label + ': one pill');
  return { decision: decision, placement: placement, dom: dom };
}

var visibility = initializePotOdds('phase-1-9-stable-visibility');
var initial = assertSingleVisiblePill(visibility, 760, 'stable 1720x900 initial render');
assert.deepStrictEqual(
  [initial.decision.amountToCall, initial.decision.currentEligiblePot, initial.decision.potAfterCall, Math.round(initial.decision.requiredEquity * 1000) / 10],
  [100, 460, 560, 17.9],
  'CALL 100 arithmetic remains unchanged'
);

// A stable supported decision must not leave a mutation-driven or timer-driven
// integrity loop behind. Thirty synthetic seconds should be completely quiet.
var stableStatsBefore = JSON.parse(JSON.stringify(initial.placement.visibilityStats));
var stableTimelineBefore = potHarness.timeline(visibility).events.length;
assert.deepStrictEqual(visibility.pendingWork(), { timers: 0, animationFrames: 0, mutationRecords: 0 }, 'fixture reaches a fully quiescent stable state');
visibility.runFor(30000, 100);
var stableAfter = assertSingleVisiblePill(visibility, 760, 'after 30 stable seconds');
['placementAttempts', 'domWrites', 'idleRetries', 'animationFrameRetries', 'timerRetries', 'remountCount'].forEach(function (field) {
  assert.strictEqual(stableAfter.placement.visibilityStats[field], stableStatsBefore[field], '30 stable seconds add no ' + field);
});
assert.strictEqual(stableAfter.placement.visibilityStats.active, false, 'visibility polling remains stopped');
assert.strictEqual(potHarness.timeline(visibility).events.length, stableTimelineBefore, 'no forensic/mutation-loop noise accumulates while stable');
assert.deepStrictEqual(visibility.pendingWork(), { timers: 0, animationFrames: 0, mutationRecords: 0 }, 'stable 30-second window ends quiescent');

// Explicit viewport and hero-card ResizeObserver signals each produce one
// bounded reconciliation while preserving the decision and node multiplicity.
var revisionBeforeResize = stableAfter.placement.currentDecisionRevision;
var fingerprintBeforeResize = stableAfter.placement.currentRenderFingerprint;
visibility.fixture.setLayout('narrow');
visibility.setViewport(1160, 900, true);
visibility.triggerResizeObserver(visibility.fixture.boardSlot);
visibility.runFor(500, 16);
var narrowed = assertSingleVisiblePill(visibility, 430, 'explicit viewport resize');
assert.strictEqual(narrowed.placement.currentDecisionRevision, revisionBeforeResize, 'resize does not create a semantic revision');
assert.strictEqual(narrowed.placement.currentRenderFingerprint, fingerprintBeforeResize, 'resize preserves the decision fingerprint');
assert.ok(potHarness.timeline(visibility).events.some(function (event) { return event.eventType === 'viewport-change'; }), 'viewport resize is forensically recorded');

visibility.fixture.setLayout('full');
visibility.setViewport(1720, 900, true);
visibility.runFor(500, 16);
var resizeElement = visibility.fixture.boardSlot;
visibility.fixture.setCardGeometry([
  potHarness.rect(1210, 680, 44, 62),
  potHarness.rect(1258, 680, 44, 62)
]);
var anchorResizeEventsBefore = potHarness.timeline(visibility).events.filter(function (event) { return event.eventType === 'anchor-resize-signal'; }).length;
visibility.triggerResizeObserver(resizeElement);
visibility.runFor(300, 16);
assertSingleVisiblePill(visibility, 760, 'board-slot ResizeObserver reconciliation');
var anchorResizeEventsAfter = potHarness.timeline(visibility).events.filter(function (event) { return event.eventType === 'anchor-resize-signal'; }).length;
assert.ok(anchorResizeEventsAfter > anchorResizeEventsBefore, 'observed board-slot resize reaches the production anchor observer');

// PokerNow card replacement must replace the observed identity and recover
// through the targeted mutation signal, without a viewport event.
var oldCard = visibility.fixture.cards.elements[0];
var viewportEventsBeforeReplacement = potHarness.timeline(visibility).events.filter(function (event) { return event.eventType === 'viewport-change'; }).length;
visibility.fixture.mountHeroCards([
  potHarness.rect(1240, 690, 44, 62),
  potHarness.rect(1288, 690, 44, 62)
]);
visibility.runFor(500, 16);
assert.strictEqual(oldCard.isConnected, false, 'old hero card node is disconnected');
assert.notStrictEqual(visibility.fixture.cards.elements[0], oldCard, 'replacement has a new DOM identity');
assertSingleVisiblePill(visibility, 760, 'hero-card DOM replacement cannot move companion');
assert.strictEqual(potHarness.timeline(visibility).events.filter(function (event) { return event.eventType === 'viewport-change'; }).length, viewportEventsBeforeReplacement, 'card replacement uses no resize recovery');
assert.ok(potHarness.timeline(visibility).events.some(function (event) { return event.eventType === 'anchor-mutation-signal'; }), 'card replacement is observed by the targeted mutation path');

// Supported update, between-action zero, restoration, and Settings OFF/ON must update the
// same single host without duplicates or residual visibility work.
var stableHost = visibility.document.getElementById('pnhud-hero-pot-odds');
potHarness.dispatchFrame(visibility, potHarness.socket('gC', { pot: 660, tB: { playerA: 'check', playerB: 200 }, cPI: 'playerA', pITT: 'playerA' }), 'call-200-update', visibility.now());
visibility.runFor(300, 16);
var updated = assertSingleVisiblePill(visibility, 760, 'supported-to-supported update');
assert.deepStrictEqual([updated.decision.amountToCall, updated.decision.currentEligiblePot], [200, 660]);
assert.ok(/Call 200/.test(stableHost.innerHTML), 'mounted widget content updates to the new call');
assert.strictEqual(visibility.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'supported update reuses the host');

potHarness.dispatchIdle(visibility, visibility.now());
visibility.runFor(300, 16);
assert.strictEqual(potHarness.decision(visibility).status, 'idle');
assert.strictEqual(potHarness.placement(visibility).visibilityStats.active, false, 'stable between-action presentation has no residual visibility work');
assert.strictEqual(visibility.count('.pnhud-pot-odds'), 1, 'between-action state retains the pill');
assert.match(stableHost.innerHTML, /Call 0 .* Need —/, 'between-action state removes stale call values');
assert.strictEqual(visibility.count('#pnhud-hero-pot-odds'), 1, 'between-action state retains one stable host');

potHarness.dispatchRegisteredCall100(visibility, visibility.now());
visibility.runFor(300, 16);
assertSingleVisiblePill(visibility, 760, 'decision restoration');
var enabledPreferences = settings.DEFAULTS;
var disabledPreferences = settings.merge(enabledPreferences, { showPotOdds: false });
visibility.emitStorageChange({ hudUiPreferences: { oldValue: enabledPreferences, newValue: disabledPreferences } });
visibility.runFor(300, 16);
assert.strictEqual(potHarness.decision(visibility).status, 'idle', 'Settings OFF disables the semantic UI decision');
assert.strictEqual(visibility.count('.pnhud-pot-odds'), 0, 'Settings OFF removes the pill');
assert.strictEqual(potHarness.placement(visibility).visibilityStats.active, false, 'Settings OFF cancels integrity work');
visibility.emitStorageChange({ hudUiPreferences: { oldValue: disabledPreferences, newValue: enabledPreferences } });
visibility.runFor(300, 16);
assertSingleVisiblePill(visibility, 760, 'Settings ON restoration');

function dragEvent(type, target, values) {
  return pointerHarness.pointerEvent(type, target, Object.assign({ pointerId: 17, clientX: 100, clientY: 100 }, values || {}));
}

function latestManualPosition(harness, playerId) {
  var writes = pointerHarness.manualPositionWrites(harness);
  assert.ok(writes.length, 'drag must write the production manual-position key');
  var update = writes[writes.length - 1];
  var key = Object.keys(update).find(function (candidate) { return candidate.indexOf('pokerNowHudManualOverlayPositions:') === 0; });
  return { key: key, value: update[key][playerId] };
}

function playerOverlay(harness, playerId) {
  return harness.document.querySelectorAll('.pnhud-seat-overlay').find(function (element) { return element.dataset.pnhudPlayerId === playerId; });
}

function assertNonDragTarget(harness, overlay, target, kind) {
  var transformBefore = overlay.style.transform;
  var writesBefore = pointerHarness.manualPositionWrites(harness).length;
  var event = dragEvent('pointerdown', target);
  pointerHarness.bubble(harness, target, event);
  assert.strictEqual(event.defaultPrevented, false, kind + ' pointerdown is not claimed as a drag');
  assert.strictEqual(overlay.classList.contains('pnhud-dragging'), false, kind + ' cannot enter dragging state');
  assert.strictEqual(overlay.style.transform, transformBefore, kind + ' cannot move the overlay');
  assert.strictEqual(pointerHarness.manualPositionWrites(harness).length, writesBefore, kind + ' cannot persist a position');
}

function completeDrag(harness, overlay, grip, pointerId, deltaX, deltaY) {
  pointerHarness.installPointerCapture(grip);
  var startTransform = overlay.style.transform;
  var down = pointerHarness.pointerEvent('pointerdown', grip, { pointerId: pointerId, clientX: 100, clientY: 100, button: 0 });
  var delivered = pointerHarness.bubble(harness, grip, down);
  assert.strictEqual(delivered.delivered, true, 'enabled grip receives pointerdown');
  assert.strictEqual(down.defaultPrevented, true, 'production grip claims pointerdown');
  assert.strictEqual(grip.hasPointerCapture(pointerId), true, 'production establishes pointer capture');
  assert.strictEqual(overlay.classList.contains('pnhud-dragging'), true, 'pointerdown enters dragging state');
  assert.strictEqual(harness.document.documentElement.classList.contains('pnhud-overlay-dragging'), true, 'global drag state is active');
  var move = pointerHarness.documentPointer(harness, 'pointermove', grip, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  assert.strictEqual(move.defaultPrevented, true, 'captured pointermove is consumed');
  assert.notStrictEqual(overlay.style.transform, startTransform, 'pointermove changes the live overlay transform');
  var up = pointerHarness.documentPointer(harness, 'pointerup', grip, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  assert.strictEqual(up.defaultPrevented, true, 'pointerup finishes the drag');
  assert.strictEqual(overlay.classList.contains('pnhud-dragging'), false, 'pointerup clears element drag state');
  assert.strictEqual(harness.document.documentElement.classList.contains('pnhud-overlay-dragging'), false, 'pointerup clears global drag state');
  assert.strictEqual((harness.document._listeners.pointermove || []).length, 0, 'pointermove listener is removed after completion');
  assert.strictEqual((harness.document._listeners.pointerup || []).length, 0, 'pointerup listener is removed after completion');
  return overlay.style.transform;
}

function exerciseLiveDrag(layout) {
  var preferences = settings.merge(settings.DEFAULTS, { opportunityStatsLayout: layout, showPlayerProfiles: true });
  var harness = pointerHarness.createHarness({
    gameId: 'phase-1-9-live-drag-' + layout,
    layout: 'full', viewport: { width: 1720, height: 900 }, initialNow: layout === 'combined' ? 50000 : 60000,
    initialStorage: { hudUiPreferences: preferences, pokerNowHudOverlayDraggingUnlocked: true }
  });
  assert.deepStrictEqual(harness.evaluationErrors, [], layout + ': exact content scripts evaluate cleanly');
  pointerHarness.dispatchRegisteredCall100(harness, harness.now());
  harness.runFor(1000, 16);
  var overlay = playerOverlay(harness, 'playerA');
  assert.ok(overlay && overlay.isConnected, layout + ': production seat reconciliation creates the hero overlay');
  assert.strictEqual(overlay.querySelectorAll('.pnhud-seat-stat-row').length, layout === 'combined' ? 3 : 4, layout + ': production markup uses the selected opportunity layout');
  assert.strictEqual((overlay._listeners.pointerdown || []).length, 1, layout + ': exactly one live pointerdown handler is installed');
  var grip = overlay.querySelector('.pnhud-overlay-grip');
  assert.ok(grip && !grip.disabled, layout + ': production-rendered unlocked grip is enabled');

  var profile = harness.document.createElement('span');
  profile.className = 'pnhud-profile-chip pnhud-profile-tooltip-target';
  profile.setAttribute('data-pnhud-interactive', 'true');
  overlay.appendChild(profile);
  assertNonDragTarget(harness, overlay, overlay.querySelector('.pnhud-player-name'), layout + ' player name');
  assertNonDragTarget(harness, overlay, profile, layout + ' profile chip');
  assertNonDragTarget(harness, overlay, overlay.querySelector('.pnhud-stat-tooltip-target'), layout + ' stat target');

  var writesBeforeFirstDrag = pointerHarness.manualPositionWrites(harness).length;
  completeDrag(harness, overlay, grip, 17, 40, 30);
  assert.strictEqual(pointerHarness.manualPositionWrites(harness).length, writesBeforeFirstDrag + 1, layout + ': completed drag persists once');
  var firstPosition = latestManualPosition(harness, 'playerA');
  assert.ok(firstPosition.value && firstPosition.value.playerId === 'playerA' && firstPosition.value.seatId, layout + ': persisted position retains stable player and seat identity');
  assert.ok(Number.isFinite(firstPosition.value.offsetX) && Number.isFinite(firstPosition.value.offsetY), layout + ': persisted offsets are finite');

  // A real settings/reconcile update rewrites overlay.innerHTML while retaining
  // the same controller element. Delegated pointer behavior must survive once.
  var rerenderedPreferences = settings.merge(preferences, { opportunityStatsLayout: layout === 'combined' ? 'stacked' : 'combined' });
  var oldGrip = grip;
  harness.emitStorageChange({ hudUiPreferences: { oldValue: preferences, newValue: rerenderedPreferences } });
  harness.runFor(1000, 16);
  var rerenderedOverlay = playerOverlay(harness, 'playerA');
  var rerenderedGrip = rerenderedOverlay.querySelector('.pnhud-overlay-grip');
  assert.strictEqual(rerenderedOverlay, overlay, layout + ': controller reuses the overlay element');
  assert.notStrictEqual(rerenderedGrip, oldGrip, layout + ': production rerender replaces grip markup');
  assert.strictEqual(oldGrip.isConnected, false, layout + ': old grip is disconnected');
  assert.strictEqual(rerenderedGrip.isConnected, true, layout + ': new grip is connected');
  assert.strictEqual((rerenderedOverlay._listeners.pointerdown || []).length, 1, layout + ': rerender neither loses nor duplicates the handler');
  assert.strictEqual(rerenderedGrip.disabled, false, layout + ': rerendered grip preserves unlocked state');
  var writesBeforeSecondDrag = pointerHarness.manualPositionWrites(harness).length;
  completeDrag(harness, rerenderedOverlay, rerenderedGrip, 18, -25, -15);
  assert.strictEqual(pointerHarness.manualPositionWrites(harness).length, writesBeforeSecondDrag + 1, layout + ': rerendered grip persists exactly one drag');

  // Locking through the real storage listener updates the same rendered grip;
  // browser-like disabled dispatch suppresses pointerdown before bubbling.
  harness.emitStorageChange({ pokerNowHudOverlayDraggingUnlocked: { oldValue: true, newValue: false } });
  harness.runFor(500, 16);
  var lockedOverlay = playerOverlay(harness, 'playerA');
  var lockedGrip = lockedOverlay.querySelector('.pnhud-overlay-grip');
  assert.strictEqual(lockedGrip.disabled, true, layout + ': storage lock disables the production grip');
  var writesBeforeDisabled = pointerHarness.manualPositionWrites(harness).length;
  var disabledDispatch = pointerHarness.bubble(harness, lockedGrip, pointerHarness.pointerEvent('pointerdown', lockedGrip, { pointerId: 19, clientX: 100, clientY: 100 }));
  assert.strictEqual(disabledDispatch.delivered, false, layout + ': disabled grip receives no browser pointer dispatch');
  assert.strictEqual(lockedOverlay.classList.contains('pnhud-dragging'), false, layout + ': disabled grip cannot start drag');
  assert.strictEqual(pointerHarness.manualPositionWrites(harness).length, writesBeforeDisabled, layout + ': disabled grip cannot persist');

  return {
    initialRows: layout === 'combined' ? 3 : 4,
    writes: pointerHarness.manualPositionWrites(harness).length,
    finalOffset: latestManualPosition(harness, 'playerA').value
  };
}

var combinedDrag = exerciseLiveDrag('combined');
var stackedDrag = exerciseLiveDrag('stacked');

assert.strictEqual(visibility.count('#pnhud-pot-odds-root'), 1, 'entire visibility matrix ends with one root');
assert.strictEqual(visibility.count('#pnhud-hero-pot-odds'), 1, 'entire visibility matrix ends with one host');
assert.strictEqual(visibility.count('.pnhud-pot-odds'), 1, 'entire visibility matrix ends with one pill');

console.log('Stable pot-odds visibility and exact-content live drag integration passed:', JSON.stringify({
  stableThirtySeconds: {
    placementAttempts: stableAfter.placement.visibilityStats.placementAttempts,
    domWrites: stableAfter.placement.visibilityStats.domWrites,
    timerRetries: stableAfter.placement.visibilityStats.timerRetries,
    pendingWork: visibility.pendingWork()
  },
  combinedDrag: combinedDrag,
  stackedDrag: stackedDrag
}));
