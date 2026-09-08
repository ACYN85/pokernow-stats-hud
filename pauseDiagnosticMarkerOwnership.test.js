'use strict';

var assert = require('assert');
var fs = require('fs');
var capture = require('./pauseDiagnosticCapture.js');
function element(options) { options = options || {}; return { nodeType: 1, nodeName: options.nodeName || 'BUTTON', tagName: options.nodeName || 'BUTTON', id: options.id || '', classList: options.classes || [], dataset: options.dataset || {}, parentNode: options.parent || null, parentElement: options.parent || null, getAttribute: function (name) { return name === 'data-pnhud-owned' && options.ownedAttribute ? 'true' : null; } }; }
function event(target, path, trusted) { return { target: target, isTrusted: trusted !== false, composedPath: function () { return path || [target]; } }; }
var sentinel = { hands: 4, lifecycleEpoch: 12, walkCount: 1, runtimeStatus: 'live' };
var before = JSON.stringify(sentinel);
var state = capture.createState({ enabled: true, buildId: 'ownership-window', createdAt: 1 });
var pause = capture.armMarker(state, 'pause', 1000);
var extensionButton = element({ classes: ['pnhud-export-pause-capture'] });
var extensionEvent = event(extensionButton);
var extensionOwnership = capture.extensionUiOwnership(extensionEvent);
assert.strictEqual(extensionOwnership.owned, true);
assert.strictEqual(capture.consumeNextClick(state, { trusted: true, extensionOwned: true, visibleText: 'Export Pause Capture' }, 1100), null);
assert.strictEqual(state.pendingMarker.checkpointId, pause.checkpointId, 'extension UI cannot consume a marker-armed window');
var shadowHost = element({ classes: ['pnhud-extension-owned'] });
var shadowRoot = { nodeName: '#document-fragment', host: shadowHost };
assert.strictEqual(capture.extensionUiOwnership(event(element({ nodeName: 'SPAN' }), [element({ nodeName: 'SPAN' }), shadowRoot, shadowHost])).owned, true, 'shadow-host ownership remains detected');
var indicator = element({ id: 'pnhud-pause-marker-indicator', ownedAttribute: true });
assert.strictEqual(capture.extensionUiOwnership(event(indicator)).owned, true, 'active indicator remains extension-owned');
var page = element({ classes: ['table-control'] });
var pageOwnership = capture.extensionUiOwnership(event(page));
var context = capture.consumeNextClick(state, { trusted: true, extensionOwned: pageOwnership.owned, visibleText: 'Pause' }, 1200);
assert.strictEqual(context.activationOnly, true);
assert.strictEqual(state.pendingMarker.checkpointId, pause.checkpointId, 'page click supplies pointer context but is not required and does not complete the window');
assert.strictEqual(pause.activationObserved, 'pointer');
var canceled = capture.cancelMarker(state, 'escape-key', 1300);
assert.strictEqual(canceled.status, 'canceled');
assert.strictEqual(state.pendingMarker, null, 'Escape cancellation clears the active marker');
assert.strictEqual(capture.captureValidity(state).valid, false, 'canceled/incomplete windows are not valid exports');
var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes("setSettingsOpen(false, 'pause-diagnostic-marker-armed')"), 'arming automatically closes settings');
assert.ok(content.includes("cancelPauseDiagnosticMarker('escape-key')"), 'Escape cancels');
assert.ok(content.includes('capturePauseDiagnosticKeyEvent'), 'keyboard activation context is captured');
assert.ok(content.includes("event.key === 'Escape'"), 'Escape is excluded from activation evidence before cancellation');
assert.strictEqual(JSON.stringify(sentinel), before, 'ownership and activation context do not mutate production state');
console.log('Marker-window ownership context and cancellation tests passed.');
