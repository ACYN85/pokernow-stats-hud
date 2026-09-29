'use strict';
var assert = require('assert');
var Evidence = require('./statEvidence.js');
var Insights = require('./playerInsights.js');
var overall = { position: null, situation: 'overall', opponentMode: 'overall' };
function card(id, made, opportunities, source, context) {
  source = source || 'session'; context = context || overall;
  return { id: id, numerator: made, denominator: opportunities,
    evidence: Evidence.evaluateStatEvidence({ statKey: id, numerator: made, opportunities: opportunities, source: source, context: context }) };
}
function derive(cards, source, context) { return Insights.derive({ cards: cards, source: source || 'session', context: context || overall, tableSizeSupported: true }); }
function ids(items) { return items.map(function (item) { return item.id; }); }

assert.deepStrictEqual(ids(derive([card('threeBet', 2, 14)])), [], 'Weak evidence is suppressed');
assert.deepStrictEqual(ids(derive([card('threeBet', 1, 4)])), [], 'Insufficient evidence is suppressed');
assert.deepStrictEqual(ids(derive([card('threeBet', 0, 15)])), ['threeBet-low'], 'Moderate boundary qualifies');
assert.deepStrictEqual(ids(derive([card('threeBet', 2, 40)])), ['threeBet-low'], 'Strong qualifies');
assert.deepStrictEqual(ids(derive([card('threeBet', 0, 10)])), [], 'the same zero rate is hidden with Weak support');
assert.deepStrictEqual(ids(derive([card('threeBet', 0, 20)])), ['threeBet-low'], 'the same zero rate appears with Moderate support');
assert.deepStrictEqual(ids(derive([card('threeBet', 0, 15)])), ['threeBet-low'], 'low boundary includes zero');
assert.deepStrictEqual(ids(derive([card('threeBet', 12, 100)])), ['threeBet-high'], 'high boundary is inclusive');
assert.deepStrictEqual(ids(derive([card('threeBet', 11, 100)])), [], 'middle band is silent');
assert.deepStrictEqual(ids(derive([card('foldToThreeBet', 38, 100)])), ['foldToThreeBet-low']);
assert.deepStrictEqual(ids(derive([card('foldToThreeBet', 62, 100)])), ['foldToThreeBet-high']);
assert.deepStrictEqual(ids(derive([card('flopCBet', 42, 100), card('foldToFlopCBet', 58, 100), card('wtsd', 34, 100)])), ['flopCBet-low', 'foldToFlopCBet-high', 'wtsd-high']);

assert.deepStrictEqual(ids(derive([card('vpip', 20, 100), card('pfr', 10, 100)])), ['vpip-low'], 'broad participation appears without relationship');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 20, 100)])), ['vpip-pfr-gap-high'], 'gap replaces broad loose participation');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 36, 100)])), ['vpip-pfr-gap-close'], 'close relationship replaces broad participation');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 8, 49)])), ['vpip-high'], 'pair needs Moderate Evidence on both statistics');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 20, 100), card('threeBet', 12, 100), card('foldToThreeBet', 62, 100)])), ['vpip-pfr-gap-high', 'threeBet-high', 'foldToThreeBet-high'], 'stable family ordering');
var shuffled = [card('wtsd', 34, 100), card('foldToThreeBet', 62, 100), card('vpip', 40, 100), card('threeBet', 12, 100), card('pfr', 20, 100)];
var ordered = derive(shuffled); assert.deepStrictEqual(ids(ordered), ids(derive(shuffled.slice().reverse())), 'input order does not affect output order');
assert.strictEqual(new Set(ordered.map(function (item) { return item.family; })).size, ordered.length, 'one noncontradictory observation per family');

var oop = { position: null, situation: 'oop', opponentMode: 'overall' };
assert.deepStrictEqual(ids(derive([card('flopCBet', 70, 100, 'session', oop)], 'session', oop)), ['flopCBet-high'], 'exact filtered context qualifies');
assert.deepStrictEqual(derive([card('flopCBet', 70, 100)], 'session', oop), [], 'overall cannot fill filtered context');
assert.deepStrictEqual(derive([card('flopCBet', 70, 100)], 'career'), [], 'Session cannot fill Career');
assert.deepStrictEqual(ids(derive([card('flopCBet', 70, 100, 'career')], 'career')), ['flopCBet-high'], 'Career is independent');
var observed = derive([card('flopCBet', 70, 100, 'session', oop)], 'session', oop)[0];
assert.deepStrictEqual(observed.context, oop); assert.notStrictEqual(observed.context, oop, 'context is detached');
assert.strictEqual(observed.stats[0].supportCount, 100); assert.strictEqual(observed.evidenceLabel, 'Strong');
assert.deepStrictEqual(derive([null, {}, { id: 'threeBet', numerator: 4, denominator: -1 }]), [], 'malformed inputs fail closed');
var forged = card('threeBet', 12, 100); forged.denominator = 99;
assert.deepStrictEqual(derive([forged]), [], 'support count must match displayed denominator');
var inconsistent = card('threeBet', 12, 100); inconsistent.evidence = Object.assign({}, inconsistent.evidence, { status: 'weak' });
assert.deepStrictEqual(derive([inconsistent]), [], 'inconsistent Evidence metadata fails closed');
assert.deepStrictEqual(Insights.derive({ cards: [], source: 'session' }), [], 'missing context cannot borrow Overall');
console.log('Evidence-gated player Insights pure regressions passed.');
