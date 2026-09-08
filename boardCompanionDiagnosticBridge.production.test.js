'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function activeState() {
  return {
    hI: 'BRIDGE-1', gT: ['holdem', 0], board: [], pot: 120,
    tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  };
}

(async function () {
  var harness = harnessApi.createHarness({ gameId: 'bridge-production', layout: 'live-full', liveCardDom: true, persistentBoardSlot: true, viewport: { width: 1280, height: 665 } });
  harnessApi.dispatchFrame(harness, harnessApi.socket('registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState() }), 'bridge-frame', harness.now());
  harness.runFor(360, 16);
  harness.evaluate("window.__boardBridgeResponse = null; window.addEventListener('message', function (event) { if (event.data && event.data.source === 'pokernow-stats-hud-board-companion-content') window.__boardBridgeResponse = event.data; }); window.postMessage({ source: 'pokernow-stats-hud-board-companion-page', type: 'board-companion-diagnostic-request', requestId: 'fixture-request', method: 'layoutInfo' }, location.origin);");
  var isolatedResponse = JSON.parse(harness.evaluate('JSON.stringify(window.__boardBridgeResponse)'));
  assert.strictEqual(isolatedResponse.ok, true, 'isolated production endpoint answers the whitelisted read-only request');
  assert.ok(isolatedResponse.value.canonicalBoardRect && isolatedResponse.value.canonicalLeftCompanionRect);
  ['layoutEpochId', 'tableOwnerSource', 'tableViewportRect', 'tableTransform', 'canonicalBoardLocalRect', 'canonicalBoardViewportRect', 'canonicalLeftCompanionRect', 'canonicalRightCompanionRect', 'featureOffset', 'actualPotOddsRect', 'boardCardCount', 'validationOnlyActualCardRects', 'canonicalGeometryChanged', 'lastAcceptedCanonicalChangeReason', 'settingsVisible'].forEach(function (key) {
    assert.ok(Object.prototype.hasOwnProperty.call(isolatedResponse.value, key), 'page response exposes safe table-local diagnostic field ' + key);
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(isolatedResponse.value, 'tableId'), false, 'page response strips table identity');
  assert.doesNotMatch(JSON.stringify(isolatedResponse), /playerA|playerB|holeCards|chat|token|authorization/i, 'page response excludes private gameplay/identity data');

  var listeners = [];
  var posted = [];
  var page = {
    location: { origin: 'https://pokernow.com' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage: function (message) { posted.push(message); }
  };
  page.window = page; page.self = page; page.globalThis = page;
  var context = vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'boardCompanionDiagnosticBridge.js'), 'utf8'), context, { filename: 'boardCompanionDiagnosticBridge.js' });
  var contextWindow = vm.runInContext('window', context);
  var api = page.PokerNowHUDBoardCompanion;
  assert.ok(api && Object.isFrozen(api), 'ordinary page world receives a frozen diagnostic API');
  assert.deepStrictEqual(Object.keys(api).sort(), ['captureLayoutSnapshot', 'eventHistory', 'layoutInfo']);
  assert.strictEqual(Object.keys(api).some(function (key) { return /set|write|reset|drag/i.test(key); }), false, 'page API exposes no mutations');
  var promise = api.layoutInfo();
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].source, 'pokernow-stats-hud-board-companion-page');
  assert.strictEqual(posted[0].method, 'layoutInfo');
  listeners.forEach(function (listener) {
    listener({ source: contextWindow, origin: page.location.origin, data: { source: 'pokernow-stats-hud-board-companion-content', type: 'board-companion-diagnostic-response', requestId: posted[0].requestId, method: 'layoutInfo', ok: true, value: isolatedResponse.value } });
  });
  var bridged = await promise;
  assert.deepStrictEqual(bridged.canonicalBoardRect, isolatedResponse.value.canonicalBoardRect, 'ordinary DevTools async call receives the real isolated-world geometry');
  assert.deepStrictEqual(bridged.canonicalBoardLocalRect, isolatedResponse.value.canonicalBoardLocalRect, 'ordinary DevTools receives the immutable-within-epoch table-local model');
  assert.strictEqual(bridged.layoutEpochId, isolatedResponse.value.layoutEpochId, 'ordinary DevTools receives the authoritative epoch ID');

  assert.deepStrictEqual(harness.evaluationErrors, []);
  console.log('BoardCompanion read-only page-world diagnostic bridge production regressions passed.');
})().catch(function (error) {
  console.error(error && (error.stack || error));
  process.exitCode = 1;
});
