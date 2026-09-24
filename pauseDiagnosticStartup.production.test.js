'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
var rootNames = new Set(fs.readdirSync(__dirname));
var isolatedEntry = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
var mainEntry = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; });
assert.ok(isolatedEntry, 'isolated content-script entry exists');
assert.ok(mainEntry, 'MAIN-world transport entry exists');
assert.strictEqual(isolatedEntry.js[0], 'runtimeScope.js');
assert.strictEqual(isolatedEntry.js[1], 'showdownDiagnosticExporter.js', 'bounded showdown diagnostics register immediately after runtime scope');
assert.strictEqual(isolatedEntry.js[2], 'pauseDiagnosticCapture.js', 'isolated pause diagnostic global registers before content consumers');
assert.ok(isolatedEntry.js.indexOf('pauseDiagnosticCapture.js') < isolatedEntry.js.indexOf('content.js'), 'diagnostic module precedes every content.js reference');
assert.strictEqual(mainEntry.js[1], 'showdownDiagnosticExporter.js', 'MAIN world exposes the page-console showdown exporter');
assert.strictEqual(mainEntry.js[2], 'pauseDiagnosticCaptureMain.js', 'MAIN world uses a distinct pause loader filename');
assert.ok(mainEntry.js.indexOf('pauseDiagnosticCaptureMain.js') < mainEntry.js.indexOf('websocketHook.js'));
assert.ok(!mainEntry.js.includes('pauseDiagnosticCapture.js'), 'one physical filename is not shared across execution worlds');
['pauseDiagnosticCapture.js', 'pauseDiagnosticCaptureMain.js'].forEach(function (file) {
  assert.ok(rootNames.has(file), file + ' capitalization matches an exact root filename');
  assert.ok(fs.statSync('./' + file).isFile(), file + ' is packaged as a file');
});
assert.strictEqual(fs.readFileSync('./pauseDiagnosticCaptureMain.js', 'utf8'), fs.readFileSync('./pauseDiagnosticCapture.js', 'utf8'), 'MAIN and isolated capture engines are byte-identical');

var exactLocation = {
  href: 'https://pokernow.com/games/startup-regression',
  protocol: 'https:', hostname: 'pokernow.com', pathname: '/games/startup-regression',
  origin: 'https://pokernow.com', search: '', hash: ''
};
function fakeDocument() {
  var elements = new Map();
  var attributes = new Map();
  var body = {
    appendChild: function (element) { element.parentElement = body; element.isConnected = true; elements.set(element.id, element); return element; },
    setAttribute: function (name, value) { attributes.set(String(name), String(value)); },
    getAttribute: function (name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; }
  };
  return {
    body: body, documentElement: body,
    getElementById: function (id) { return elements.get(id) || null; },
    querySelectorAll: function () { return []; },
    createElement: function (tagName) { return { tagName: String(tagName).toUpperCase(), id: '', textContent: '', dataset: {}, style: {}, parentElement: null, isConnected: false, setAttribute: function () {}, addEventListener: function () {}, remove: function () { this.isConnected = false; } }; },
    addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () {}
  };
}
var logs = [];
var storageWrites = [];
var productionSentinel = { hands: 11, vpip: 0.4, lifecycleEpoch: 7, walkCount: 3 };
var sentinelBefore = JSON.stringify(productionSentinel);
var isolated = {
  location: exactLocation,
  document: fakeDocument(),
  console: {
    log: function () { logs.push(Array.prototype.slice.call(arguments)); },
    warn: function () { logs.push(Array.prototype.slice.call(arguments)); },
    error: function () { logs.push(Array.prototype.slice.call(arguments)); }
  },
  chrome: {
    runtime: { id: 'startup-test-extension', getManifest: function () { return manifest; }, onMessage: { addListener: function () {}, removeListener: function () {} } },
    storage: {
      local: { get: function () {}, set: function (value) { storageWrites.push(value); } },
      onChanged: { addListener: function () {}, removeListener: function () {} }
    }
  },
  setTimeout: function () { return 1; }, clearTimeout: function () {}, setInterval: function () { return 1; }, clearInterval: function () {},
  MutationObserver: function () {}, ResizeObserver: function () {}, Event: function (type) { this.type = type; }, Blob: Blob, URL: URL
};
isolated.window = isolated;
isolated.globalThis = isolated;
isolated.addEventListener = function () {};
isolated.removeEventListener = function () {};
isolated.postMessage = function () {};
var context = vm.createContext(isolated);
var evaluationErrors = [];
isolatedEntry.js.forEach(function (file) {
  if (file === 'content.js') {
    assert.ok(isolated.PokerPauseDiagnosticCapture, 'PokerPauseDiagnosticCapture exists before content.js initializes');
    assert.strictEqual(typeof isolated.PokerPauseDiagnosticCapture.createState, 'function');
  }
  try { vm.runInContext(fs.readFileSync('./' + file, 'utf8'), context, { filename: file }); }
  catch (error) { evaluationErrors.push({ file: file, name: error.name, message: error.message, stack: error.stack }); }
  if (file === 'pauseDiagnosticCapture.js') {
    assert.strictEqual(evaluationErrors.length, 0, 'pauseDiagnosticCapture.js evaluates without an earlier exception');
    assert.strictEqual(isolated.globalThis.PokerPauseDiagnosticCapture, isolated.PokerPauseDiagnosticCapture, 'exact isolated-world global is registered');
  }
});
assert.deepStrictEqual(evaluationErrors, [], 'every packaged isolated script evaluates in exact manifest order');
var dependencyLog = logs.find(function (call) { return call[0] === '[HUD UI BOOT 1.4] required modules checked'; });
assert.ok(dependencyLog, 'stage 1.4 dependency validation runs');
assert.strictEqual(dependencyLog[1].available, true, 'HUD startup passes stage 1.4');
assert.ok(logs.some(function (call) { return call[0] === '[HUD UI BOOT 3] UI initialization started'; }), 'HUD proceeds beyond dependency validation');
assert.ok(!logs.some(function (call) { return call[0] === '[HUD UI BOOT ABORT]' && /PokerPauseDiagnosticCapture/.test(call[1] && call[1].reason); }), 'no missing-diagnostic startup banner is produced');
var badge = isolated.document.getElementById('pnhud-bootstrap-badge');
assert.ok(!badge || badge.dataset.pnhudBootFailure !== 'true', 'clean manifest-order load has no red startup failure banner');

var api = isolated.PokerPauseDiagnosticCapture;
var disabled = api.createState({ buildId: 'startup-test', createdAt: 1000 });
assert.strictEqual(disabled.enabled, false, 'diagnostics remain disabled by default');
assert.strictEqual(api.recordEntry(disabled, { api: 'fetch', payload: 'ignored' }), null, 'disabled engine captures nothing');
assert.strictEqual(api.setEnabled(disabled, true, 2000), true, 'enabling diagnostics activates the capture engine');
assert.strictEqual(disabled.captureStartedAt, 2000);
assert.ok(Array.isArray(disabled.entries) && Array.isArray(disabled.sockets), 'enabled capture engine owns bounded diagnostic collections');
assert.strictEqual(JSON.stringify(productionSentinel), sentinelBefore, 'startup and diagnostic enablement do not mutate lifecycle/statistics state');
assert.strictEqual(storageWrites.some(function (write) { return Object.keys(write).some(function (key) { return /stats|activeHand|finalized|lifecycleEpoch|walk/i.test(key); }); }), false, 'startup harness performs no lifecycle/statistics persistence');

console.log('Exact manifest-order Pause diagnostic registration and stage 1.4 startup regression test passed.');
