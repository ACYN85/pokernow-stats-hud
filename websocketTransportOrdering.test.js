'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

function FakeEventTarget() { this.listeners = {}; }
FakeEventTarget.prototype.addEventListener = function (type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); };
FakeEventTarget.prototype.removeEventListener = function (type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(function (item) { return item !== listener; }); };
FakeEventTarget.prototype.dispatchEvent = function (event) { (this.listeners[event.type] || []).slice().forEach(function (listener) { listener.call(this, event); }, this); };

function FakeWebSocket(url) { FakeEventTarget.call(this); this.url = url; }
FakeWebSocket.prototype = Object.create(FakeEventTarget.prototype);
FakeWebSocket.prototype.constructor = FakeWebSocket;
FakeWebSocket.prototype.send = function () {};
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;

function createHook() {
  var bridged = [];
  var win = new FakeEventTarget();
  win.window = win; win.globalThis = win;
  win.location = { protocol: 'https:', hostname: 'pokernow.com', pathname: '/games/blob-order', href: 'https://pokernow.com/games/blob-order', origin: 'https://pokernow.com' };
  win.PokerNowRuntimeScope = { buildId: 'blob-order-test', isPokerNowGamePage: function (value) { return /^\/games\/[^/]+\/?$/.test(String(value.pathname || '')); } };
  win.WebSocket = FakeWebSocket;
  win.EventTarget = FakeEventTarget;
  win.XMLHttpRequest = function () {};
  win.XMLHttpRequest.prototype.open = function () {};
  win.XMLHttpRequest.prototype.send = function () {};
  win.navigator = {};
  win.fetch = function () { return Promise.resolve({}); };
  win.postMessage = function (message) { bridged.push(message); };
  win.history = { pushState: function () {}, replaceState: function () {} };
  win.document = new FakeEventTarget();
  win.document.dispatchEvent = function (event) { FakeEventTarget.prototype.dispatchEvent.call(this, event); };
  win.console = { log: function () {}, warn: function () {}, error: function () {} };
  win.CustomEvent = function (type) { this.type = type; };
  win.TextDecoder = TextDecoder; win.Blob = Blob; win.ArrayBuffer = ArrayBuffer; win.Promise = Promise;
  win.setTimeout = function (callback) { callback(); return 1; };
  vm.runInNewContext(fs.readFileSync('./websocketHook.js', 'utf8'), win, { filename: 'websocketHook.js' });
  return { win: win, bridged: bridged, socket: new win.WebSocket('wss://example.test/socket'), NativeWebSocket: FakeWebSocket };
}

function delayedBlob(text, releasePromise) {
  var blob = new Blob([text]);
  var nativeArrayBuffer = blob.arrayBuffer.bind(blob);
  blob.arrayBuffer = function () { return releasePromise.then(nativeArrayBuffer); };
  return blob;
}

function flush() { return new Promise(function (resolve) { setImmediate(resolve); }); }

(async function () {
  var harness = createHook();
  var small = 'small-blob';
  var large = 'large:' + 'x'.repeat(7000);
  var releaseFirst;
  var firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  harness.socket.dispatchEvent({ type: 'message', data: delayedBlob(small, firstGate) });
  harness.socket.dispatchEvent({ type: 'message', data: 'string-after-first-blob' });
  var releaseSecond;
  var secondGate = new Promise(function (resolve) { releaseSecond = resolve; });
  harness.socket.dispatchEvent({ type: 'message', data: delayedBlob(large, secondGate) });
  harness.socket.dispatchEvent({ type: 'message', data: new Blob(['blob-after-large']) });
  assert.deepStrictEqual(harness.bridged.filter(function (item) { return item.type === 'websocket-frame'; }), [], 'later synchronous frames cannot overtake a delayed Blob');
  releaseSecond();
  await flush();
  assert.deepStrictEqual(harness.bridged.filter(function (item) { return item.type === 'websocket-frame'; }), [], 'a later decoded Blob still waits for the first receipt');
  releaseFirst();
  await flush(); await flush(); await flush();
  var frames = harness.bridged.filter(function (item) { return item.type === 'websocket-frame'; });
  assert.deepStrictEqual(frames.map(function (frame) { return frame.data; }), [small, 'string-after-first-blob', large, 'blob-after-large'], 'receipt order is preserved across delayed Blob, string, and Blob frames');
  assert.strictEqual(frames[2].data.length, large.length, 'Blob payloads over 4 KiB are relayed in full');
  assert.strictEqual(frames[2].binaryBytes.length, Buffer.byteLength(large), 'the complete authoritative Blob bytes are relayed');
  assert.deepStrictEqual(frames.map(function (frame) { return frame.frameId; }), ['ws-1', 'ws-2', 'ws-3', 'ws-4'], 'frame IDs encode receipt order');

  var routeHarness = createHook();
  assert.strictEqual((routeHarness.win.listeners.pagehide || []).length, 1, 'MAIN hook installs one pagehide cleanup listener');
  routeHarness.win.location.pathname = '/games/another-table';
  routeHarness.win.location.href = routeHarness.win.location.origin + routeHarness.win.location.pathname;
  routeHarness.win.history.pushState({}, '', routeHarness.win.location.href);
  assert.strictEqual(routeHarness.win.WebSocket, routeHarness.NativeWebSocket, 'same-document game-ID transition retires the old MAIN-world hook');
  assert.strictEqual((routeHarness.win.listeners.pagehide || []).length, 0, 'MAIN cleanup removes its pagehide closure');
  var frameCountAfterCleanup = routeHarness.bridged.filter(function (item) { return item.type === 'websocket-frame'; }).length;
  routeHarness.socket.dispatchEvent({ type: 'message', data: 'old-table-frame-after-route-change' });
  await flush();
  assert.strictEqual(routeHarness.bridged.filter(function (item) { return item.type === 'websocket-frame'; }).length, frameCountAfterCleanup, 'an old socket cannot relay into table B after fail-closed cleanup');
  console.log('WebSocket Blob exactness and receipt-order regressions passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
