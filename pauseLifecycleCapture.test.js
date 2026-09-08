'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var capture = require('./pauseLifecycleCapture.js');

var state = capture.createState({
  buildId: 'pause-capture-test',
  contentScriptInstanceId: 'content-1',
  runtimeStatusStoreInstanceId: 'store-1',
  hudRendererInstanceId: 'renderer-1',
  createdAt: 1
});
assert.strictEqual(state.enabled, false, 'raw lifecycle capture is disabled by default');
assert.strictEqual(capture.recordFrame(state, { rawFrame: '42["gC",{"status":"inProgress"}]' }), null, 'disabled capture retains no traffic');

capture.setEnabled(state, true, 2);
capture.setHookInstance(state, 'hook-1');
var active = capture.recordFrame(state, {
  frameId: 'ws-active',
  timestamp: 3,
  transportDirection: 'incoming',
  engineIoPacketType: 'message',
  socketIoPacketType: 'event',
  namespace: '/table',
  eventName: 'gC',
  decodedSuccessfully: true,
  decodedArgumentList: ['gC', { status: 'inProgress', players: { P1: { stack: 100 } } }],
  rawFrame: '42/table,["gC",{"status":"inProgress"}]',
  websocketHookInstanceId: 'hook-1'
});
capture.completeFrame(state, active, {
  decodedArgumentList: ['gC', { status: 'inProgress' }],
  recognizerMatched: false,
  previousPersistedPauseState: null,
  nextPersistedPauseState: null,
  runtimeStatusInputsAfterProcessing: { tableStatus: 'inProgress' },
  selectedStatus: 'live',
  renderedBadgeText: 'Live',
  renderedFooterText: 'PokerNow game is actively running'
});
assert.strictEqual(active.namespace, '/table');
assert.deepStrictEqual(active.instances, {
  contentScriptInstanceId: 'content-1',
  websocketHookInstanceId: 'hook-1',
  runtimeStatusStoreInstanceId: 'store-1',
  hudRendererInstanceId: 'renderer-1'
});

var pause = capture.recordFrame(state, {
  frameId: 'ws-pause',
  timestamp: 4,
  transportDirection: 'incoming',
  engineIoPacketType: 'message',
  socketIoPacketType: 'event',
  namespace: '/',
  eventName: 'unknown-minified-event',
  decodedSuccessfully: true,
  decodedArgumentList: ['unknown-minified-event', { x: 'pause-state-value-not-yet-mapped' }],
  rawFrame: '42["unknown-minified-event",{"x":"pause-state-value-not-yet-mapped"}]'
});
capture.completeFrame(state, pause, {
  recognizerMatched: false,
  previousPersistedPauseState: null,
  nextPersistedPauseState: null,
  persistenceReason: 'no current recognizer matched',
  selectedStatus: 'live',
  renderedBadgeText: 'Live'
});
assert.strictEqual(state.counters.rawPauseLikePacketsObserved, 1);
assert.ok(state.warnings.some(function (entry) { return entry.code === 'pause-like-unrecognized'; }));

var recognized = capture.recordFrame(state, {
  frameId: 'ws-recognized-pause',
  timestamp: 5,
  transportDirection: 'outgoing',
  engineIoPacketType: 'message',
  socketIoPacketType: 'event',
  namespace: '/',
  eventName: 'control',
  decodedSuccessfully: true,
  decodedArgumentList: ['control', { command: 'pause' }],
  rawFrame: '42["control",{"command":"pause"}]'
});
capture.recordRuntimeRecalculation(state, {
  timestamp: 5,
  eventType: 'verified pause fixture',
  previousPersistedPauseState: null,
  nextPersistedPauseState: 'paused',
  previousRuntimeStatus: 'live',
  nextRuntimeStatus: 'live-socket',
  reason: 'verified pause'
});
capture.completeFrame(state, recognized, {
  recognizerMatched: true,
  recognizerBranch: 'pause',
  normalizedLifecycleSignal: { classification: 'paused', confidence: 'authoritative' },
  previousPersistedPauseState: null,
  nextPersistedPauseState: 'paused',
  persistenceReason: 'verified fixture',
  selectedStatus: 'live-socket',
  renderedBadgeText: 'Paused',
  renderedFooterText: 'game paused'
});
assert.strictEqual(state.counters.recognizedPauseSignals, 1);
assert.strictEqual(state.counters.persistedPauseStateWrites, 1);

capture.recordRender(state, {
  timestamp: 6,
  selectedStatus: 'live-socket',
  expectedBadgeText: 'Paused',
  actualBadgeText: 'Live',
  runtimeStatusStoreInstanceId: 'store-1',
  hudRendererInstanceId: 'renderer-1'
});
assert.ok(state.warnings.some(function (entry) { return entry.code === 'stale-badge-render'; }));

capture.recordRuntimeRecalculation(state, {
  timestamp: 7,
  eventType: 'unverified overwrite fixture',
  previousPersistedPauseState: 'paused',
  nextPersistedPauseState: null,
  verifiedResume: false,
  previousRuntimeStatus: 'live-socket',
  nextRuntimeStatus: 'live',
  reason: 'ordinary traffic'
});
assert.strictEqual(state.counters.pauseStateClears, 1);
assert.ok(state.warnings.some(function (entry) { return entry.code === 'pause-overwritten-without-resume'; }));

var checkpoint = capture.markCheckpoint(state, 'active-before-pause', { selectedStatus: 'live' }, 8);
assert.strictEqual(checkpoint.label, 'active-before-pause');

for (var index = 0; index < 260; index += 1) {
  capture.recordFrame(state, {
    frameId: 'bounded-' + index,
    timestamp: 20 + index,
    transportDirection: 'incoming',
    engineIoPacketType: 'ping',
    decodedSuccessfully: true,
    rawFrame: '2'
  });
}
assert.strictEqual(state.frames.length, 240, 'raw capture remains bounded');
assert.ok(JSON.stringify(capture.snapshot(state)).length < 600000, 'bounded snapshot remains suitable for Copy Diagnostics');

var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
assert.ok(isolated.js.includes('pauseLifecycleCapture.js'));
assert.ok(isolated.js.indexOf('pauseLifecycleCapture.js') < isolated.js.indexOf('content.js'));
var content = fs.readFileSync('./content.js', 'utf8');
var hook = fs.readFileSync('./websocketHook.js', 'utf8');
assert.ok(content.includes("pauseLifecycleCaptureEnabled: 'pokerNowHudPauseLifecycleCaptureEnabled'"));
assert.ok(content.includes('rawPauseLifecycleCapture: PokerPauseLifecycleCapture.snapshot'));
assert.ok(content.includes('contentScriptLoadedAt: contentInitializedAt'));
assert.ok(content.includes('activeContentScriptInstanceCount'));
assert.ok(content.includes('Mark Pause Window'));
assert.ok(content.includes('Mark Resume Window'));
assert.ok(!content.includes('Mark Next Click: Pause'), 'legacy click-dependent marker is removed');
assert.ok(content.includes('Export Pause Capture'));
assert.ok(content.includes('pauseDiagnosticCaptureState')); 
assert.ok(hook.includes('hookInstanceId'));
assert.ok(hook.includes('var capturedAt = Date.now()') && hook.includes('capturedAt: capturedAt'), 'WebSocket diagnostics retain the receipt-time timestamp through ordered Blob decoding');

console.log('Opt-in bounded raw pause lifecycle capture, counters, warnings, instances, and package wiring tests passed.');
