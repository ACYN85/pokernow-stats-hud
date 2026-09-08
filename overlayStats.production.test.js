'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var overlays = require('./seatOverlay.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });

assert.ok(isolated.js.includes('overlayStats.js'), 'production manifest loads the overlay registry');
assert.ok(isolated.js.indexOf('overlayStats.js') < isolated.js.indexOf('seatOverlay.js'), 'registry loads before the seat renderer');
assert.ok(isolated.js.indexOf('overlayStats.js') < isolated.js.indexOf('content.js'), 'registry loads before content startup');
assert.strictEqual((content.match(/function updateDisplayedStatIds\(/g) || []).length, 1, 'preference mutation has one production owner');
[
  'drag-reorder',
  'drag-enable',
  'drag-disable',
  'button-enable',
  'button-disable',
  'button-move',
  'reset-defaults'
].forEach(function (source) {
  assert.ok(content.includes("'" + source + "'"), source + ' routes through the central preference updater');
});
assert.ok(content.includes("overlayStatPreferences: 'overlayStatPreferences'"), 'production uses the versioned shared storage key');
assert.ok(content.includes('PokerOverlayStats.normalizePreference'), 'storage restoration is registry-validated');
assert.ok(content.includes('overlayStatCustomizerHtml()'), 'the large details interface mounts the customizer');
assert.ok(content.includes('bindOverlayStatCustomizer(host)'), 'the mounted customizer receives behavior');
assert.ok(content.includes('overlayStatPreferences: cloneJson(overlayStatPreferenceDiagnostics)'), 'Copy Diagnostics includes preference diagnostics');
assert.ok(css.includes('.pnhud-stat-insert-before') && css.includes('.pnhud-stat-insert-after'), 'drag insertion indicators are styled');
assert.ok(css.includes('.pnhud-no-visible-stats'), 'zero selected stats hide only the visual overlay strip');

var updates = 0;
var creates = 0;
var controller = overlays.createController({
  create: function () { creates += 1; return {}; },
  update: function () { updates += 1; },
  move: function () {},
  position: function () {},
  remove: function () {},
  skip: function () {}
});
function entry(id, stats, ids) {
  return { playerId: id, name: id, seatId: 'seat-' + id, confirmed: true, rect: { left: 1, top: 1, width: 10, height: 10 }, stats: stats, displayedStatIds: ids };
}
var selected = ['pfr', 'hands'];
controller.reconcile([
  entry('one', { handsPlayed: 3, vpip: 25, pfr: 10, af: 1 }, selected),
  entry('two', { handsPlayed: 4, vpip: 30, pfr: 20, af: 2 }, selected)
], { displayMode: 'seat-overlays-only' });
controller.reconcile([
  entry('one', { handsPlayed: 8, vpip: 40, pfr: 30, af: 3 }, selected),
  entry('two', { handsPlayed: 9, vpip: 50, pfr: 35, af: 4 }, selected)
], { displayMode: 'seat-overlays-only' });
assert.strictEqual(creates, 2, 'session/all-time value changes reuse both overlay elements');
assert.strictEqual(updates, 2, 'session/all-time value changes update both overlays once');
assert.deepStrictEqual(selected, ['pfr', 'hands'], 'value source changes do not mutate selected stat configuration');

console.log('Production overlay statistic customization integration tests passed.');
