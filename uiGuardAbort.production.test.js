'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

function fakeDocument() {
  var elements = new Map();
  var body = {
    appendChild: function (element) { element.parentElement = body; element.isConnected = true; elements.set(element.id, element); return element; }
  };
  return {
    body: body,
    documentElement: body,
    getElementById: function (id) { return elements.get(id) || null; },
    createElement: function (tagName) {
      return { tagName: String(tagName).toUpperCase(), id: '', textContent: '', dataset: {}, style: {}, parentElement: null, isConnected: false };
    },
    addEventListener: function () {}
  };
}

var exactLocation = {
  href: 'https://pokernow.com/games/pglC7CkrwmskDJfKrkFuSc2JF',
  protocol: 'https:',
  hostname: 'pokernow.com',
  pathname: '/games/pglC7CkrwmskDJfKrkFuSc2JF',
  origin: 'https://pokernow.com'
};
var calls = [];
var context = {
  location: exactLocation,
  window: { location: exactLocation },
  document: fakeDocument(),
  console: {
    log: function () { calls.push(Array.prototype.slice.call(arguments)); },
    error: function () { calls.push(Array.prototype.slice.call(arguments)); }
  }
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('./runtimeScope.js', 'utf8'), context, { filename: 'runtimeScope.js' });
vm.runInNewContext(fs.readFileSync('./content.js', 'utf8'), context, { filename: 'content.js' });

assert.ok(calls.some(function (call) { return call[0] === '[HUD UI BOOT 1] content script loaded'; }));
assert.ok(calls.some(function (call) { return call[0] === '[HUD RUNTIME SCOPE] helper installed'; }));
assert.ok(calls.some(function (call) { return call[0] === '[HUD UI BOOT 1.1] runtime guard symbol check' && call[1].namespaceExists === true && call[1].functionExists === true; }));
assert.ok(calls.some(function (call) { return call[0] === '[HUD UI BOOT 1.3] guard result' && call[1].guardResult === true; }));
assert.ok(calls.some(function (call) { return call[0] === '[HUD UI BOOT 2] runtime guard passed'; }), 'exact non-www URL reaches Boot 2');

var abortCall = calls.find(function (call) { return call[0] === '[HUD UI BOOT ABORT]'; });
assert.ok(abortCall, 'missing post-guard modules produce a structured abort in this intentionally minimal production context');
var payload = abortCall[1];
['stage', 'reason', 'message', 'name', 'stack', 'href', 'protocol', 'hostname', 'pathname', 'guardResult', 'missingSymbol', 'missingModule'].forEach(function (field) {
  assert.ok(Object.prototype.propertyIsEnumerable.call(payload, field), 'abort payload exposes enumerable ' + field);
});
assert.strictEqual(payload.href, exactLocation.href);
assert.strictEqual(payload.hostname, 'pokernow.com');
assert.strictEqual(payload.guardResult, true);
assert.ok(calls.some(function (call) { return typeof call[0] === 'string' && call[0].indexOf('[HUD UI BOOT ABORT STRING] ') === 0; }), 'plain-string abort reason is logged');
var badge = context.document.getElementById('pnhud-bootstrap-badge');
assert.ok(badge && badge.isConnected, 'an abort before full initialization remains visible on-page');
assert.strictEqual(badge.dataset.pnhudBootFailure, 'true');
assert.ok(badge.textContent.indexOf(payload.reason) >= 0, 'failure badge contains the exact abort reason');

console.log('Production non-www guard and visible pre-bootstrap abort diagnostics passed.');
