'use strict';

var assert = require('assert');
var healthPanel = require('./hudHealth');

(function rendersTheCanonicalHealthPanel() {
  var html = healthPanel.renderHtml({
    hookInstalled: true,
    framesCaptured: 12,
    lastFailureReason: 'none'
  }, function (value) { return String(value); });

  assert.match(html, /data-health="hookInstalled">yes</);
  assert.match(html, /data-health="framesCaptured">12</);
  assert.match(html, /data-health="lastFailureReason">none</);
  assert.match(html, /Copy Diagnostics/);
  assert.match(html, /Inject Test Event/);
  assert.ok(healthPanel.METRICS.some(function (metric) { return metric[1] === 'gameStatePatchesMerged'; }));
})();

(function updatesExistingMetricNodesWithoutOwningState() {
  var nodes = {
    hookInstalled: { textContent: '' },
    framesRelayed: { textContent: '' }
  };
  var root = {
    querySelector: function (selector) {
      var match = selector.match(/data-health="([^"]+)"/);
      return match ? nodes[match[1]] || null : null;
    }
  };

  assert.strictEqual(healthPanel.update(root, { hookInstalled: false, framesRelayed: 9, ignored: 4 }), 2);
  assert.strictEqual(nodes.hookInstalled.textContent, 'no');
  assert.strictEqual(nodes.framesRelayed.textContent, '9');
  assert.strictEqual(healthPanel.update(null, {}), 0);
})();

console.log('hudHealth tests passed');
