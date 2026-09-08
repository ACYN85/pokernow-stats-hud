'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var messages = [];
var harness = harnessSupport.createHarness({
  gameId: 'career-init-delayed',
  runtimeSendMessage: function (message) { messages.push(message); /* deliberately unresolved */ },
  transformContentSource: function (source) {
    source = source.replace('function releaseStartupFramesAfterStorage() {', 'function releaseStartupFramesAfterStorage() { globalThis.__PNHUD_TEST_STARTUP_RELEASES__ = Number(globalThis.__PNHUD_TEST_STARTUP_RELEASES__ || 0) + 1;');
    return source;
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);
assert.ok(messages.some(function (message) { return message.method === 'initialize'; }), 'Career initialization was requested');
assert.strictEqual(harness.evaluateInIsolatedWorld('Number(__PNHUD_TEST_STARTUP_RELEASES__ || 0)'), 1, 'live session frame release does not wait for delayed Career initialization');

console.log('Production session startup is decoupled from delayed Career service initialization.');
