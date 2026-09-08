'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var mutationObservers = [];
var resizeObservers = [];
function MutationObserver(callback) {
  this.callback = callback;
  this.observe = function (target, options) { this.target = target; this.options = options; mutationObservers.push(this); };
  this.disconnect = function () {};
}
function ResizeObserver(callback) {
  this.callback = callback;
  this.observe = function () {};
  this.unobserve = function () {};
  this.disconnect = function () {};
  resizeObservers.push(this);
}
var harness = harnessSupport.createHarness({
  gameId: 'stabilization-b-observer-budget',
  controlledTimers: true,
  controlledAnimationFrames: true,
  MutationObserver: MutationObserver,
  ResizeObserver: ResizeObserver,
  transformContentSource: function (source) {
    return source.replace(/\n\}\)\(\);\s*$/, '\n  globalThis.__PNHUD_OBSERVER_BUDGET__ = { setWebsocketReady: function () { websocketStatsSourceAvailable = true; }, acceptHandEvent: acceptHandEvent, renderSettingsPanel: renderSettingsPanel, applyOpacityStorageChange: function () { var next = PokerHudSettings.merge(hudUiPreferences, { hudOpacity: 0.51 }); var change = {}; change[STORAGE_KEYS.hudUiPreferences] = { newValue: next }; handleStorageChanged(change, \'local\'); }, observerWorkState: function () { return { nativePanelOcclusionPending: nativePanelOcclusionFrame !== null }; } };\n})();\n');
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
harness.flushTimers(200);
harness.flushAnimationFrames(200);
harness.flushTimers(200);

function performanceInfo() { return JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDCareer.sessionPerformanceInfo())')); }
var idleBefore = performanceInfo();
var idleAfter = performanceInfo();
assert.deepStrictEqual(idleAfter.runtimeCounts, idleBefore.runtimeCounts, 'an idle table performs no observer, discovery, reconcile, or render work');

harness.evaluateInIsolatedWorld('__PNHUD_OBSERVER_BUDGET__.setWebsocketReady()');
var actionBefore = performanceInfo();
for (var index = 0; index < 20; index += 1) {
  harness.evaluateInIsolatedWorld("__PNHUD_OBSERVER_BUDGET__.acceptHandEvent({ handId: 'action-heavy', playerId: 'p" + (index % 6) + "', player: 'P" + (index % 6) + "', action: 'call', street: 'preflop', amount: " + (index + 1) + ", timestamp: " + (index + 1) + ", eventKey: 'heavy-" + index + "' }, 'event-" + index + "', 'websocket', null)");
}
var actionAfter = performanceInfo();
assert.strictEqual(actionAfter.runtimeCounts.leaderboardRenderCount - actionBefore.runtimeCounts.leaderboardRenderCount, 0, 'action-heavy staged state does not rebuild the leaderboard');
assert.strictEqual(actionAfter.runtimeCounts.stagedStatRenderSkips - actionBefore.runtimeCounts.stagedStatRenderSkips, 20);

var seatObserver = mutationObservers.find(function (observer) { return observer.options && (observer.options.attributeFilter || []).includes('data-player-name'); });
assert.ok(seatObserver, 'the one production seat/table body observer is installed');
['data-player-id', 'data-stack', 'hidden'].forEach(function (attributeName) {
  assert.ok(seatObserver.options.attributeFilter.includes(attributeName), 'the seat observer retains native ' + attributeName + ' visibility');
});
var seatBefore = performanceInfo();
for (var mutationIndex = 0; mutationIndex < 10; mutationIndex += 1) seatObserver.callback([{ type: 'attributes', target: seatObserver.target, addedNodes: [], removedNodes: [] }]);
harness.flushTimers(200);
var seatAfter = performanceInfo();
assert.strictEqual(seatAfter.runtimeCounts.bodyMutationObserverCallbacks - seatBefore.runtimeCounts.bodyMutationObserverCallbacks, 10);
assert.strictEqual(seatAfter.runtimeCounts.seatDiscoveryRequests - seatBefore.runtimeCounts.seatDiscoveryRequests, 10);
assert.strictEqual(seatAfter.runtimeCounts.seatDiscoveryExecutions - seatBefore.runtimeCounts.seatDiscoveryExecutions, 1, 'ten same-turn seat mutations debounce to one discovery execution');

function observerWorkState() { return JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(__PNHUD_OBSERVER_BUDGET__.observerWorkState())')); }
function drainObserverWork() {
  for (var pass = 0; pass < 3; pass += 1) {
    harness.flushTimers(200);
    harness.flushAnimationFrames(200);
  }
}
function ownedElement(id, ancestorId) {
  var element = { nodeType: 1, id: id || '', parentElement: null };
  element.closest = function (selector) {
    if (selector === '#' + element.id && element.id) return element;
    return selector === '#' + ancestorId ? element : null;
  };
  return element;
}
function mutation(type, target, addedNodes, removedNodes, attributeName) {
  return { type: type, target: target, addedNodes: addedNodes || [], removedNodes: removedNodes || [], attributeName: attributeName || null };
}
function assertObserverIgnored(label, mutations) {
  drainObserverWork();
  assert.strictEqual(observerWorkState().nativePanelOcclusionPending, false, label + ' starts without pending native-panel work');
  var before = performanceInfo();
  seatObserver.callback(mutations);
  var after = performanceInfo();
  assert.strictEqual(after.runtimeCounts.seatDiscoveryRequests - before.runtimeCounts.seatDiscoveryRequests, 0, label + ' does not request seat discovery');
  assert.strictEqual(observerWorkState().nativePanelOcclusionPending, false, label + ' does not request native-panel occlusion work');
}
function assertObserverVisible(label, mutations) {
  drainObserverWork();
  var before = performanceInfo();
  seatObserver.callback(mutations);
  var after = performanceInfo();
  assert.strictEqual(after.runtimeCounts.seatDiscoveryRequests - before.runtimeCounts.seatDiscoveryRequests, 1, label + ' requests seat discovery');
  assert.strictEqual(observerWorkState().nativePanelOcclusionPending, true, label + ' requests native-panel occlusion work');
}

var dashboardRoot = ownedElement('pnhud-player-dashboard');
var dashboardChild = ownedElement('', 'pnhud-player-dashboard');
var dashboardText = { nodeType: 3, parentElement: dashboardChild };
var nativeSeat = ownedElement('native-seat');
var nativeTable = ownedElement('native-table');

assertObserverIgnored('Dashboard root attribute mutation', [mutation('attributes', dashboardRoot, null, null, 'style')]);
assertObserverIgnored('Dashboard descendant attribute mutation', [mutation('attributes', dashboardChild, null, null, 'aria-expanded')]);
assertObserverIgnored('Dashboard descendant child mutation', [mutation('childList', dashboardChild, [ownedElement('dashboard-render-child')])]);
assertObserverIgnored('Dashboard descendant text mutation', [mutation('characterData', dashboardText)]);

var dashboardMutation = mutation('attributes', dashboardChild, null, null, 'class');
var nativeMutation = mutation('attributes', nativeSeat, null, null, 'data-player-name');
assertObserverVisible('Dashboard-first mixed mutation batch', [dashboardMutation, nativeMutation]);
assertObserverVisible('native-first mixed mutation batch', [nativeMutation, dashboardMutation]);

assertObserverVisible('native seat identity mutation', [mutation('attributes', nativeSeat, null, null, 'data-player-id')]);
assertObserverVisible('native seat stack mutation', [mutation('attributes', nativeSeat, null, null, 'data-stack')]);
assertObserverVisible('native seat visibility mutation', [mutation('attributes', nativeSeat, null, null, 'hidden')]);
assertObserverVisible('native table descendant mutation', [mutation('childList', nativeTable, [nativeSeat])]);
assertObserverVisible('native seat remount mutation under body', [mutation('childList', seatObserver.target, [nativeSeat])]);

assertObserverVisible('Dashboard insertion under body', [mutation('childList', seatObserver.target, [dashboardRoot])]);
assertObserverVisible('Dashboard removal under body', [mutation('childList', seatObserver.target, [], [dashboardRoot])]);

var settingsRoot = ownedElement('pnhud-settings-panel');
var settingsChild = ownedElement('', 'pnhud-settings-panel');
var potOddsRoot = ownedElement('pnhud-pot-odds-root');
var potOddsChild = ownedElement('', 'pnhud-pot-odds-root');
assertObserverIgnored('Settings root mutation', [mutation('attributes', settingsRoot, null, null, 'style')]);
assertObserverIgnored('Settings descendant mutation', [mutation('attributes', settingsChild, null, null, 'class')]);
assertObserverIgnored('Pot Odds descendant mutation', [mutation('attributes', potOddsChild, null, null, 'style')]);
assertObserverIgnored('Pot Odds insertion under body', [mutation('childList', seatObserver.target, [potOddsRoot])]);

var resizeBefore = performanceInfo();
resizeObservers.forEach(function (observer) { for (var resizeIndex = 0; resizeIndex < 10; resizeIndex += 1) observer.callback([]); });
harness.flushTimers(200);
var resizeAfter = performanceInfo();
assert.strictEqual(resizeAfter.runtimeCounts.seatResizeObserverCallbacks - resizeBefore.runtimeCounts.seatResizeObserverCallbacks, 10, 'the seat ResizeObserver callback is instrumented');
assert.strictEqual(resizeAfter.runtimeCounts.seatDiscoveryExecutions - resizeBefore.runtimeCounts.seatDiscoveryExecutions, 1, 'same-turn resize bursts debounce to one seat discovery');

var cacheBefore = performanceInfo().sessionStatsCache;
harness.evaluateInIsolatedWorld("(function () { var q = [{}, { position: 'BTN' }, { statId: 'threeBet' }, { statId: 'foldToFlopCBet' }]; q.forEach(function (f) { PokerNowHUDCareer.filteredSessionStats('p0', f); }); q.forEach(function (f) { PokerNowHUDCareer.filteredSessionStats('p0', f); }); })()");
var cacheAfter = performanceInfo().sessionStatsCache;
assert.strictEqual(cacheAfter.misses - cacheBefore.misses, 4, 'four dashboard query dimensions compute once');
assert.strictEqual(cacheAfter.hits - cacheBefore.hits, 4, 'the second dashboard pass is entirely warm');

var settingsBefore = performanceInfo();
harness.evaluateInIsolatedWorld('__PNHUD_OBSERVER_BUDGET__.renderSettingsPanel()');
harness.evaluateInIsolatedWorld('__PNHUD_OBSERVER_BUDGET__.applyOpacityStorageChange()');
var settingsAfter = performanceInfo();
assert.strictEqual(settingsAfter.runtimeCounts.leaderboardRenderCount, settingsBefore.runtimeCounts.leaderboardRenderCount, 'opening Settings and applying opacity styles do not rebuild Session leaderboard statistics');

console.log('STABILIZATION_B_OBSERVER_BUDGET ' + JSON.stringify({
  idleDelta: 0,
  stagedActions: 20,
  stagedLeaderboardRenders: 0,
  seatMutationCallbacks: 10,
  seatDiscoveryRequests: 10,
  seatDiscoveryExecutions: 1,
  dashboardOwnedMutationCases: 4,
  mixedMutationOrders: 2,
  nativeMutationCases: 5,
  dashboardBodyLifecycleCases: 2,
  existingOwnedSurfaceCases: 4,
  resizeCallbacks: 10,
  resizeDiscoveryExecutions: 1,
  dashboardMisses: 4,
  dashboardHits: 4,
  pendingTimers: harness.pendingTimerCount(),
  listenerCounts: { windowMessage: harness.listenerCount('message'), documentClick: harness.documentListenerCount('click') },
  observerTargets: mutationObservers.length
}));
