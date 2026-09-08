'use strict';

var assert = require('assert');
var diagnostics = require('./hudDiagnostics.js');

assert.strictEqual(diagnostics.requiredLevel('[HUD HAND SOURCE TRACE]'), 'deep', 'per-frame/source tracing is explicit deep diagnostics');
assert.strictEqual(diagnostics.requiredLevel('[HUD FIRST HAND TRACE]'), 'deep', 'per-hand lifecycle tracing is explicit deep diagnostics');
assert.strictEqual(diagnostics.requiredLevel('[HUD HAND COMMIT TRACE]'), 'deep', 'commit trace details are explicit deep diagnostics');
assert.strictEqual(diagnostics.requiredLevel('[HUD STATS] rendered counters'), 'deep', 'per-player counter tracing is explicit deep diagnostics');
assert.strictEqual(diagnostics.requiredLevel('[HUD BUILD] content candidate'), 'basic', 'build/version remains in default diagnostics');

var calls = [];
var gated = diagnostics.createConsole({ log: function () { calls.push(Array.from(arguments)); }, warn: function () { calls.push(Array.from(arguments)); }, error: function () { calls.push(Array.from(arguments)); } });
diagnostics.setLevel('basic');
gated.log('[HUD HAND SOURCE TRACE]', {});
gated.log('[HUD HAND FINALIZE] hand committed', {});
gated.error('[HUD STATS INVARIANT] counter regression', {});
assert.deepStrictEqual(calls.map(function (entry) { return entry[0]; }), ['[HUD STATS INVARIANT] counter regression'], 'default mode suppresses noisy hand traces but preserves invariant errors');

console.log('Default versus explicit-deep diagnostic policy passed.');
