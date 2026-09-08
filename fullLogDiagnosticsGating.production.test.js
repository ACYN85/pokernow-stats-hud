'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

function run(level) {
  var observations = [];
  function Observer(callback) { this.callback = callback; this.observe = function (target, options) { observations.push({ target: target, options: options }); }; this.disconnect = function () {}; }
  var storage = { pokerNowHudDiagnosticsLevel: level };
  var harness = harnessSupport.createHarness({ gameId: 'full-log-gating-' + level, initialStorage: storage, MutationObserver: Observer });
  assert.deepStrictEqual(harness.evaluationErrors, []);
  var fullLogObservers = observations.filter(function (record) {
    var filter = record.options && record.options.attributeFilter || [];
    return record.options
      && record.options.characterData === true
      && filter.length === 4
      && ['class', 'style', 'hidden', 'aria-hidden'].every(function (name) { return filter.includes(name); });
  });
  return { harness: harness, fullLogObservers: fullLogObservers };
}

assert.strictEqual(run('basic').fullLogObservers.length, 0, 'default/basic mode installs no diagnostic-only Full Log body observer');
assert.strictEqual(run('off').fullLogObservers.length, 0, 'off mode installs no Full Log observer');
assert.strictEqual(run('deep').fullLogObservers.length, 1, 'explicit deep diagnostics preserves Full Log discovery and inspection');

console.log('Production diagnostic-only Full Log discovery remains gated to explicit deep diagnostics; the production seat lifecycle observer is independent.');
