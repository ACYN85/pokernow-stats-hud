'use strict';

var assert = require('assert');
var diagnostics = require('./hudDiagnostics.js');

var calls = [];
var nativeConsole = {
  log: function () { calls.push(['log'].concat(Array.from(arguments))); },
  debug: function () { calls.push(['debug'].concat(Array.from(arguments))); },
  warn: function () { calls.push(['warn'].concat(Array.from(arguments))); },
  error: function () { calls.push(['error'].concat(Array.from(arguments))); }
};
var gated = diagnostics.createConsole(nativeConsole);

diagnostics.setLevel('basic');
gated.log('[HUD PIPELINE 2] frame relayed', { frameId: 1 });
gated.log('[HUD WALK TRACE]', { handId: 'walk-1' });
gated.log('[HUD HAND FINALIZE] hand committed', { handId: 'h1' });
gated.log('[HUD BUILD] content candidate', { buildId: 'candidate' });
assert.deepStrictEqual(calls.map(function (entry) { return entry[1]; }), ['[HUD BUILD] content candidate'], 'basic mode suppresses per-hand and transport detail while retaining startup/build signals');

calls.length = 0;
diagnostics.setLevel('deep');
gated.log('[HUD TB TRACE] raw', { tB: {} });
gated.log('[HUD WALK TRACE]', { handId: 'walk-1' });
gated.debug('[HUD SEAT ANCHOR] candidate', {});
assert.strictEqual(calls.length, 3, 'deep mode preserves existing detailed diagnostics and live walk tracing');

calls.length = 0;
diagnostics.setLevel('off');
gated.log('[HUD HAND FINALIZE] hand committed', {});
gated.warn('warning');
gated.error('[HUD] initialization error', new Error('test'));
assert.deepStrictEqual(calls.map(function (entry) { return entry[0]; }), ['error'], 'off mode emits errors only');

assert.strictEqual(diagnostics.setLevel('unsupported'), 'basic', 'invalid values safely normalize to basic');
console.log('HUD diagnostics off/basic/deep gating tests passed.');
