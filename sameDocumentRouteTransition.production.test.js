'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var hookMarker = '  function releaseStartupFramesAfterStorage() {';
var harness = harnessSupport.createHarness({
  gameId: 'table-A',
  transformContentSource: function (source) {
    var injection = "  globalThis.__PNHUD_ROUTE_TEST__ = { change: handleRuntimeLocationChange, cleaned: function () { return extensionCleanedUp; }, namespace: function () { return storageNamespace; } };\n\n";
    assert.ok(source.includes(hookMarker), 'content route test hook insertion point exists');
    return source.replace(hookMarker, injection + hookMarker);
  }
});
assert.deepStrictEqual(harness.evaluationErrors, [], 'production isolated-world scripts boot');
assert.ok(/table-A/.test(harness.context.__PNHUD_ROUTE_TEST__.namespace()), 'the starting namespace belongs to table A');
assert.strictEqual(harness.context.__PNHUD_ROUTE_TEST__.cleaned(), false);
assert.strictEqual(harness.listenerCount('pagehide'), 1, 'one pagehide listener is installed');
harness.navigateToGame('table-B');
harness.context.__PNHUD_ROUTE_TEST__.change();
assert.strictEqual(harness.context.__PNHUD_ROUTE_TEST__.cleaned(), true, 'same-document A→B navigation fails closed');
assert.strictEqual(Object.keys(harness.context.__PNHUD_ACTIVE_CONTENT_INSTANCES__).length, 0, 'the old table-scoped content instance is retired');
assert.strictEqual(harness.listenerCount('message'), 0, 'the old table bridge cannot accept frames after navigation');
assert.strictEqual(harness.listenerCount('popstate'), 0);
assert.strictEqual(harness.listenerCount('hashchange'), 0);
assert.strictEqual(harness.listenerCount('pagehide'), 0, 'pagehide closure is removed during cleanup');
assert.strictEqual(harness.documentListenerCount('pokernow-hud-location-change'), 0);
var badge = harness.context.document.getElementById('pnhud-bootstrap-badge');
assert.ok(badge && /reload/i.test(badge.textContent), 'the fail-closed state explicitly tells the user to reload table B');
var cleanupLogs = harness.logs.filter(function (entry) { return entry[0] === '[HUD] runtime cleaned up'; }).length;
harness.context.__PNHUD_ROUTE_TEST__.change();
assert.strictEqual(harness.logs.filter(function (entry) { return entry[0] === '[HUD] runtime cleaned up'; }).length, cleanupLogs, 'duplicate cleanup is idempotent');
console.log('Same-document PokerNow game-ID transition and listener cleanup regressions passed.');
