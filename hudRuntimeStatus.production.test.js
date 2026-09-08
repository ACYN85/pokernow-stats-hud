'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var runtimeSource = fs.readFileSync('./hudRuntimeStatus.js', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });

assert.ok(isolated.js.includes('hudRuntimeStatus.js'));
assert.ok(isolated.js.indexOf('gameBreakLifecycle.js') < isolated.js.indexOf('hudRuntimeStatus.js'));
assert.ok(isolated.js.indexOf('hudRuntimeStatus.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("['PokerHudRuntimeStatus', globalThis.PokerHudRuntimeStatus, 'hudRuntimeStatus.js']"));
assert.ok(content.includes('var hudRuntimeStatusState = PokerHudRuntimeStatus.createState'));
assert.ok(content.includes('tableClassification: gameBreakSnapshotTrace.classification'));
assert.ok(content.includes('freshGameState: true'));
assert.ok(content.includes("runtimeStatus === 'live'"));
assert.ok(content.includes("runtimeStatus === 'live-socket'"));
assert.ok(content.includes('return PokerHudRuntimeStatus.presentation(status)'));
assert.ok(!/var liveSource = websocketLive \?/.test(content), 'legacy event flag no longer owns the badge');
assert.ok(content.includes('updateHudRuntimeStatusDisplay(result.reason)'), 'status transitions target the existing badge');
assert.ok(content.includes('hudRuntimeStatus: Object.assign(PokerHudRuntimeStatus.snapshot'), 'Copy Diagnostics owns a runtime-status snapshot');
assert.strictEqual((content.match(/window\.addEventListener\('message', handlePageBridgeMessage\)/g) || []).length, 1, 'no duplicate socket/status listener');
assert.strictEqual((content.match(/class="pnhud-status-area"/g) || []).length, 2, 'bootstrap and production render each own one badge container');
assert.ok(/\.pnhud-demo\s*\{[^}]*white-space:\s*nowrap;/s.test(css), 'Small HUD no-wrap polish is preserved');
assert.ok(/\.pnhud-size-small \.pnhud-status-area\s*\{[^}]*flex-wrap:\s*nowrap;/s.test(css));
assert.ok(content.includes("transport.engineIoPacketType === 'close'"));
assert.ok(content.includes("transport.engineIoPacketType === 'open'"));
assert.ok(!runtimeSource.includes('setInterval') && !runtimeSource.includes('setTimeout'), 'runtime status introduces no polling or timeout masking');

console.log('Production HUD runtime-status ownership, targeted rendering, diagnostics, and Small layout tests passed.');
