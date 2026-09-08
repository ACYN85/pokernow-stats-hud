'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');
var inspector = require('./playerProfileScoreInspector');

function stats(overrides) {
  return Object.assign({ handsPlayed: 100, vpipHands: 24, vpipOpportunities: 100, pfrHands: 18, pfrOpportunities: 100, preflopTableSizeSum: 900, preflopTableSizeOpportunities: 100, afDetails: { bets: 20, raises: 12, calls: 20 }, threeBetMade: 5, threeBetOpportunities: 50 }, overrides || {});
}
function record(input) { var value = classifier.classify(input); value.hands = input.handsPlayed; return value; }
function pair(input) {
  var decomposition = classifier.scoreDecomposition(input);
  decomposition.asOfHand = 'HAND-100';
  decomposition.lastFinalizedHandId = 'HAND-100';
  decomposition.snapshotVersion = 100;
  return { record: record(input), decomposition: decomposition };
}
function lookup(entries) { return function (playerId) { return entries[playerId]; }; }

var alpha = stats();
var beta = stats({ handsPlayed: 10, vpipHands: 3, vpipOpportunities: 10, pfrHands: 2, pfrOpportunities: 10, preflopTableSizeSum: 90, preflopTableSizeOpportunities: 10 });
var data = { 'stable-alpha-0000001': pair(alpha), 'stable-beta-0000002': pair(beta) };
var entries = [
  { playerId: 'stable-alpha-0000001', displayName: 'Duplicate', hands: 100 },
  { playerId: 'stable-beta-0000002', displayName: 'Duplicate', hands: 10 }
];
var state = inspector.createState();

// 1-3: known players, stable IDs, and duplicate display names.
var initial = inspector.buildModel(state, entries);
assert.strictEqual(initial.players.length, 2);
assert.notStrictEqual(initial.players[0].playerId, initial.players[1].playerId);
var initialHtml = inspector.renderHtml(initial);
assert.strictEqual((initialHtml.match(/Duplicate/g) || []).length, 2);
assert.ok(initialHtml.includes(inspector.shortStableId('stable-alpha-0000001')));
assert.ok(!initialHtml.includes('type="text"'), 'selector does not permit manual ID entry');

// Live UI lifecycle: change events defer host replacement and Inspect reads the latest stable ID.
var uiState = inspector.createState();
var uiEntries = entries.slice();
var deferred = [];
var rendered = [];
var lookups = [];
var controller = inspector.createUiController({
  state: uiState,
  entries: function () { return uiEntries; },
  lookup: function (playerId) { lookups.push(playerId); return data[playerId]; },
  defer: function (callback) { deferred.push(callback); },
  render: function (focus) { rendered.push({ focus: focus, html: inspector.renderHtml(inspector.buildModel(uiState, uiEntries)) }); }
});
function flushDeferred() { while (deferred.length) deferred.shift()(); }
function inspectedPlayerId() { var latest = rendered[rendered.length - 1]; var match = latest && latest.html.match(/class="pnhud-profile-score-player-id">([^<]+)/); return match && match[1]; }

assert.ok(controller.change('stable-alpha-0000001'), 'Player A change is accepted');
assert.strictEqual(rendered.length, 0, 'active select is not synchronously replaced inside its native change event');
flushDeferred();
assert.strictEqual(inspectedPlayerId(), 'stable-alpha-0000001', 'panel auto-inspects Player A after its deferred change');
assert.ok(controller.inspectLatest(), 'Refresh can re-read Player A');
assert.strictEqual(inspectedPlayerId(), 'stable-alpha-0000001');
assert.ok(controller.change('stable-beta-0000002'), 'selector can change to Player B after inspection');
assert.strictEqual(uiState.selectedPlayerId, 'stable-beta-0000002');
flushDeferred();
assert.strictEqual(inspectedPlayerId(), 'stable-beta-0000002', 'Player B auto-renders without an Inspect click');
['stable-alpha-0000001', 'stable-beta-0000002', 'stable-alpha-0000001'].forEach(function (playerId) { assert.ok(controller.change(playerId)); flushDeferred(); assert.strictEqual(inspectedPlayerId(), playerId); });
assert.ok(lookups.includes('stable-alpha-0000001') && lookups.includes('stable-beta-0000002'), 'duplicate names resolve through distinct stable IDs');
var refreshCount = lookups.length;
assert.ok(controller.inspectLatest(), 'refreshing the current player works');
assert.strictEqual(lookups.length, refreshCount + 1);
uiEntries = [entries[1]];
assert.strictEqual(controller.change('stable-alpha-0000001'), false, 'a stale player selection is rejected and cleared');
flushDeferred();
assert.strictEqual(uiState.selectedPlayerId, null);
assert.ok(controller.change('stable-beta-0000002'), 'stale selection does not lock the remaining selector option');
flushDeferred();
assert.strictEqual(inspectedPlayerId(), 'stable-beta-0000002');
uiEntries = entries.slice();

var openState = inspector.createState();
var openRendered = [];
var openController = inspector.createUiController({ state: openState, entries: function () { return entries; }, lookup: lookup(data), render: function () { openRendered.push(inspector.renderHtml(inspector.buildModel(openState, entries))); }, defer: function (callback) { callback(); } });
assert.ok(openController.ensureSelection(), 'opening with known players selects and inspects a sensible default');
assert.strictEqual(openState.selectedPlayerId, entries[0].playerId);
assert.strictEqual(inspector.buildModel(openState, entries).decomposition.schemaVersion, classifier.SCHEMA_VERSION);

// 4-8: inspect, switch, TAG compatibility, all archetypes, and bounded evidence.
assert.strictEqual(inspector.select(state, entries, 'stable-alpha-0000001'), true);
assert.strictEqual(inspector.inspect(state, entries, lookup(data)), true);
var model = inspector.buildModel(state, entries);
assert.strictEqual(model.summary.hands, 100);
assert.strictEqual(model.archetypes.length, 7);
assert.deepStrictEqual(model.archetypes.map(function (entry) { return entry.name; }), inspector.ARCHETYPES);
var tag = model.archetypes.find(function (entry) { return entry.name === 'TAG'; });
assert.ok(tag && tag.compatibility.applied);
assert.strictEqual(tag.compatibility.scale, Number((0.60 + 0.40 * Math.pow(tag.compatibility.membership, 2)).toFixed(4)));
var html = inspector.renderHtml(model);
['TAG VPIP membership', 'Unadjusted score', 'TAG compatibility scale', 'Final score', 'Eff. weight', 'Contribution', 'Support', 'Requirement / gate'].forEach(function (text) { assert.ok(html.includes(text), text); });
assert.ok(html.includes('Show evidence'));
['pnhud-profile-score-summary-player', 'pnhud-profile-score-player-name', 'pnhud-profile-score-player-id'].forEach(function (className) { assert.ok(html.includes(className), className); });
assert.ok(inspector.toggleDetails(state, 'TAG'));
assert.ok(inspector.renderHtml(inspector.buildModel(state, entries)).includes('<details class="pnhud-profile-score-evidence" open>'));
assert.strictEqual(inspector.select(state, entries, 'stable-beta-0000002'), true);
assert.strictEqual(inspector.inspect(state, entries, lookup(data)), true);
model = inspector.buildModel(state, entries);
assert.strictEqual(model.selected.playerId, 'stable-beta-0000002');
assert.strictEqual(model.summary.hands, 10);

// 9-12: uncertain, insufficient, unsupported, unavailable, and stale states stay readable.
assert.strictEqual(model.summary.status, 'insufficient_sample');
assert.ok(inspector.renderHtml(model).includes('Unknown / Insufficient Sample'));

var liveTen = stats({ handsPlayed: 10, vpipHands: 3, vpipOpportunities: 10, pfrHands: 2, pfrOpportunities: 10, preflopTableSizeSum: 74, preflopTableSizeOpportunities: 10, afDetails: { bets: 0, raises: 0, calls: 2 }, threeBetMade: 1, threeBetOpportunities: 5, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, flopCBetMade: 0, flopCBetOpportunities: 2, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0, wentToShowdown: 0, sawFlopForWTSD: 4, wonMoneyAtShowdown: 0, showdownsForWSD: 0 });
var liveClassificationBefore = classifier.classify(liveTen);
var liveDecomposition = classifier.scoreDecomposition(liveTen);
var liveClassificationAfter = classifier.classify(liveTen);
assert.deepStrictEqual(liveClassificationAfter, liveClassificationBefore, 'diagnostic decomposition leaves classify() output bit-for-bit unchanged');
assert.strictEqual(liveClassificationAfter.primary.classificationStatus, 'insufficient_sample');
assert.strictEqual(liveClassificationAfter.primary.archetype, 'Unknown / Insufficient Sample');
assert.deepStrictEqual({ raw: liveDecomposition.featureDiagnostics.vpipRate.rawRate, stabilized: liveDecomposition.featureDiagnostics.vpipRate.stabilizedRate, opportunities: liveDecomposition.featureDiagnostics.vpipRate.opportunities, available: liveDecomposition.featureDiagnostics.vpipRate.dataAvailable, scoringSupported: liveDecomposition.featureDiagnostics.vpipRate.scoringSupported }, { raw: 0.3, stabilized: 0.2859, opportunities: 10, available: true, scoringSupported: false });
assert.deepStrictEqual({ raw: liveDecomposition.featureDiagnostics.pfrRate.rawRate, stabilized: liveDecomposition.featureDiagnostics.pfrRate.stabilizedRate, opportunities: liveDecomposition.featureDiagnostics.pfrRate.opportunities, available: liveDecomposition.featureDiagnostics.pfrRate.dataAvailable }, { raw: 0.2, stabilized: 0.2, opportunities: 10, available: true });
assert.strictEqual(liveDecomposition.featureDiagnostics.threeBetRate.dataAvailable, true);
assert.strictEqual(liveDecomposition.featureDiagnostics.foldToThreeBetRate.dataAvailable, false);
assert.strictEqual(liveDecomposition.featureDiagnostics.foldToThreeBetRate.scoringUnsupportedReason, 'zero_denominator');
var liveData = { 'stable-live-ten': { record: liveClassificationAfter, decomposition: liveDecomposition } };
liveData['stable-live-ten'].record.hands = 10;
var liveEntries = [{ playerId: 'stable-live-ten', displayName: 'Joe tsai', hands: 10 }];
var liveState = inspector.createState();
assert.ok(inspector.select(liveState, liveEntries, 'stable-live-ten'));
assert.ok(inspector.inspect(liveState, liveEntries, lookup(liveData)));
var liveModel = inspector.buildModel(liveState, liveEntries);
var liveHtml = inspector.renderHtml(liveModel);
assert.strictEqual(liveModel.summary.features.find(function (feature) { return feature.feature === 'vpipRate'; }).dataAvailable, true);
assert.strictEqual(liveModel.summary.features.find(function (feature) { return feature.feature === 'foldToThreeBetRate'; }).dataAvailable, false);
assert.ok(liveHtml.includes('<th>VPIP</th><td>30.0% (3/10)</td><td>28.6%</td><td>10</td>'));
assert.ok(liveHtml.includes('<th>PFR</th><td>20.0% (2/10)</td><td>20.0%</td><td>10</td>'));
assert.ok(liveHtml.includes('<th>F3B</th><td>Unsupported</td>'));
assert.ok(liveHtml.includes('Available; provisional'));
assert.ok(liveHtml.includes('No provisional archetype score is shown'));
assert.ok(inspector.summaryText(liveModel).includes('VPIP raw 30.0% (3/10), stabilized 28.6%'));
assert.ok(inspector.summaryText(liveModel).includes('F3B unsupported'));
var uncertainInput = stats();
var uncertain = pair(uncertainInput);
uncertain.record.primary.archetype = 'Unknown / Uncertain';
uncertain.record.primary.classificationStatus = 'ambiguous';
uncertain.record.primary.unsupportedReason = 'competing_or_weak_archetype_scores';
data['stable-uncertain'] = uncertain;
var uncertainEntries = [{ playerId: 'stable-uncertain', displayName: 'Uncertain', hands: 100 }];
assert.ok(inspector.select(state, uncertainEntries, 'stable-uncertain'));
assert.ok(inspector.inspect(state, uncertainEntries, lookup(data)));
assert.ok(inspector.renderHtml(inspector.buildModel(state, uncertainEntries)).includes('Unknown / Uncertain'));
var headsUp = stats({ preflopTableSizeSum: 200, preflopTableSizeOpportunities: 100 });
data['stable-heads-up'] = pair(headsUp);
var headsUpEntries = [{ playerId: 'stable-heads-up', displayName: 'Heads Up', hands: 100 }];
assert.ok(inspector.select(state, headsUpEntries, 'stable-heads-up'));
assert.ok(inspector.inspect(state, headsUpEntries, lookup(data)));
model = inspector.buildModel(state, headsUpEntries);
assert.strictEqual(model.summary.status, 'unsupported');
assert.ok(inspector.renderHtml(model).includes('heads_up_archetype_vocabulary_not_calibrated'));
var missing = stats({ vpipHands: undefined, vpipOpportunities: undefined });
data['stable-missing'] = pair(missing);
var missingEntries = [{ playerId: 'stable-missing', displayName: 'Missing feature', hands: 100 }];
assert.ok(inspector.select(state, missingEntries, 'stable-missing'));
assert.ok(inspector.inspect(state, missingEntries, lookup(data)));
assert.ok(inspector.renderHtml(inspector.buildModel(state, missingEntries)).includes('Required / unsupported'));
assert.ok(inspector.select(state, entries, 'stable-alpha-0000001'));
assert.strictEqual(inspector.inspect(state, entries, function () { return null; }), false);
assert.ok(inspector.renderHtml(inspector.buildModel(state, entries)).includes('decomposition unavailable'));
assert.ok(inspector.select(state, entries, 'stable-alpha-0000001'));
assert.ok(inspector.inspect(state, entries, lookup(data)));
assert.doesNotThrow(function () { inspector.renderHtml(inspector.buildModel(state, [])); });
assert.ok(inspector.renderHtml(inspector.buildModel(state, [])).includes('No player profiles are available yet'));
assert.strictEqual(inspector.select(state, entries, ''), false);
assert.strictEqual(state.selectedPlayerId, null);

// 13-14: copy summary is concise/human-readable; Copy JSON is the exact decomposition object.
assert.ok(inspector.select(state, entries, 'stable-alpha-0000001'));
assert.ok(inspector.inspect(state, entries, lookup(data)));
model = inspector.buildModel(state, entries);
var summary = inspector.summaryText(model);
['Stable ID: stable-alpha-0000001', 'As of hand: HAND-100', 'Snapshot version: 100', 'VPIP raw 24.0% (24/100)', 'AF raw 1.600 (32 aggressive actions / 20 calls)', 'Top candidate:', 'Second-best fit:', 'Fit margin:', 'TAG: VPIP membership', 'unadjusted', 'compatibility', 'Scores:'].forEach(function (text) { assert.ok(summary.includes(text), text); });
assert.ok(!summary.includes('Runner-up:'), 'ambiguous standalone Runner-up label is removed from copied summaries');
assert.ok(inspector.renderHtml(model).includes('<dt>As of hand</dt><dd>HAND-100</dd>'));
assert.ok(inspector.renderHtml(model).includes('<dt>Snapshot version</dt><dd>100</dd>'));
assert.deepStrictEqual(JSON.parse(inspector.jsonText(model)), data['stable-alpha-0000001'].decomposition);

var longEntry = [{ playerId: 'stable-id-with-a-very-long-value-that-must-wrap-safely-0000000001', displayName: 'A very long player name that must remain inside the diagnostics summary container', hands: 100 }];
var longState = inspector.createState();
assert.ok(inspector.select(longState, longEntry, longEntry[0].playerId));
assert.ok(inspector.inspect(longState, longEntry, function () { return data['stable-alpha-0000001']; }));
var longHtml = inspector.renderHtml(inspector.buildModel(longState, longEntry));
assert.ok(longHtml.includes('pnhud-profile-score-player-id') && longHtml.includes(longEntry[0].playerId));

console.log('Player Profile Score Inspector model, live A/B/A controller, stale, refresh, layout, and copy regressions passed.');
