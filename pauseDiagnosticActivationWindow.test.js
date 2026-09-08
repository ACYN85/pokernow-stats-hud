'use strict';

var assert = require('assert');
var fs = require('fs');
var capture = require('./pauseDiagnosticCapture.js');
var hostTrace = require('./hostControlTrace.js');
var fixture = require('./fixtures/pauseResumeManualSequence.json');

assert.deepStrictEqual(fixture.sequence.map(function (item) { return item.direction === 'incoming' ? item.eventName : JSON.parse(item.raw.slice(2))[1].type; }), ['UP', 'gC', 'ATB', 'UR', 'gC', 'ATB', 'gC'], 'fixture preserves the exact supplied relevant order without inventing omitted gC payloads');
assert.strictEqual(fixture.absoluteTimestampsAvailable, false, 'evidence limits are explicit');
var up = hostTrace.classify(hostTrace.sanitize({ type: 'UP' }).primitiveCommandFields);
var ur = hostTrace.classify(hostTrace.sanitize({ type: 'UR' }).primitiveCommandFields);
var atb = hostTrace.classify(hostTrace.sanitize({ type: 'ATB' }).primitiveCommandFields);
assert.strictEqual(up.appearsTableControl, false, 'UP is not promoted to a production lifecycle control');
assert.strictEqual(ur.appearsTableControl, false, 'UR is not promoted to a production lifecycle control');
assert.strictEqual(atb.appearsTableControl, false, 'ATB remains nonspecific poker-action traffic');
assert.strictEqual(atb.knownPokerAction, true);

var state = capture.createState({ enabled: true, buildId: 'activation-window-fixture', createdAt: 1 });
var pause = capture.armMarker(state, 'pause', 10000);
fixture.sequence.slice(0, 3).forEach(function (item, index) { capture.recordEntry(state, { timestamp: 10100 + index * 100, api: 'websocket', direction: item.direction, payload: item.raw || ('42["' + item.eventName + '",{}]') }); });
capture.recordActivation(state, pause.checkpointId, 'transport-only', { reason: 'no keyboard or pointer event observed' }, 10100);
capture.completeMarkerWindow(state, pause.checkpointId, 18100);
var resume = capture.armMarker(state, 'resume', 20000);
fixture.sequence.slice(3).forEach(function (item, index) { capture.recordEntry(state, { timestamp: 20100 + index * 100, api: 'websocket', direction: item.direction, payload: item.raw || ('42["' + item.eventName + '",{}]') }); });
capture.recordActivation(state, resume.checkpointId, 'transport-only', { reason: 'no keyboard or pointer event observed' }, 20100);
capture.completeMarkerWindow(state, resume.checkpointId, 28100);
var exported = capture.createExport(state, {}, 29000);
assert.strictEqual(exported.captureValidity.valid, true, 'transport-only windows complete without any click checkpoint');
assert.strictEqual(exported.clickedElements.length, 0);
assert.deepStrictEqual(exported.markerCheckpoints.map(function (item) { return item.activationObserved; }), ['transport-only', 'transport-only']);
assert.ok(exported.candidateTransportFrames.length === 7);
assert.ok(exported.candidateTransportFrames.every(function (entry) { return entry.correlationStartSource === 'marker-armed'; }));

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes('Mark Pause Window') && content.includes('Mark Resume Window'));
assert.ok(content.includes("api: 'keyboard'"), 'keydown/keyup evidence is captured diagnostically');
assert.ok(!/event.(?:key|code)s*===s*['"](?:p|KeyP)['"]/i.test(content), 'no P-key production classification was added');
['pokerNowLifecycleSignal.js', 'handFinalization.js', 'stats.js', 'walkDetection.js', 'hudRuntimeStatus.js'].forEach(function (file) {
  var source = fs.readFileSync('./' + file, 'utf8');
  assert.ok(!source.includes('pause-activation-window-fixture'), file + ' has no diagnostic coupling');
});
console.log('Manual UP/UR/ATB evidence fixture and activation-independent workflow regression tests passed.');
