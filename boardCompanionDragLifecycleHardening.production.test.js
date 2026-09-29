'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');
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

function visible(harness, label) {
  var actual = harnessApi.actualDomVisibility(harness);
  assert.strictEqual(actual.visible, true, label + ': panel visible');
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1, label + ': exactly one host');
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, label + ': exactly one pill');
  return { actual: actual, placement: harnessApi.placement(harness) };
}

function drag(harness, deltaX, deltaY, pointerId) {
  var host = harness.document.getElementById('pnhud-hero-pot-odds');
  var handle = host.querySelector('.pnhud-pot-odds-title');
  pointer.installPointerCapture(handle);
  pointer.bubble(harness, handle, pointer.pointerEvent('pointerdown', handle, { pointerId: pointerId, clientX: 100, clientY: 100, button: 0 }));
  pointer.documentPointer(harness, 'pointermove', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  pointer.documentPointer(harness, 'pointerup', handle, { pointerId: pointerId, clientX: 100 + deltaX, clientY: 100 + deltaY });
  harness.runFor(64, 16);
}

function click(harness, selector) {
  var element = harness.document.querySelector(selector);
  assert.ok(element, 'click target exists: ' + selector);
  pointer.bubble(harness, element, pointer.pointerEvent('click', element, { button: 0 }));
  harness.runFor(48, 16);
  return element;
}

var defaults = settings.merge(settings.DEFAULTS, { selectedSettingsSection: 'hud' });

// Preferences and first production frame can arrive before the asynchronous storage callback.
// A saved user offset has no hand ownership and survives delayed hydration.
var delayedPreferences = harnessApi.createHarness({
  gameId: 'hardening-delayed-preferences', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 1000, storageGetDelay: 100,
  initialStorage: { hudUiPreferences: settings.merge(defaults, { potOddsOffsetX: 35, potOddsOffsetY: 30 }) }
});
frame(delayedPreferences, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('PREF-FIRST') }, 'frame-before-preferences', 40);
assert.strictEqual(harnessApi.actualDomVisibility(delayedPreferences).visible, false, 'startup frame remains held before preference hydration');
delayedPreferences.runFor(360, 16);
var hydrated = visible(delayedPreferences, '1 delayed preferences hydrate and replay the first hand');
assert.deepStrictEqual([hydrated.placement.persistedOffsetX, hydrated.placement.persistedOffsetY], [35, 30], 'delayed hydration retains the persistent user offset');
assert.strictEqual(JSON.parse(delayedPreferences.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo().manualOverride)')), false);
assert.strictEqual(delayedPreferences.document.getElementById('pnhud-settings-panel').hidden, true, 'first hand appears while Settings is never opened');

// A stale hidden presentation used to survive ordinary seat readiness because reconcile only repainted it.
var delayedHero = harnessApi.createHarness({
  gameId: 'hardening-delayed-hero', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 3000, initialStorage: { hudUiPreferences: defaults }
});
delayedHero.fixture.detachHeroSeat();
frame(delayedHero, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: { hI: 'HERO-DELAY', board: [], iHPI: [], pot: 0 } }, 'identity-before-seat', 300);
assert.strictEqual(harnessApi.actualDomVisibility(delayedHero).visible, false, 'hero applicability is initially unknown');
delayedHero.fixture.restoreHeroSeat();
delayedHero.runFor(520, 16);
visible(delayedHero, '2 ordinary seat readiness re-derives applicability without Settings or a new hand');

// Canonical geometry may be unavailable even though table applicability is already true.
var delayedGeometry = harnessApi.createHarness({
  gameId: 'hardening-delayed-geometry', layout: 'live-full', liveCardDom: true, persistentBoardSlot: false, tableGeometryUnavailable: true,
  viewport: { width: 1280, height: 665 }, initialNow: 5000, initialStorage: { hudUiPreferences: defaults }
});
frame(delayedGeometry, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('GEOMETRY-FIRST') }, 'geometry-not-ready', 260);
var fallback = { actual: harnessApi.actualDomVisibility(delayedGeometry), placement: harnessApi.placement(delayedGeometry) };
assert.strictEqual(fallback.actual.visible, true, '3 supported Pot Odds stays painted when canonical geometry is not ready');
assert.strictEqual(fallback.placement.canonicalGeometryPending, true);
assert.ok(fallback.placement.chosenPanelRect && fallback.placement.chosenPanelRect.width > 0 && fallback.placement.chosenPanelRect.height > 0, '3 fallback has nonzero geometry');
assert.match(fallback.placement.placementStrategy, /(?:deterministic-initial-companion-fallback|retain-last-visible-panel)/, '3 V1.2 visible fallback remains active across reconciliation');
assert.ok(fallback.actual.pillRect.left >= 0 && fallback.actual.pillRect.right <= 1280 && fallback.actual.pillRect.top >= 0 && fallback.actual.pillRect.bottom <= 665, '3 fallback is visibly inside the viewport');
delayedGeometry.setViewport(200, 150, false);
delayedGeometry.fixture.setTableGeometry(harnessApi.rect(0, 0, 0, 0), false);
delayedGeometry.dispatchWindowEvent('resize');
delayedGeometry.runFor(320, 16);
var resizedFallback = visible(delayedGeometry, '3 unavailable geometry remains visible after a drastic resize');
  assert.deepStrictEqual([resizedFallback.actual.pillRect.left, resizedFallback.actual.pillRect.top], [116, 86], '3 retained V1.2 fallback receives the ordinary viewport safety clamp');
assert.ok(resizedFallback.actual.pillRect.left >= 0 && resizedFallback.actual.pillRect.right <= 200 && resizedFallback.actual.pillRect.top >= 0 && resizedFallback.actual.pillRect.bottom <= 150, '3 retained fallback cannot remain offscreen');
delayedGeometry.setViewport(1280, 665, false);
delayedGeometry.triggerResizeObserver(delayedGeometry.fixture.table);
delayedGeometry.runFor(320, 16);
delayedGeometry.fixture.restoreBoardSlotOwner();
delayedGeometry.runFor(320, 16);
var tableRelative = visible(delayedGeometry, '3 semantic empty slots restore preflop placement before board cards');
assert.strictEqual(tableRelative.placement.heroAnchorDiagnostic.canonicalBoardVerified, true, '3 real semantic slots are required for canonical preflop placement');
assert.match(tableRelative.placement.placementStrategy, /canonical-left-board-companion/);
  assert.deepStrictEqual([tableRelative.actual.pillRect.left, tableRelative.actual.pillRect.top], [434, 272]);
delayedGeometry.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
delayedGeometry.runFor(320, 16);
var geometryReady = visible(delayedGeometry, '3 measured board signal automatically applies canonical placement');
assert.strictEqual(geometryReady.placement.canonicalGeometryPending, false);
assert.ok(geometryReady.placement.canonicalLeftCompanionRect);

// Real PokerNow does not expose the synthetic fixture's main.game-table owner.
// Preserve the released V1.2 body-owned fallback so the supported panel cannot
// remain paint-hidden merely because those fixture-only selectors do not match.
var bodyOnlyGeometry = harnessApi.createHarness({
  gameId: 'hardening-body-only-geometry', layout: 'live-full', liveCardDom: true, persistentBoardSlot: false,
  viewport: { width: 1280, height: 665 }, initialNow: 6500, initialStorage: { hudUiPreferences: defaults }
});
bodyOnlyGeometry.document.body.appendChild(bodyOnlyGeometry.fixture.hero.seat);
bodyOnlyGeometry.document.body.appendChild(bodyOnlyGeometry.fixture.opponent.seat);
bodyOnlyGeometry.document.body.appendChild(bodyOnlyGeometry.fixture.action);
bodyOnlyGeometry.document.body.appendChild(bodyOnlyGeometry.fixture.pot);
var bodySlots = bodyOnlyGeometry.fixture.restoreBoardSlotOwner(false);
bodyOnlyGeometry.document.body.appendChild(bodySlots);
bodyOnlyGeometry.fixture.table.remove();
bodyOnlyGeometry.document.body.setRect(harnessApi.rect(0, 0, 1280, 665));
frame(bodyOnlyGeometry, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('BODY-ONLY') }, 'body-is-not-table-geometry', 320);
var bodyOnly = { actual: harnessApi.actualDomVisibility(bodyOnlyGeometry), placement: harnessApi.placement(bodyOnlyGeometry) };
assert.strictEqual(bodyOnly.actual.visible, true, '3 selector-mismatched PokerNow structure still paints Pot Odds');
assert.ok(bodyOnly.actual.hostRect.width > 0 && bodyOnly.actual.hostRect.height > 0 && bodyOnly.actual.pillRect.width > 0 && bodyOnly.actual.pillRect.height > 0, '3 body-owner fallback has nonzero host and pill geometry');
assert.ok(bodyOnly.actual.effectivePaint.ancestors.every(function (entry) { return entry.paintVisible; }), '3 host, portal, body, and document ancestors are effectively painted');
assert.match(bodyOnly.placement.heroAnchorDiagnostic.tableOwnerSource, /body projection-only coordinate owner/);
  assert.deepStrictEqual([bodyOnly.actual.pillRect.left, bodyOnly.actual.pillRect.top], [434, 272], '3 body-owned projection uses independent semantic slot evidence');
assert.ok(bodyOnly.placement.tableRect && bodyOnly.actual.pillRect.left >= bodyOnly.placement.tableRect.left && bodyOnly.actual.pillRect.right <= bodyOnly.placement.tableRect.right && bodyOnly.actual.pillRect.top >= bodyOnly.placement.tableRect.top && bodyOnly.actual.pillRect.bottom <= bodyOnly.placement.tableRect.bottom, '3 body-owned placement is valid inside its coordinate owner');
assert.strictEqual(bodyOnly.placement.rightCompanionRect.left, 836, '3 RIGHT remains independently reserved');

var harness = harnessApi.createHarness({
  gameId: 'hardening-drag-settings-reset', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true,
  viewport: { width: 1280, height: 665 }, initialNow: 8000, initialStorage: { hudUiPreferences: defaults }
});
frame(harness, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('DRAG-HARDENING-1') }, 'first-hand');
var initial = visible(harness, '4 first hand without Settings');
var stableHost = harness.document.getElementById('pnhud-hero-pot-odds');

drag(harness, 150, 0, 81);
var overBoard = visible(harness, '5 drag over community-board area');
assert.ok(overBoard.actual.pillRect.left < overBoard.placement.canonicalBoardRect.right && overBoard.actual.pillRect.right > overBoard.placement.canonicalBoardRect.left, 'manual location overlaps canonical board horizontally');
assert.deepStrictEqual([overBoard.placement.persistedOffsetX, overBoard.placement.persistedOffsetY], [150, 0]);
assert.strictEqual(overBoard.placement.suppressionReason, null, 'board overlap cannot suppress a manual placement');

drag(harness, 40, -65, 82);
var overPot = visible(harness, '6 drag over pot region');
assert.ok(overPot.placement.collision.obstacleIndexes.length > 0, 'pot overlap remains diagnostic');
assert.strictEqual(overPot.placement.visible, true, 'pot overlap does not reject manual placement');
assert.strictEqual(overPot.placement.selectedSide, 'left', 'manual overlap never switches side');

var selfHud = overPot.placement.selfHudRect;
assert.ok(selfHud, 'mapped hero HUD obstacle is available');
drag(harness, selfHud.left - overPot.actual.pillRect.left, selfHud.top - 20 - overPot.actual.pillRect.top, 84);
var overHud = visible(harness, '7 drag over hero HUD region');
assert.ok(overHud.placement.collision.obstacleIndexes.length > 0, 'HUD overlap remains diagnostic');
assert.strictEqual(overHud.placement.suppressionReason, null, 'HUD overlap cannot suppress a manual placement');

var beforeSettings = overHud.actual.pillRect;
click(harness, '#pnhud-settings-launcher');
var settingsOpen = visible(harness, '8 Settings open is not a repair trigger');
assert.deepStrictEqual([settingsOpen.actual.pillRect.left, settingsOpen.actual.pillRect.top], [beforeSettings.left, beforeSettings.top]);
click(harness, '.pnhud-settings-close');
var settingsClosed = visible(harness, '8 Settings close preserves manual position');
assert.deepStrictEqual([settingsClosed.actual.pillRect.left, settingsClosed.actual.pillRect.top], [beforeSettings.left, beforeSettings.top]);

// Re-open, remove canonical geometry, and reset: current pixels remain visible until readiness returns.
click(harness, '#pnhud-settings-launcher');
harness.fixture.removeBoardSlotOwner(false);
harness.fixture.setTableGeometry(harnessApi.rect(0, 0, 0, 0), false);
harness.flushMutationObservers();
harness.runFor(180, 16);
var beforePendingReset = visible(harness, '9 transient canonical loss retains the dragged position');
click(harness, '.pnhud-reset-pot-odds-position');
var pendingReset = visible(harness, '9 reset pending retains a visible panel');
assert.deepStrictEqual([pendingReset.actual.pillRect.left, pendingReset.actual.pillRect.top], [beforePendingReset.actual.pillRect.left, beforePendingReset.actual.pillRect.top]);
assert.deepStrictEqual([pendingReset.placement.persistedOffsetX, pendingReset.placement.persistedOffsetY], [0, 0]);
assert.strictEqual(pendingReset.placement.resetPending, true);
harness.fixture.setTableGeometry(harnessApi.rect(0, 0, 1280, 665), false);
harness.fixture.restoreBoardSlotOwner();
harness.runFor(320, 16);
var resetApplied = visible(harness, '9 ready geometry applies pending reset immediately');
assert.deepStrictEqual([resetApplied.actual.pillRect.left, resetApplied.actual.pillRect.top], [resetApplied.placement.canonicalLeftCompanionRect.left, resetApplied.placement.canonicalLeftCompanionRect.top]);
assert.strictEqual(resetApplied.placement.resetPending, false);
assert.deepStrictEqual([resetApplied.placement.persistedOffsetX, resetApplied.placement.persistedOffsetY], [0, 0]);

click(harness, '.pnhud-settings-close');
frame(harness, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'hand-end');
frame(harness, 'gC', activeState('DRAG-HARDENING-2'), 'next-hand');
var nextHand = visible(harness, '10 hand end and next hand retain reset canonical position');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'same host survives hand lifecycle');
assert.deepStrictEqual([nextHand.placement.persistedOffsetX, nextHand.placement.persistedOffsetY], [0, 0]);

// Extreme manual positions are clamped only to viewport accessibility.
drag(harness, 5000, 5000, 83);
var extreme = visible(harness, '11 extreme offset');
assert.strictEqual(extreme.placement.viewportClampApplied, true);
assert.deepStrictEqual([extreme.placement.persistedOffsetX, extreme.placement.persistedOffsetY], [5000, 5000]);
  assert.deepStrictEqual([extreme.actual.pillRect.left, extreme.actual.pillRect.top], [1196, 601]);

// Root ownership and its own stacking context keep the panel above PokerNow paint.
var root = harness.document.getElementById('pnhud-pot-odds-root');
var rootStyle = harness.contextWindow.getComputedStyle(root);
assert.strictEqual(root.parentElement, harness.document.body, '12 root is a body-owned portal');
assert.strictEqual(rootStyle.position, 'fixed');
assert.ok(Number(rootStyle.zIndex) >= 2147483644, '12 root z-index is above host table content');
assert.strictEqual(rootStyle.overflow, 'visible');
assert.strictEqual(rootStyle.transform, 'none');
assert.strictEqual(rootStyle.pointerEvents, 'none');
assert.strictEqual(harness.contextWindow.getComputedStyle(harness.document.getElementById('pnhud-hero-pot-odds')).pointerEvents, 'auto');

var history = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.eventHistory())'));
var types = history.events.map(function (event) { return event.type; });
['canonical-revision', 'render-requested', 'render-committed', 'drag-start', 'drag-end', 'reset-requested', 'reset-applied', 'settings-layout-signal'].forEach(function (type) {
  assert.ok(types.includes(type), '13 meaningful history contains ' + type);
});
for (var cycle = 0; cycle < 90; cycle += 1) {
  click(harness, '#pnhud-settings-launcher');
  click(harness, '.pnhud-settings-close');
}
history = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.eventHistory())'));
assert.strictEqual(history.capacity, 160);
assert.strictEqual(history.count, 160, '13 meaningful history is bounded');
assert.strictEqual(history.events.length, 160);

assert.deepStrictEqual(delayedPreferences.evaluationErrors.concat(delayedHero.evaluationErrors, delayedGeometry.evaluationErrors, bodyOnlyGeometry.evaluationErrors, harness.evaluationErrors), []);
console.log('BoardCompanion drag/render lifecycle hardening production regressions passed.');
