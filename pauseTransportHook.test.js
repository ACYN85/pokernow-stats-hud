'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

function FakeEventTarget() { this.listeners = {}; }
FakeEventTarget.prototype.addEventListener = function (type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); };
FakeEventTarget.prototype.removeEventListener = function (type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(function (item) { return item !== listener; }); };
FakeEventTarget.prototype.dispatchEvent = function (event) { event.target = event.target || this; (this.listeners[event.type] || []).slice().forEach(function (listener) { listener.call(this, event); }, this); return !event.defaultPrevented; };

function FakeWebSocket(url, protocols) { FakeEventTarget.call(this); this.url = url; this.protocols = protocols; this.sent = []; }
FakeWebSocket.prototype = Object.create(FakeEventTarget.prototype);
FakeWebSocket.prototype.constructor = FakeWebSocket;
FakeWebSocket.prototype.send = function (data) { this.sent.push(data); };
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;

function FakeXhr() { FakeEventTarget.call(this); this.status = 200; this.responseURL = 'https://example.test/xhr-response'; this.responseType = ''; this.responseText = '{"ok":true}'; }
FakeXhr.prototype = Object.create(FakeEventTarget.prototype);
FakeXhr.prototype.constructor = FakeXhr;
FakeXhr.prototype.open = function (method, url) { this.nativeOpen = { method: method, url: url }; };
FakeXhr.prototype.send = function (body) { this.nativeBody = body; this.dispatchEvent({ type: 'loadend' }); };

var bridged = [];
var win = new FakeEventTarget();
win.window = win;
win.globalThis = win;
win.location = { protocol: 'https:', hostname: 'pokernow.com', pathname: '/games/runtime-test', origin: 'https://pokernow.com' };
win.PokerNowRuntimeScope = { buildId: 'hook-runtime-test-20260726-2200', isPokerNowGamePage: function () { return true; } };
win.WebSocket = FakeWebSocket;
win.XMLHttpRequest = FakeXhr;
win.EventTarget = FakeEventTarget;
win.navigator = { sendBeacon: function () { return true; } };
var nativeBeacon = win.navigator.sendBeacon;
win.fetch = function (input) { return Promise.resolve({ url: String(input), status: 204, type: 'basic', redirected: false }); };
var nativeFetch = win.fetch;
win.bridged = bridged;
win.postMessage = function () {};
var context = vm.createContext(win);
vm.runInContext("window.postMessage = function (data) { bridged.push(data); window.dispatchEvent({ type: 'message', source: window, origin: window.location.origin, data: data }); };", context);
var nativePost = win.postMessage;
win.history = { pushState: function () {}, replaceState: function () {} };
win.document = new FakeEventTarget();
win.document.nodeName = '#document';
win.console = { log: function () {}, warn: function () {}, error: function () {} };
win.CustomEvent = function (type, options) { this.type = type; this.detail = options && options.detail; };
win.TextDecoder = TextDecoder;
win.Blob = Blob;
win.ArrayBuffer = ArrayBuffer;
win.URL = URL;
win.Promise = Promise;
win.setTimeout = function (fn) { fn(); return 1; };

vm.runInContext(fs.readFileSync('./pauseDiagnosticCaptureMain.js', 'utf8'), context, { filename: 'pauseDiagnosticCapture.js' });
vm.runInContext(fs.readFileSync('./websocketHook.js', 'utf8'), context, { filename: 'websocketHook.js' });
assert.notStrictEqual(win.WebSocket, FakeWebSocket, 'document-start WebSocket hook installs');
var first = new win.WebSocket('wss://example.test/socket?token=private', ['socket.io']);
win.postMessage({ source: 'pokernow-stats-hud-content', type: 'pause-diagnostic-capture-mode', enabled: true }, win.location.origin);
assert.notStrictEqual(win.fetch, nativeFetch, 'fetch wrapper installs only after opt-in');
assert.notStrictEqual(win.navigator.sendBeacon, nativeBeacon, 'beacon wrapper installs only after opt-in');
var second = new win.WebSocket('wss://example.test/socket-two');
first.dispatchEvent({ type: 'open' });
first.send('42["control",{"command":"pause"}]');
first.dispatchEvent({ type: 'message', data: '42["gC",{"status":"running"}]' });
second.dispatchEvent({ type: 'message', data: '42["other",{"value":1}]' });
win.fetch('https://example.test/fetch', { method: 'POST', body: '{"value":1}' });
var xhr = new win.XMLHttpRequest(); xhr.open('POST', 'https://example.test/xhr'); xhr.send('{"value":2}');
win.navigator.sendBeacon('https://example.test/beacon', '{"value":3}');
win.postMessage({ app: 'page', command: 'candidate' }, '*');
win.document.dispatchEvent(new win.CustomEvent('game-state-change', { detail: { paused: true } }));
var socketIds = bridged.filter(function (item) { return item.type === 'pause-diagnostic-socket'; }).map(function (item) { return item.socket.socketId; });
assert.ok(socketIds.includes('pnhud-ws-1') && socketIds.includes('pnhud-ws-2'), 'every WebSocket keeps a distinct stable identity');
var events = bridged.filter(function (item) { return item.type === 'pause-diagnostic-event'; }).map(function (item) { return item.entry; });
['websocket', 'fetch', 'xhr', 'sendBeacon', 'postMessage', 'custom-event'].forEach(function (api) { assert.ok(events.some(function (entry) { return entry.api === api; }), api + ' wrapper emits bounded diagnostic evidence'); });
assert.ok(events.some(function (entry) { return entry.api === 'websocket' && entry.direction === 'outgoing'; }), 'WebSocket.send is captured');
assert.ok(events.some(function (entry) { return entry.api === 'websocket' && entry.direction === 'incoming'; }), 'WebSocket message is captured');
assert.ok(bridged.filter(function (item) { return item.type === 'websocket-frame'; }).length >= 3, 'production WebSocket frame relay remains active');
assert.ok(!JSON.stringify(events).includes('private'), 'runtime bridge redacts secret query values');
var beforeDisableCount = events.length;
win.postMessage({ source: 'pokernow-stats-hud-content', type: 'pause-diagnostic-capture-mode', enabled: false }, win.location.origin);
assert.strictEqual(win.fetch, nativeFetch, 'fetch identity is restored when diagnostics are disabled');
assert.strictEqual(win.navigator.sendBeacon, nativeBeacon, 'beacon identity is restored when diagnostics are disabled');
assert.strictEqual(win.postMessage, nativePost, 'postMessage identity is restored when diagnostics are disabled');
win.fetch('https://example.test/after-disable');
assert.strictEqual(bridged.filter(function (item) { return item.type === 'pause-diagnostic-event'; }).length, beforeDisableCount, 'disabled diagnostics emit no new transport evidence');
first.send('42["gC",{"status":"still-production"}]');
assert.ok(bridged.filter(function (item) { return item.type === 'websocket-frame'; }).length >= 4, 'disabling diagnostics does not alter production frame relay');

console.log('Opt-in page-world WebSocket/fetch/XHR/beacon/postMessage/CustomEvent hook runtime tests passed.');
