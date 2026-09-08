'use strict';

var assert = require('assert');
var manifest = require('./manifest.json');
var visibilityHarness = require('./testSupport/potOddsProductionVisibilityHarness.js');

function initialize(options) {
  var harness = visibilityHarness.createHarness(Object.assign({ persistentBoardSlot: true }, options));
  assert.deepStrictEqual(harness.evaluationErrors, [], 'exact isolated-world manifest scripts evaluate without error');
  var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
  assert.deepStrictEqual(harness.isolatedScripts, isolated, 'fixture loads the exact production manifest script order');
  visibilityHarness.dispatchRegisteredCall100(harness, harness.now());
  harness.runFor(1000, 16);
  assert.strictEqual(visibilityHarness.decision(harness).status, 'supported', 'authoritative CALL 100 reaches production content.js');
  return harness;
}

function assertOneVisibleLeftPill(harness, expectedBoardLeft, label) {
  var placement = visibilityHarness.placement(harness);
  var actual = visibilityHarness.actualDomVisibility(harness);
  assert.strictEqual(placement.actualVisibility.visible, true, label + ': production placement succeeds');
  assert.strictEqual(actual.visible, true, label + ': independent DOM visibility succeeds');
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': shared service owns the anchor');
  assert.strictEqual(placement.selectedSide, 'left', label + ': LEFT slot is fixed');
  assert.strictEqual(placement.canonicalBoardRect.left, expectedBoardLeft, label + ': expected five-slot envelope');
  assert.strictEqual(placement.horizontalGap, 10, label + ': exact 10px gap');
  assert.strictEqual(actual.pillRect.right, expectedBoardLeft - 10, label + ': pill right follows canonical board left');
  assert.strictEqual(placement.proposedPillRect.right, expectedBoardLeft - 10, label + ': placement and render agree');
  assert.strictEqual(harness.count('#pnhud-pot-odds-root'), 1, label + ': one stable root');
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1, label + ': one host');
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, label + ': one pill');
  assert.strictEqual(actual.host.parentElement.id, 'pnhud-pot-odds-root');
  assert.strictEqual(actual.host.parentElement.parentElement, harness.document.body);
  assert.strictEqual(actual.hostStyle.position, 'fixed');
  assert.strictEqual(actual.host.style.left, placement.proposedPillRect.left + 'px');
  assert.strictEqual(actual.host.style.top, placement.proposedPillRect.top + 'px');
  assert.strictEqual(actual.host.style.transform || '', '');
  assert.strictEqual(placement.collision.card, false, label + ': companion never overlaps board');
  return { placement: placement, actual: actual };
}

var full = initialize({ gameId: 'pot-odds-full-width-production', layout: 'full', viewport: { width: 1720, height: 900 }, initialNow: 1000 });
var fullResult = assertOneVisibleLeftPill(full, 760, '1720x900 initial render without resize');
assert.strictEqual(visibilityHarness.decision(full).amountToCall, 100);
assert.strictEqual(visibilityHarness.decision(full).currentEligiblePot, 460);
assert.strictEqual(visibilityHarness.timeline(full).events.some(function (event) { return event.eventType === 'viewport-change'; }), false);
assert.strictEqual(fullResult.placement.visibilityStats.active, false, 'visibility work stops after placement');
var stableHost = full.document.getElementById('pnhud-hero-pot-odds');

var narrow = initialize({ gameId: 'pot-odds-narrow-production', layout: 'narrow', viewport: { width: 1160, height: 900 }, initialNow: 5000 });
assertOneVisibleLeftPill(narrow, 430, '1160x900 independent initial render');

visibilityHarness.dispatchFrame(full, visibilityHarness.socket('gC', { pot: 660, tB: { playerA: 'check', playerB: 200 }, cPI: 'playerA', pITT: 'playerA' }), 'supported-call200', full.now());
full.runFor(500, 16);
assert.strictEqual(visibilityHarness.decision(full).amountToCall, 200);
assert.match(stableHost.innerHTML, /Call 200/);
assertOneVisibleLeftPill(full, 760, 'supported-to-supported update');
assert.strictEqual(full.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'content updates reuse one host');

var enabledPreferences = visibilityHarness.clone(full.storage.hudUiPreferences);
var disabledPreferences = Object.assign({}, enabledPreferences, { showPotOdds: false });
full.emitStorageChange({ hudUiPreferences: { oldValue: enabledPreferences, newValue: disabledPreferences } });
full.runFor(300, 16);
assert.strictEqual(full.count('.pnhud-pot-odds'), 0, 'Settings OFF hides the pill');
assert.strictEqual(visibilityHarness.placement(full).visibilityStats.active, false, 'Settings OFF cancels retry work');
full.emitStorageChange({ hudUiPreferences: { oldValue: disabledPreferences, newValue: enabledPreferences } });
full.runFor(400, 16);
assertOneVisibleLeftPill(full, 760, 'Settings ON restores without resize');
assert.strictEqual(full.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'setting cycle retains host identity');

var wrapperBeforeLoss = full.fixture.boardSlot;
full.fixture.removeBoardSlotOwner();
full.runFor(300, 16);
var cached = assertOneVisibleLeftPill(full, 760, 'temporary board-owner loss');
assert.strictEqual(cached.placement.cachedGeometryReused, true, 'same-table loss uses last verified geometry');
assert.strictEqual(wrapperBeforeLoss.isConnected, false);
full.fixture.restoreBoardSlotOwner();
full.runFor(300, 16);
assertOneVisibleLeftPill(full, 760, 'board owner reacquired');
assert.strictEqual(visibilityHarness.placement(full).cachedGeometryReused, false);

var replacement = full.fixture.replaceBoardSlotOwner();
full.runFor(300, 16);
assert.strictEqual(replacement.previous.isConnected, false, 'old board owner disconnected');
assert.strictEqual(replacement.current.isConnected, true, 'new board owner connected');
assertOneVisibleLeftPill(full, 760, 'same-table board owner replacement');

full.fixture.setLayout('narrow');
full.setViewport(1160, 900, true);
full.runFor(500, 16);
assertOneVisibleLeftPill(full, 430, 'material viewport resize recalculates current slot geometry');
assert.strictEqual(full.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'resize reuses host');
full.fixture.setLayout('full');
full.setViewport(1720, 900, true);
full.runFor(500, 16);
assertOneVisibleLeftPill(full, 760, 'viewport round trip');

var discoveryBefore = full.seatDiscoveryQueryCount();
var pill = full.document.querySelector('.pnhud-pot-odds');
pill.remove();
full.flushMutationObservers();
full.runFor(1000, 50);
assert.strictEqual(full.count('.pnhud-pot-odds'), 0, 'owned pill removal has no autonomous watchdog repair');
assert.strictEqual(full.seatDiscoveryQueryCount(), discoveryBefore, 'owned mutation does not wake general seat discovery');
full.triggerResizeObserver(full.fixture.boardSlot);
full.runFor(120, 16);
assertOneVisibleLeftPill(full, 760, 'legitimate board resize signal repairs pill');

var duplicateRoot = full.document.createElement('div');
duplicateRoot.id = 'pnhud-pot-odds-root';
full.document.body.appendChild(duplicateRoot);
full.triggerResizeObserver(full.fixture.boardSlot);
full.runFor(120, 16);
assert.strictEqual(full.count('#pnhud-pot-odds-root'), 1, 'reconcile removes duplicate owned roots');
assertOneVisibleLeftPill(full, 760, 'duplicate-root reconciliation');

var beforeStable = visibilityHarness.clone(visibilityHarness.placement(full).visibilityStats);
var timelineBeforeStable = visibilityHarness.timeline(full).events.length;
full.runFor(30000, 100);
var afterStable = visibilityHarness.placement(full).visibilityStats;
assert.strictEqual(afterStable.active, false, 'no polling loop remains active');
assert.strictEqual(afterStable.placementAttempts, beforeStable.placementAttempts, '30 stable seconds add no placement attempts');
assert.strictEqual(afterStable.domWrites, beforeStable.domWrites, '30 stable seconds add no DOM writes');
assert.strictEqual(afterStable.timerRetries, 0, 'shared layout uses no visibility timer');
assert.strictEqual(visibilityHarness.timeline(full).events.length, timelineBeforeStable, 'stable runtime emits no polling forensics');
assert.deepStrictEqual(full.pendingWork(), { timers: 0, animationFrames: 0, mutationRecords: 0 });

console.log('Pot-odds production visibility hardening passed:', JSON.stringify({ initial: fullResult.actual.pillRect, cachedRemount: cached.placement.cachedGeometryReused, stableThirtySeconds: { placementAttempts: afterStable.placementAttempts, domWrites: afterStable.domWrites, active: afterStable.active } }));
