'use strict';
var assert = require('assert');
var Evidence = require('./statEvidence.js');
var Insights = require('./playerInsights.js');
var Strategic = require('./strategicImplications.js');
var Personal = require('./personalLeakAnalysis.js');
var context = { position: null, situation: 'overall', opponentMode: 'overall' };
function card(id, numerator, denominator) {
  return { id: id, numerator: numerator, denominator: denominator, evidence: Evidence.evaluateStatEvidence({
    statKey: id, numerator: numerator, opportunities: denominator, source: 'session', context: context
  }) };
}
function profile(cards) {
  var observations = Insights.derive({ cards: cards, source: 'session', context: context, tableSizeSupported: true });
  return Strategic.derive({ observations: observations, source: 'session', context: context, tableSizeSupported: true });
}
var fixtures = [
  { name: 'A tight / low 3Bet', cards: [card('vpip', 12, 100), card('threeBet', 1, 40)], composite: 'tight-selective-preflop', action: 'Respect their preflop aggression more', children: ['vpip-low', 'threeBet-low'] },
  { name: 'B loose / high 3Bet', cards: [card('vpip', 48, 100), card('threeBet', 12, 40)], composite: 'loose-aggressive-preflop', action: 'Avoid premium-only preflop assumptions', children: ['vpip-high', 'threeBet-high'] },
  { name: 'C high WTSD / low FCB', cards: [card('wtsd', 22, 50), card('foldToFlopCBet', 5, 40)], composite: 'sticky-showdown', action: 'Bluff flop CBets less; value bet thinner', children: ['wtsd-high', 'foldToFlopCBet-low'] },
  { name: 'D high F3B / high FCB', cards: [card('foldToThreeBet', 32, 40), card('foldToFlopCBet', 31, 40)], composite: 'fold-prone', action: 'Apply selective preflop and flop pressure', children: ['foldToThreeBet-high', 'foldToFlopCBet-high'] },
  { name: 'E high F3B / low FCB', cards: [card('foldToThreeBet', 32, 40), card('foldToFlopCBet', 5, 40)], composite: null, action: null, children: ['foldToThreeBet-high', 'foldToFlopCBet-low'] }
];
fixtures.forEach(function (fixture) {
  var result = profile(fixture.cards);
  var composites = result.filter(function (item) { return item.type === 'composite'; });
  assert.deepStrictEqual(composites.map(function (item) { return item.id; }), fixture.composite ? ['implication-' + fixture.composite] : [], fixture.name);
  if (fixture.composite) assert.strictEqual(composites[0].actionTitle, fixture.action, fixture.name + ' has an immediate useful takeaway');
  fixture.children.forEach(function (id) {
    var child = result.find(function (item) { return item.type === 'single' && item.sourceInsightIds[0] === id; });
    assert.ok(child && child.interpretation, fixture.name + ' keeps ' + id + ' visible');
    assert.strictEqual(Boolean(child.adjustment), !fixture.composite, fixture.name + ' adjustment precedence for ' + id);
  });
  assert.ok(result.every(function (item) { return item.interpretation.length < 220 && (!item.adjustment || item.adjustment.length < 220); }), fixture.name + ' remains concise');
  assert.strictEqual(new Set(result.filter(function (item) { return item.adjustment; }).map(function (item) { return item.adjustment; })).size,
    result.filter(function (item) { return item.adjustment; }).length, fixture.name + ' has no duplicated adjustment');
  assert.ok(result.every(function (item) { return item.reason.length < 120 && item.actionTitle.length < 60; }), fixture.name + ' uses short primary copy');
});
var mixed = profile(fixtures[4].cards);
assert.match(mixed.find(function (item) { return item.sourceInsightIds[0] === 'foldToThreeBet-high'; }).adjustment, /^Preflop:/);
assert.match(mixed.find(function (item) { return item.sourceInsightIds[0] === 'foldToFlopCBet-low'; }).adjustment, /^Flop:/);
assert.strictEqual(mixed.find(function (item) { return item.sourceInsightIds[0] === 'foldToThreeBet-high'; }).actionTitle, 'Apply selective 3-bet pressure');
assert.strictEqual(mixed.find(function (item) { return item.sourceInsightIds[0] === 'foldToFlopCBet-low'; }).actionTitle, 'Bluff flop CBets less; value bet more');
var self = Personal.derive({ cards: [card('vpip', 12, 100), card('wtsd', 22, 50)], source: 'session', context: context, tableSizeSupported: true });
assert.deepStrictEqual(self.map(function (item) { return item.reviewTitle; }), [
  'Consider widening preflop participation', 'Review whether you call down too often'
], 'F self low VPIP and high WTSD presents cautious review actions first');
console.log('Six action-first calibration profiles passed: A tight, B loose, C sticky, D fold-prone, E mixed-street, F self low VPIP/high WTSD.');
