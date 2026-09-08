'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var harnessSupport = require('./testSupport/productionContentScriptHarness');

var content = fs.readFileSync('./content.js', 'utf8');
var source = fs.readFileSync('./handStatInspector.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); });
var main = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; });

assert.strictEqual(isolated.js.filter(function (file) { return file === 'handStatInspector.js'; }).length, 1);
assert.strictEqual(isolated.js[isolated.js.indexOf('statExplanation.js') + 1], 'handStatInspector.js');
assert.ok(isolated.js.indexOf('handStatInspector.js') < isolated.js.indexOf('content.js'));
assert.strictEqual(main.js.includes('handStatInspector.js'), false);
assert.ok(content.includes("['PokerHandStatInspector', globalThis.PokerHandStatInspector, 'handStatInspector.js']"));

var harness = harnessSupport.createHarness({ gameId: 'ui-production-test' });
assert.deepStrictEqual(harness.evaluationErrors, []);
assert.strictEqual(harness.evaluateInIsolatedWorld('typeof PokerHandStatInspector'), 'object');
assert.strictEqual(harness.evaluateInIsolatedWorld('typeof PokerNowHUDProfiles.lastHandStatExplanation'), 'function');
assert.strictEqual(harness.evaluateInIsolatedWorld('typeof PokerNowHUDProfiles.handStatExplanation'), 'function');
assert.strictEqual(harness.evaluateInIsolatedWorld('typeof PokerNowHUDProfiles.handStatExplanations'), 'function');
assert.strictEqual(Object.keys(harness.storage).some(function (key) { return /inspector|explanation/i.test(key); }), false, 'no inspector or explanation storage key exists');

// H17: keyboard/focus accessibility hooks are present on the production path.
assert.ok(content.includes("event.key === 'Escape' && handStatInspectorState.open"));
assert.ok(content.includes("refreshHandStatInspectorView('close')"));
assert.ok(content.includes("refreshHandStatInspectorView('launcher')"));
assert.ok(source.includes('role="dialog"'));
assert.ok(source.includes('aria-labelledby="pnhud-hand-stat-inspector-title"'));
assert.ok(source.includes('aria-current="'));
assert.ok(source.includes('aria-live="polite"'));
assert.ok(source.includes('data-pnhud-inspector-focus="close"'));
assert.ok(css.includes('.pnhud-hand-stat-inspector button:focus-visible'));

// H18: integration reuses delegated settings ownership and preserves existing controls.
assert.ok(content.includes('Hand Stat Inspector'));
assert.ok(content.includes('function handleSettingsPanelClick(event)'));
assert.ok(content.includes("event.target.closest('.pnhud-open-hand-stat-inspector')"));
assert.ok(content.includes("event.target.closest('.pnhud-copy-hand-stat-summary')"));
assert.ok(content.includes("event.target.closest('.pnhud-copy-hand-stat-json')"));
assert.ok(content.includes('recorded.recorded && handStatInspectorState.open'));
assert.ok(content.includes('Show developer tools'));
assert.ok(content.includes('Enable bounded Pause/Resume diagnostic capture'));
assert.ok(content.includes('overlayStatCustomizerHtml()'));
assert.ok(content.includes('leaderboardStatCustomizerHtml()'));
assert.ok(content.includes('Settings panel background opacity'));
assert.strictEqual((content.match(/settingsPanel\.addEventListener\('click', handleSettingsPanelClick\)/g) || []).length, 1);
assert.doesNotMatch(source, /PokerStats|PokerPlayerProfile|chrome\.storage|localStorage|sessionStorage|WebSocket|addEventListener/);
assert.ok(css.includes('#pnhud-settings-panel .pnhud-hand-stat-inspector'));
assert.ok(css.includes('grid-template-columns: minmax(145px, 190px) minmax(0, 1fr)'));

console.log('Production Hand Stat Inspector H17-H18 manifest, settings, accessibility, isolation, and neutrality tests passed.');
