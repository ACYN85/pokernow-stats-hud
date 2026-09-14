'use strict';

var assert = require('assert');
var fs = require('fs');

var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
var main = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; }).js;
var adapter = fs.readFileSync('./playerProfileExplanation.js', 'utf8');
var classifier = fs.readFileSync('./playerProfileClassifier.js', 'utf8');
var presentation = fs.readFileSync('./playerProfilePresentation.js', 'utf8');
var content = fs.readFileSync('./content.js', 'utf8');
var dashboard = fs.readFileSync('./playerDashboard.js', 'utf8');
var seatOverlay = fs.readFileSync('./seatOverlay.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

assert.strictEqual(isolated.filter(function (file) { return file === 'playerProfileExplanation.js'; }).length, 1, 'one explainability adapter is packaged in the isolated world');
assert.strictEqual(main.includes('playerProfileExplanation.js'), false, 'profile explanations stay out of the MAIN transport world');
assert.strictEqual(isolated[isolated.indexOf('playerProfilePresentation.js') + 1], 'playerProfileExplanation.js', 'adapter follows the authoritative classifier presentation policy');
assert.strictEqual(isolated[isolated.indexOf('playerProfileExplanation.js') + 1], 'playerProfileShadowStore.js', 'shadow records follow the explanation dependency');
assert.ok(isolated.indexOf('playerProfileExplanation.js') < isolated.indexOf('playerDashboard.js') && isolated.indexOf('playerProfileExplanation.js') < isolated.indexOf('seatOverlay.js'));

assert.ok(adapter.includes('classifier.DEFAULT_CONFIG'), 'numeric classifier criteria come from the exported classifier configuration');
assert.ok(adapter.includes('presentation.DEFAULT_POLICY'), 'visibility and hysteresis criteria come from the exported presentation policy');
assert.strictEqual(adapter.includes('minimumPrimaryScore: 0.42'), false, 'adapter does not copy the classifier primary score threshold');
assert.strictEqual(adapter.includes('minimumVisibleHands: 40'), false, 'adapter does not copy the presentation minimum-hands threshold');
assert.strictEqual(adapter.includes('minimumScoreMargin: 0.08'), false, 'adapter does not copy the classifier margin threshold');
assert.ok(adapter.includes('entry.evidence') && adapter.includes('featureDiagnostics'), 'actual decomposition evidence drives explanation rows');
assert.ok(adapter.includes('not probabilities and do not have to sum to 100%'), 'fit-score semantics are explicit');

assert.ok(content.includes("['PokerPlayerProfileExplanation', globalThis.PokerPlayerProfileExplanation, 'playerProfileExplanation.js']"), 'content startup requires the adapter');
assert.ok(content.includes('explainPlayerProfile: explainPlayerProfile'), 'isolated diagnostics expose explainPlayerProfile');
assert.ok(content.includes('PokerPlayerProfileExplanation.explain({'), 'production explanation calls the single adapter');
assert.ok(content.includes('decomposition: PokerPlayerProfileShadowStore.scoreDecomposition'), 'production passes current classifier decomposition');
assert.ok(content.includes('explanation: explainPlayerProfile(playerId)'), 'dashboard receives the exact same diagnostic explanation object');
assert.ok(content.indexOf('playerDashboardState.profile = playerDashboardProfile') > content.indexOf('cachedSessionFilteredStats'), 'filtered dashboard stats and unfiltered Session profile remain separately owned');

assert.ok(dashboard.includes('Why this profile?') && dashboard.includes('Profile Guide') && dashboard.includes('Advanced details'));
assert.ok(dashboard.includes('<details class="pnhud-dashboard-profile-explanation">'), 'explanation is compact and collapsed by default');
assert.ok(dashboard.includes('Why no profile is shown'), 'hidden profiles retain an explanation path');
assert.ok(require('./playerDashboard.js').render({ mode: 'session', profile: {} }).includes('Current profile is not recalculated by dashboard filters.'), 'existing profile/filter ownership text remains visible');
assert.ok(seatOverlay.includes('profileExplanation.DEFINITIONS[archetype].description'), 'seat tooltip and dashboard guide share one archetype-description source');
assert.ok(css.includes('.pnhud-dashboard-profile-explanation') && css.includes('.pnhud-dashboard-profile-guide') && css.includes('.pnhud-dashboard-profile-advanced'));

assert.ok(classifier.includes('var SCHEMA_VERSION = 4;') && presentation.includes('var SCHEMA_VERSION = 1;'), 'frozen classifier and presentation contracts retain their schema versions');
assert.ok(!adapter.includes('classify(') && !adapter.includes('resolveDisplayedProfile('), 'adapter translates supplied outputs and never reclassifies or mutates presentation state');

console.log('Production profile-explainability adapter, load order, dashboard UI, diagnostics, source-of-truth, and semantic isolation passed.');
