'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var exactLocation = {
  href: 'https://pokernow.com/games/synthetic-game-route',
  protocol: 'https:',
  hostname: 'pokernow.com',
  pathname: '/games/synthetic-game-route',
  origin: 'https://pokernow.com',
  search: '',
  hash: ''
};
var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
var isolatedEntry = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
var mainEntry = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; });
assert.strictEqual(isolatedEntry.js[0], 'runtimeScope.js');
assert.strictEqual(mainEntry.js[0], 'runtimeScope.js');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'semanticHandLedger.js'; }).length, 1, 'semantic shadow ledger is injected once');
assert.strictEqual(mainEntry.js.includes('semanticHandLedger.js'), false, 'semantic shadow ledger is not injected into the MAIN WebSocket world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'preflopOpportunityReducer.js'; }).length, 1, 'shadow preflop reducer is injected once');
assert.strictEqual(mainEntry.js.includes('preflopOpportunityReducer.js'), false, 'shadow preflop reducer is not injected into the MAIN WebSocket world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'flopCBetOpportunityReducer.js'; }).length, 1, 'shadow flop CBet reducer is injected once');
assert.strictEqual(mainEntry.js.includes('flopCBetOpportunityReducer.js'), false, 'shadow flop CBet reducer is not injected into the MAIN WebSocket world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'showdownStatsReducer.js'; }).length, 1, 'shadow showdown reducer is injected once');
assert.strictEqual(mainEntry.js.includes('showdownStatsReducer.js'), false, 'shadow showdown reducer is not injected into the MAIN WebSocket world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'statExplanation.js'; }).length, 1, 'stat explanation module is injected once in the isolated world');
assert.strictEqual(mainEntry.js.includes('statExplanation.js'), false, 'stat explanations are absent from the MAIN world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'handStatInspector.js'; }).length, 1, 'Hand Stat Inspector is injected once in the isolated world');
assert.strictEqual(mainEntry.js.includes('handStatInspector.js'), false, 'Hand Stat Inspector is absent from the MAIN world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'playerProfileClassifier.js'; }).length, 1, 'profile classifier is injected once in the isolated world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'playerProfilePresentation.js'; }).length, 1, 'profile presentation policy is injected once in the isolated world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'playerProfileExplanation.js'; }).length, 1, 'profile explanation adapter is injected once in the isolated world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'playerProfileShadowStore.js'; }).length, 1, 'profile store is injected once in the isolated world');
assert.strictEqual(isolatedEntry.js.filter(function (file) { return file === 'playerProfileCalibration.js'; }).length, 1, 'profile calibration helper is injected once in the isolated world');
assert.strictEqual(mainEntry.js.includes('playerProfileClassifier.js'), false, 'profile classifier is absent from MAIN world');
assert.strictEqual(mainEntry.js.includes('playerProfilePresentation.js'), false, 'profile presentation policy is absent from MAIN world');
assert.strictEqual(mainEntry.js.includes('playerProfileExplanation.js'), false, 'profile explanation adapter is absent from MAIN world');
assert.strictEqual(mainEntry.js.includes('playerProfileShadowStore.js'), false, 'profile store is absent from MAIN world');
assert.strictEqual(mainEntry.js.includes('playerProfileCalibration.js'), false, 'profile calibration helper is absent from MAIN world');
var semanticLedgerIndex = isolatedEntry.js.indexOf('semanticHandLedger.js');
assert.strictEqual(isolatedEntry.js[semanticLedgerIndex - 1], 'positionResolver.js', 'exact manifest order places the ledger after the canonical position resolver');
assert.strictEqual(isolatedEntry.js[isolatedEntry.js.indexOf('positionResolver.js') - 1], 'handFinalization.js', 'the canonical position resolver follows hand finalization');
assert.strictEqual(isolatedEntry.js[semanticLedgerIndex + 1], 'preflopOpportunityReducer.js', 'exact manifest order places the reducer immediately after the finalized ledger');
var reducerIndex = isolatedEntry.js.indexOf('preflopOpportunityReducer.js');
assert.strictEqual(isolatedEntry.js[reducerIndex + 1], 'flopCBetOpportunityReducer.js', 'exact manifest order places the flop CBet reducer after the preflop reducer');
var flopReducerIndex = isolatedEntry.js.indexOf('flopCBetOpportunityReducer.js');
assert.strictEqual(isolatedEntry.js[flopReducerIndex + 1], 'showdownStatsReducer.js', 'exact manifest order places the showdown reducer after the flop CBet reducer');
var showdownReducerIndex = isolatedEntry.js.indexOf('showdownStatsReducer.js');
var statExplanationIndex = isolatedEntry.js.indexOf('statExplanation.js');
var careerAggregatorIndex = isolatedEntry.js.indexOf('careerStatsAggregator.js');
  var filteredStatsIndex = isolatedEntry.js.indexOf('filteredStats.js');
  var sessionStatsCacheIndex = isolatedEntry.js.indexOf('sessionStatsCache.js');
  var sessionRuntimeIndex = isolatedEntry.js.indexOf('sessionRuntime.js');
  var runtimeBoundsIndex = isolatedEntry.js.indexOf('runtimeBounds.js');
  var careerStoreIndex = isolatedEntry.js.indexOf('careerContributionStore.js');
  var careerIndexedStoreIndex = isolatedEntry.js.indexOf('careerIndexedStore.js');
  var careerBackupPolicyIndex = isolatedEntry.js.indexOf('careerBackupPolicy.js');
  var careerDataSettingsIndex = isolatedEntry.js.indexOf('careerDataSettings.js');
var handStatInspectorIndex = isolatedEntry.js.indexOf('handStatInspector.js');
var profileScoreInspectorIndex = isolatedEntry.js.indexOf('playerProfileScoreInspector.js');
var profileClassifierIndex = isolatedEntry.js.indexOf('playerProfileClassifier.js');
var profilePresentationIndex = isolatedEntry.js.indexOf('playerProfilePresentation.js');
var profileExplanationIndex = isolatedEntry.js.indexOf('playerProfileExplanation.js');
var profileStoreIndex = isolatedEntry.js.indexOf('playerProfileShadowStore.js');
var profileCalibrationIndex = isolatedEntry.js.indexOf('playerProfileCalibration.js');
var playerNotesIndex = isolatedEntry.js.indexOf('playerNotesStore.js');
var playerDashboardIndex = isolatedEntry.js.indexOf('playerDashboard.js');
assert.strictEqual(isolatedEntry.js[showdownReducerIndex + 1], 'careerStatsAggregator.js', 'career aggregation follows all finalized statistics reducers');
assert.strictEqual(isolatedEntry.js[careerAggregatorIndex + 1], 'filteredStats.js', 'filtered aggregation follows its exact-counter dependency');
assert.strictEqual(isolatedEntry.js[filteredStatsIndex + 1], 'sessionStatsCache.js', 'the shared Session-stat cache follows its exact filter dependency');
assert.strictEqual(isolatedEntry.js[sessionStatsCacheIndex + 1], 'sessionRuntime.js', 'Session revision and persistence policy follow the cache');
assert.strictEqual(isolatedEntry.js[sessionRuntimeIndex + 1], 'runtimeBounds.js', 'bounded collections follow Session runtime policy');
assert.strictEqual(isolatedEntry.js[runtimeBoundsIndex + 1], 'careerContributionStore.js', 'career contribution storage follows the runtime performance contracts');
  assert.strictEqual(isolatedEntry.js[careerStoreIndex + 1], 'careerIndexedStore.js', 'indexed career persistence follows the Phase 1 migration reader');
  assert.strictEqual(isolatedEntry.js[careerIndexedStoreIndex + 1], 'careerBackupPolicy.js', 'Career Backup size policy follows the service-worker proxy');
  assert.strictEqual(isolatedEntry.js[careerBackupPolicyIndex + 1], 'careerDataSettings.js', 'Career Data presentation follows the shared backup policy');
  assert.strictEqual(isolatedEntry.js[careerDataSettingsIndex + 1], 'statExplanation.js', 'stat explanations follow the additive career UI presenter');
assert.strictEqual(isolatedEntry.js[statExplanationIndex + 1], 'handStatInspector.js', 'Hand Stat Inspector follows its read-only explanation source');
assert.strictEqual(isolatedEntry.js[handStatInspectorIndex + 1], 'playerProfileScoreInspector.js', 'profile score diagnostics follow the existing read-only Hand Stat Inspector');
assert.strictEqual(isolatedEntry.js[profileScoreInspectorIndex + 1], 'playerProfileClassifier.js', 'classifier follows the standalone read-only profile diagnostics presenter');
assert.strictEqual(isolatedEntry.js[profileClassifierIndex + 1], 'playerProfilePresentation.js', 'presentation policy follows its raw classifier dependency');
assert.strictEqual(isolatedEntry.js[profilePresentationIndex + 1], 'playerProfileExplanation.js', 'explanation adapter follows the authoritative classifier and presentation contracts');
assert.strictEqual(isolatedEntry.js[profileExplanationIndex + 1], 'playerProfileShadowStore.js', 'profile store follows the classifier, presentation, and explanation dependencies');
assert.strictEqual(isolatedEntry.js[profileStoreIndex + 1], 'playerProfileCalibration.js', 'calibration helper follows the profile store');
assert.strictEqual(isolatedEntry.js[profileCalibrationIndex + 1], 'playerNotesStore.js', 'stable-ID mutable notes follow profile calibration');
assert.strictEqual(isolatedEntry.js[playerNotesIndex + 1], 'playerDashboard.js', 'dashboard presenter follows notes');
assert.strictEqual(isolatedEntry.js[playerDashboardIndex + 1], 'trackedPlayers.js', 'Tracked Players presentation follows its Dashboard navigation target');
assert.strictEqual(isolatedEntry.js[isolatedEntry.js.indexOf('trackedPlayers.js') + 1], 'overlayStats.js', 'HUD modules resume after Tracked Players presentation');
assert.ok(semanticLedgerIndex < reducerIndex && reducerIndex < flopReducerIndex && flopReducerIndex < showdownReducerIndex && showdownReducerIndex < careerAggregatorIndex && careerAggregatorIndex < sessionStatsCacheIndex && sessionStatsCacheIndex < sessionRuntimeIndex && sessionRuntimeIndex < runtimeBoundsIndex && runtimeBoundsIndex < careerStoreIndex && careerStoreIndex < careerIndexedStoreIndex && careerIndexedStoreIndex < careerBackupPolicyIndex && careerBackupPolicyIndex < careerDataSettingsIndex && careerDataSettingsIndex < statExplanationIndex && statExplanationIndex < handStatInspectorIndex && handStatInspectorIndex < profileScoreInspectorIndex && profileScoreInspectorIndex < profileClassifierIndex && profileClassifierIndex < profilePresentationIndex && profilePresentationIndex < profileExplanationIndex && profileExplanationIndex < profileStoreIndex && profileStoreIndex < profileCalibrationIndex && profileCalibrationIndex < isolatedEntry.js.indexOf('content.js'), 'ledger, reducers, performance runtime, career persistence, backup policy and UI, explanations, inspectors, and profile modules register before content startup validation');

function fakeDocument() {
  var elements = new Map();
  var body = { appendChild: function (element) { element.parentElement = body; element.isConnected = true; elements.set(element.id, element); return element; } };
  return {
    body: body,
    documentElement: body,
    getElementById: function (id) { return elements.get(id) || null; },
    createElement: function (tagName) { return { tagName: String(tagName).toUpperCase(), id: '', textContent: '', dataset: {}, style: {}, parentElement: null, isConnected: false }; },
    addEventListener: function () {},
    dispatchEvent: function () {}
  };
}

var isolatedLogs = [];
var isolated = {
  location: exactLocation,
  document: fakeDocument(),
  console: {
    log: function () { isolatedLogs.push(Array.prototype.slice.call(arguments)); },
    error: function () { isolatedLogs.push(Array.prototype.slice.call(arguments)); }
  },
  chrome: {
    storage: {
      local: { get: function () {}, set: function () {} },
      onChanged: { addListener: function () {}, removeListener: function () {} }
    }
  },
  setTimeout: function () {},
  clearTimeout: function () {},
  setInterval: function () {},
  clearInterval: function () {},
  MutationObserver: function () {},
  ResizeObserver: function () {}
};
isolated.window = isolated;
isolated.globalThis = isolated;
isolated.addEventListener = function () {};
isolated.removeEventListener = function () {};
isolated.postMessage = function () {};

isolatedEntry.js.forEach(function (file, index) {
  if (file === 'content.js') {
    assert.ok(isolated.PokerNowRuntimeScope, 'namespace exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerNowRuntimeScope.isPokerNowGamePage, 'function');
    assert.strictEqual(isolated.PokerNowRuntimeScope.isPokerNowGamePage(exactLocation), true);
    assert.strictEqual(isolated.PokerNowRuntimeScope.isPokerNowGamePage('https://pokernow.com/about'), false);
    assert.ok(isolated.PokerSemanticHandLedger, 'semantic shadow ledger global exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerSemanticHandLedger.createState, 'function');
    assert.strictEqual(typeof isolated.PokerSemanticHandLedger.observe, 'function');
    assert.strictEqual(typeof isolated.PokerSemanticHandLedger.finalize, 'function');
    assert.strictEqual(typeof isolated.PokerSemanticHandLedger.discard, 'function');
    assert.strictEqual(typeof isolated.PokerSemanticHandLedger.inspect, 'function');
    assert.ok(isolated.PokerPreflopOpportunityReducer, 'shadow preflop reducer global exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPreflopOpportunityReducer.createState, 'function');
    assert.strictEqual(typeof isolated.PokerPreflopOpportunityReducer.deriveContribution, 'function');
    assert.strictEqual(typeof isolated.PokerPreflopOpportunityReducer.reduce, 'function');
    assert.strictEqual(typeof isolated.PokerPreflopOpportunityReducer.inspect, 'function');
    assert.ok(isolated.PokerFlopCBetOpportunityReducer, 'shadow flop CBet reducer global exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerFlopCBetOpportunityReducer.createState, 'function');
    assert.strictEqual(typeof isolated.PokerFlopCBetOpportunityReducer.deriveContribution, 'function');
    assert.strictEqual(typeof isolated.PokerFlopCBetOpportunityReducer.reduce, 'function');
    assert.strictEqual(typeof isolated.PokerFlopCBetOpportunityReducer.attach, 'function');
    assert.strictEqual(typeof isolated.PokerFlopCBetOpportunityReducer.inspect, 'function');
    assert.ok(isolated.PokerShowdownStatsReducer, 'shadow showdown reducer global exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerShowdownStatsReducer.createState, 'function');
    assert.strictEqual(typeof isolated.PokerShowdownStatsReducer.deriveContribution, 'function');
    assert.strictEqual(typeof isolated.PokerShowdownStatsReducer.reduce, 'function');
    assert.strictEqual(typeof isolated.PokerShowdownStatsReducer.attach, 'function');
    assert.strictEqual(typeof isolated.PokerShowdownStatsReducer.inspect, 'function');
    assert.ok(isolated.PokerPlayerProfileClassifier, 'profile classifier exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPlayerProfileClassifier.classify, 'function');
    assert.ok(isolated.PokerPlayerProfilePresentation, 'profile presentation policy exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPlayerProfilePresentation.resolveDisplayedProfile, 'function');
    assert.ok(isolated.PokerPlayerProfileExplanation, 'profile explanation adapter exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPlayerProfileExplanation.explain, 'function');
    assert.ok(isolated.PokerPlayerProfileShadowStore, 'profile shadow store exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPlayerProfileShadowStore.createState, 'function');
    assert.strictEqual(typeof isolated.PokerPlayerProfileShadowStore.update, 'function');
    assert.ok(isolated.PokerPlayerProfileCalibration, 'profile calibration helper exists before content.js executes');
    assert.strictEqual(typeof isolated.PokerPlayerProfileCalibration.discoverSessions, 'function');
  }
  vm.runInNewContext(fs.readFileSync('./' + file, 'utf8'), isolated, { filename: file });
  if (index === 0) assert.ok(isolatedLogs.some(function (call) { return call[0] === '[HUD RUNTIME SCOPE] helper installed'; }));
});
assert.ok(isolatedLogs.some(function (call) { return call[0] === '[HUD UI BOOT 2] runtime guard passed'; }), 'manifest-order isolated execution reaches Boot 2');
assert.ok(isolatedLogs.some(function (call) {
  return call[0] === '[HUD UI BOOT 1.4] required modules checked' && call[1] && call[1].available === true;
}), 'manifest-order startup passes stage 1.4 with the semantic ledger and shadow preflop reducer registered');
assert.ok(isolated.PokerNowHUDProfiles, 'isolated content world exposes the profile debug API after content startup');
assert.strictEqual(typeof isolated.PokerNowHUDProfiles.summary, 'function');
assert.strictEqual(typeof isolated.PokerNowHUDProfiles.explainPlayerProfile, 'function');
assert.ok(
  isolatedLogs.findIndex(function (call) { return call[0] === '[HUD RUNTIME SCOPE] helper installed'; }) <
    isolatedLogs.findIndex(function (call) { return call[0] === '[HUD UI BOOT 1] content script loaded'; }),
  'helper installation log precedes content Boot 1'
);

var fallbackLogs = [];
var fallback = {
  location: exactLocation,
  document: fakeDocument(),
  console: {
    log: function () { fallbackLogs.push(Array.prototype.slice.call(arguments)); },
    error: function () { fallbackLogs.push(Array.prototype.slice.call(arguments)); },
    warn: function () { fallbackLogs.push(Array.prototype.slice.call(arguments)); }
  },
  chrome: {
    storage: {
      local: { get: function () {}, set: function () {} },
      onChanged: { addListener: function () {}, removeListener: function () {} }
    }
  },
  setTimeout: function () {}, clearTimeout: function () {}, setInterval: function () {}, clearInterval: function () {},
  MutationObserver: function () {}, ResizeObserver: function () {}
};
fallback.window = fallback;
fallback.globalThis = fallback;
fallback.addEventListener = function () {};
fallback.removeEventListener = function () {};
fallback.postMessage = function () {};
isolatedEntry.js.filter(function (file) { return file !== 'runtimeScope.js'; }).forEach(function (file) {
  vm.runInNewContext(fs.readFileSync('./' + file, 'utf8'), fallback, { filename: file });
});
assert.ok(fallbackLogs.some(function (call) { return call[0] === '[HUD PACKAGING DIAGNOSTIC] runtimeScope.js did not install globalThis.PokerNowRuntimeScope before content.js; clean local guard active'; }));
assert.ok(fallbackLogs.some(function (call) { return call[0] === '[HUD UI BOOT 2] runtime guard passed' && call[1].fallbackActive === true; }), 'missing helper falls back and passes Boot 2');
assert.ok(fallbackLogs.some(function (call) { return call[0] === '[HUD UI BOOT 3] UI initialization started'; }), 'missing helper no longer aborts UI initialization');
var fallbackBadge = fallback.document.getElementById('pnhud-bootstrap-badge');
assert.ok(fallbackBadge && fallbackBadge.dataset.pnhudBootFailure !== 'true', 'valid local fallback startup does not leave a persistent red warning');

class NativeWebSocket {
  addEventListener() {}
  send() {}
}
NativeWebSocket.CONNECTING = 0;
NativeWebSocket.OPEN = 1;
NativeWebSocket.CLOSING = 2;
NativeWebSocket.CLOSED = 3;
var mainLogs = [];
var main = {
  location: exactLocation,
  document: fakeDocument(),
  console: { log: function () { mainLogs.push(Array.prototype.slice.call(arguments)); } },
  history: { pushState: function () {}, replaceState: function () {} },
  WebSocket: NativeWebSocket,
  CustomEvent: function (name) { this.type = name; },
  setTimeout: function () {},
  addEventListener: function () {},
  removeEventListener: function () {},
  postMessage: function () {}
};
main.window = main;
main.globalThis = main;
mainEntry.js.forEach(function (file) { vm.runInNewContext(fs.readFileSync('./' + file, 'utf8'), main, { filename: file }); });
assert.ok(main.PokerNowRuntimeScope, 'MAIN world receives its own explicitly injected runtime scope');
assert.ok(main.PokerNowHUDDebug, 'MAIN world exposes the page-console showdown diagnostic API');
assert.strictEqual(main.PokerNowHUDProfiles, undefined, 'ordinary page/MAIN console does not receive the isolated profile API');
assert.strictEqual(typeof main.PokerNowHUDDebug.exportShowdownDiagnostics, 'function');
assert.strictEqual(typeof main.PokerNowHUDDebug.latestShowdownDiagnostic, 'function');
assert.strictEqual(typeof main.PokerNowHUDDebug.clearShowdownDiagnostics, 'function');
assert.notStrictEqual(main.PokerNowRuntimeScope, isolated.PokerNowRuntimeScope, 'MAIN hook does not depend on the isolated-world global object');
assert.strictEqual(main.__POKERNOW_HUD_WEBSOCKET_HOOKED__, true, 'MAIN hook initializes from its own world-local contract');

console.log('Manifest-order isolated and MAIN-world runtime-scope contract tests passed.');
