'use strict';

var assert = require('assert');
var fs = require('fs');

var content = fs.readFileSync('content.js', 'utf8');
var css = fs.readFileSync('hud.css', 'utf8');
var manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
var scripts = manifest.content_scripts[1].js;

assert.ok(scripts.includes('playerProfileScoreInspector.js'), 'inspector is packaged in the isolated content-script world');
assert.ok(scripts.indexOf('playerProfileScoreInspector.js') < scripts.indexOf('content.js'), 'inspector loads before its consumer');
assert.ok(content.includes('PokerPlayerProfileShadowStore.list(playerProfileShadowState)'), 'selector enumerates authoritative profile-store records');
assert.ok(content.includes('socketPlayerNames.get(record.playerId)'), 'display names are resolved without changing stable identity');
assert.ok(content.includes('PokerPlayerProfileShadowStore.scoreDecomposition(playerProfileShadowState, playerId)'), 'inspect reads the existing decomposition accessor');
assert.ok(content.includes('PokerPlayerProfileScoreInspector.createUiController({'), 'production settings use the tested selector lifecycle controller');
assert.ok(content.includes('return playerProfileScoreInspectorUi.change(event.target.value)'), 'delegated change events flow through the controller');
assert.ok(content.includes('defer: function (callback) { setTimeout(callback, 0); }'), 'native select host replacement is deferred until its change event completes');
assert.ok(content.includes('playerProfileScoreInspectorUi.inspectLatest()'), 'Inspect / Refresh reads the controller current selection');
assert.ok(content.includes('playerProfileScoreInspectorUi.ensureSelection()'), 'opening Diagnostics auto-selects and reads an available player');
assert.ok(content.includes('>Refresh</button>') || fs.readFileSync('playerProfileScoreInspector.js', 'utf8').includes('>Refresh</button>'), 'manual action is a small Refresh control rather than a required Inspect step');
assert.ok(content.includes("navigator.clipboard.writeText(textValue)"), 'both copy actions use the established clipboard path');
assert.ok(content.includes('pnhud-hand-stat-inspector-host') && content.includes('pnhud-profile-score-inspector-host'), 'Hand Stat Inspector and profile diagnostics coexist');
assert.ok(content.includes("if (selectedSection !== 'diagnostics') PokerHandStatInspector.close(handStatInspectorState)"), 'existing Hand Stat Inspector lifecycle remains wired');
assert.ok(css.includes('.pnhud-profile-score-inspector { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto') && css.includes('height: clamp(330px, 62vh, 540px)') && css.includes('max-height: calc(100vh - 190px)') && css.includes('.pnhud-profile-score-body { min-width: 0; min-height: 0; overflow: auto'), 'four-row profile diagnostics are viewport-bounded with independent body scrolling');
assert.ok(css.includes('.pnhud-profile-score-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto') && css.includes('.pnhud-profile-score-controls select { width: 100%; min-width: 0'), 'selector and Inspect control use a responsive non-overlapping grid');
assert.ok(css.includes('.pnhud-profile-score-summary { display: grid') && css.includes('row-gap: 10px') && css.includes('.pnhud-profile-score-summary-player') && css.includes('grid-column: 1 / -1'), 'summary uses explicit separated fields with a full-width player row');
assert.ok(css.includes('.pnhud-profile-score-player-id') && css.includes('overflow-wrap: anywhere') && css.includes('word-break: break-word'), 'long names and stable IDs cannot overflow their container');
assert.ok(css.includes('scrollbar-width: thin') && css.includes('.pnhud-profile-score-body::-webkit-scrollbar-thumb'), 'independent scrollbar keeps a themed but visible affordance');
assert.ok(css.includes('.pnhud-profile-score-gated') && css.includes('overflow-x: auto'), 'gated score explanation and feature table remain bounded');
assert.ok(css.includes('.pnhud-hand-stat-inspector {') && css.includes('.pnhud-hand-stat-inspector-layout'), 'existing Hand Stat Inspector layout remains present');

console.log('Player Profile Score Inspector requirements 15-17 production wiring and bounded coexistence passed.');
