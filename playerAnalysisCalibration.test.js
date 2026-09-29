'use strict';
var assert = require('node:assert/strict');
var Evidence = require('./statEvidence.js');
var Insights = require('./playerInsights.js');
var Personal = require('./personalLeakAnalysis.js');
var Strategic = require('./strategicImplications.js');
var Dashboard = require('./playerDashboard.js');
var Aggregator = require('./careerStatsAggregator.js');
var Classifier = require('./playerProfileClassifier.js');
var Presentation = require('./playerProfilePresentation.js');
var Explanation = require('./playerProfileExplanation.js');
function context(bucket) { return { position: null, situation: 'overall', opponentMode: 'overall', tableSize: bucket }; }
function card(id, made, opportunities, bucket) {
  var c = context(bucket);
  return { id: id, numerator: made, denominator: opportunities,
    evidence: Evidence.evaluateStatEvidence({ statKey: id, numerator: made, opportunities: opportunities, source: 'session', context: c }) };
}
function derive(bucket, rows) { return Insights.derive({ source: 'session', context: context(bucket), cards: rows, tableSize: bucket, tableSizeSupported: true }); }
function ids(items) { return items.map(function (item) { return item.id; }); }
assert.deepEqual(ids(derive('HU', [card('vpip', 40, 100, 'HU'), card('pfr', 30, 100, 'HU')])), [], '40% HU VPIP is neutral');
assert.deepEqual(ids(derive('HU', [card('vpip', 20, 100, 'HU')])), ['vpip-low']);
assert.deepEqual(ids(derive('HU', [card('vpip', 75, 100, 'HU')])), ['vpip-high']);
assert.deepEqual(ids(derive('3_TO_5', [card('vpip', 40, 100, '3_TO_5')])), [], '3–5 uses its own participation band');
assert.deepEqual(ids(derive('3_TO_5', [card('vpip', 55, 100, '3_TO_5')])), ['vpip-high']);
assert.deepEqual(ids(derive('SIX_PLUS', [card('vpip', 40, 100, 'SIX_PLUS')])), ['vpip-high']);
assert.deepEqual(ids(derive('HU', [card('threeBet', 12, 100, 'HU')])), [], '12% 3Bet is not low in HU');
assert.deepEqual(ids(derive('SIX_PLUS', [card('threeBet', 12, 100, 'SIX_PLUS')])), ['threeBet-high'], 'the same 3Bet rate has a different 6+ meaning');
assert.deepEqual(ids(derive('HU', [card('vpip', 75, 100, 'HU'), card('pfr', 40, 100, 'HU')])), ['vpip-pfr-gap-high']);
for (var family of ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd']) {
  for (var bucket of ['HU', '3_TO_5', 'SIX_PLUS']) {
    var bands = Insights.thresholdsFor(bucket)[family];
    assert.deepEqual(ids(derive(bucket, [card(family, 0, 100, bucket)])), [family + '-low'], bucket + ' low ' + family);
    assert.deepEqual(ids(derive(bucket, [card(family, 100, 100, bucket)])), [family + '-high'], bucket + ' high ' + family);
    var middle = Math.round((bands.low + bands.high) * 50);
    assert.deepEqual(ids(derive(bucket, [card(family, middle, 100, bucket)])), [], bucket + ' neutral ' + family);
  }
}
assert.deepEqual(derive('HU', [card('vpip', 15, 20, 'HU')]), [], 'unchanged Evidence gate rejects a weak HU extreme');
var wide = [card('vpip', 75, 100, 'HU')];
var insight = derive('HU', wide);
assert.equal(Strategic.derive({ observations: insight, source: 'session', context: context('HU'), tableSizeSupported: true }).some(function (item) { return item.sourceInsightIds.includes('vpip-high'); }), true, 'HU implication follows the HU Insight');
assert.equal(Personal.derive({ source: 'session', context: context('HU'), cards: wide, tableSize: 'HU', tableSizeSupported: true }).some(function (item) { return item.id === 'self-vpip-high'; }), true, 'HU self review follows the HU band');
assert.deepEqual(Personal.derive({ source: 'session', context: context('HU'), cards: [card('vpip', 40, 100, 'HU')], tableSize: 'HU', tableSizeSupported: true }), [], 'HU 40% cannot trigger a loose self prompt');
function profile(bucket, vpip, pfr, size) {
  var counters = Object.assign(Aggregator.emptyCounters(), { hands: 100, vpipMade: vpip, vpipOpportunities: 100, pfrMade: pfr, pfrOpportunities: 100 });
  return Dashboard.careerProfile({ version: 1, playerId: 'p', tableSize: bucket, counters: counters,
    profileContext: { version: 2, preflopTableSizeSum: size * 100, preflopTableSizeOpportunities: 100 } }, Classifier, Presentation, Explanation);
}
assert.notEqual(profile('HU', 40, 30, 2).displayedArchetype, 'LAG', 'HU 40% cannot inherit a loose multiway profile');
assert.equal(profile('HU', 75, 60, 2).displayedArchetype, 'LAG', 'broad HU participation can produce a profile');
assert.notEqual(profile('3_TO_5', 40, 30, 4).displayedArchetype, 'LAG', '3–5 40% remains distinct from 6+ profile calibration');
assert.equal(profile('SIX_PLUS', 40, 30, 6).displayedArchetype, 'LAG', 'the same 40% is looser at 6+');
console.log('HU, 3–5, 6+ family bands, neutral zones, Evidence, implications, self prompts, and profile compatibility passed.');
