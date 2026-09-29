'use strict';
var assert = require('assert');
var Evidence = require('./statEvidence.js');
var Insights = require('./playerInsights.js');
var Strategic = require('./strategicImplications.js');
var overall = { position: null, situation: 'overall', opponentMode: 'overall' };
function card(id, made, count, source, context) {
  source = source || 'session'; context = context || overall;
  return { id: id, numerator: made, denominator: count,
    evidence: Evidence.evaluateStatEvidence({ statKey: id, numerator: made, opportunities: count, source: source, context: context }) };
}
function implications(cards, source, context) {
  source = source || 'session'; context = context || overall;
  return Strategic.derive({ observations: Insights.derive({ cards: cards, source: source, context: context, tableSizeSupported: true }), source: source, context: context, tableSizeSupported: true });
}
function single(items, insightId) { return items.find(function (item) { return item.type === 'single' && item.sourceInsightIds[0] === insightId; }); }
var cases = [
  ['vpip-low', [card('vpip', 10, 50)], /few pots/, /voluntary involvement/],
  ['vpip-high', [card('vpip', 25, 50)], /many pots/, /participation alone/],
  ['vpip-pfr-gap-high', [card('vpip', 25, 50), card('pfr', 10, 50)], /more pots than they raised/, /value-oriented isolation/],
  ['threeBet-low', [card('threeBet', 0, 15)], /reraised preflop infrequently/, /light continuing/],
  ['threeBet-high', [card('threeBet', 4, 15)], /reraised preflop frequently/, /premium-only assumptions/],
  ['foldToThreeBet-low', [card('foldToThreeBet', 0, 15)], /continued often after facing 3-bets/, /light 3-bets may get fewer folds/],
  ['foldToThreeBet-high', [card('foldToThreeBet', 15, 15)], /folded often after facing 3-bets/, /selective light 3-bet pressure/],
  ['flopCBet-low', [card('flopCBet', 0, 15)], /continuation-bet selectively/, /CBet may merit more caution/],
  ['flopCBet-high', [card('flopCBet', 15, 15)], /continuation-bet frequently/, /less diagnostic of strength/],
  ['foldToFlopCBet-low', [card('foldToFlopCBet', 0, 15)], /continued often against qualifying flop CBets/, /bluff-heavy CBets may get fewer folds/],
  ['foldToFlopCBet-high', [card('foldToFlopCBet', 15, 15)], /folded often to qualifying flop CBets/, /selective continuation-bet pressure/],
  ['wtsd-low', [card('wtsd', 0, 15)], /showdown relatively infrequently/, /selective pressure may have more room/],
  ['wtsd-high', [card('wtsd', 15, 15)], /showdown often/, /thinner value may be worth considering/]
];
cases.forEach(function (testCase) {
  var item = single(implications(testCase[1]), testCase[0]);
  assert.ok(item, testCase[0] + ' has one implication from a Moderate Insight');
  assert.match(item.interpretation, testCase[2]); assert.match(item.adjustment, testCase[3]);
  assert.ok(item.actionTitle.length <= 52 && item.actionTitle.split(/\s+/).length <= 7, testCase[0] + ' has a glanceable action title');
  assert.ok(item.reason.length <= 120 && item.reason.endsWith('.'), testCase[0] + ' has one short reason');
  assert.strictEqual(item.evidence.label, 'Moderate'); assert.strictEqual(item.type, 'single');
  assert.strictEqual(item.sourceInsightIds[0], testCase[0]);
  assert.deepStrictEqual(item.context, overall);
});
assert.strictEqual(single(implications([card('wtsd', 15, 15)]), 'wtsd-high').actionTitle, 'Consider thinner value bets');
assert.strictEqual(single(implications([card('threeBet', 0, 15)]), 'threeBet-low').actionTitle, 'Respect their 3-bets more');
assert.strictEqual(single(implications([card('threeBet', 0, 40)]), 'threeBet-low').evidence.label, 'Strong', 'Strong Insights qualify');
assert.deepStrictEqual(implications([card('threeBet', 0, 14)]), [], 'Weak does not qualify');
assert.deepStrictEqual(implications([card('threeBet', 0, 4)]), [], 'Insufficient does not qualify');
assert.deepStrictEqual(implications([card('wsd', 40, 40), card('af', 40, 40)]), [], 'W$SD and AF have no standalone implication');
assert.deepStrictEqual(implications([card('vpip', 40, 100), card('pfr', 36, 100)]), [], 'close VPIP/PFR relationship has no unsupported strategy inference');

var sticky = implications([card('wtsd', 20, 50), card('foldToFlopCBet', 2, 40), card('foldToThreeBet', 2, 40)]);
var stickyComposite = sticky.find(function (item) { return item.id === 'implication-sticky-showdown'; });
assert.ok(stickyComposite); assert.strictEqual(stickyComposite.type, 'composite');
assert.deepStrictEqual(stickyComposite.sourceInsightIds, ['wtsd-high', 'foldToFlopCBet-low', 'foldToThreeBet-low']);
assert.strictEqual(stickyComposite.actionTitle, 'Bluff less; value bet thinner');
assert.match(stickyComposite.reason, /Continues frequently and reaches showdown often/);
var stickyFlop = implications([card('wtsd', 20, 50), card('foldToFlopCBet', 2, 40), card('foldToThreeBet', 30, 40)]);
assert.strictEqual(stickyFlop.find(function (item) { return item.id === 'implication-sticky-showdown'; }).actionTitle,
  'Bluff flop CBets less; value bet thinner', 'sticky flop advice does not contradict preflop fold tendency');
assert.strictEqual(single(stickyFlop, 'foldToThreeBet-high').actionTitle, 'Apply selective 3-bet pressure');
var stickyPreflop = implications([card('wtsd', 20, 50), card('foldToThreeBet', 2, 40)]);
assert.strictEqual(stickyPreflop.find(function (item) { return item.id === 'implication-sticky-showdown'; }).actionTitle,
  'Bluff 3-bet less; value bet thinner', 'sticky preflop advice names the supported response');
assert.strictEqual(stickyComposite.evidence.sources.length, 3, 'every material Insight is included');
stickyComposite.sourceInsightIds.forEach(function (id) {
  var child = single(sticky, id);
  assert.ok(child && child.interpretation, 'underlying observation stays available');
  assert.strictEqual(child.adjustment, null, 'composite suppresses duplicate child adjustment');
  assert.strictEqual(child.adjustmentSuppressedBy, stickyComposite.id);
});
var foldProne = implications([card('foldToThreeBet', 30, 40), card('foldToFlopCBet', 30, 40)]);
assert.ok(foldProne.some(function (item) { return item.id === 'implication-fold-prone'; }));
assert.strictEqual(single(foldProne, 'foldToThreeBet-high').adjustment, null);
assert.strictEqual(single(foldProne, 'foldToFlopCBet-high').adjustment, null);
assert.ok(implications([card('vpip', 10, 50), card('threeBet', 0, 15)]).some(function (item) { return item.id === 'implication-tight-selective-preflop'; }));
assert.ok(implications([card('vpip', 25, 50), card('threeBet', 4, 15)]).some(function (item) { return item.id === 'implication-loose-aggressive-preflop'; }));
assert.ok(!implications([card('wtsd', 20, 50), card('foldToFlopCBet', 0, 14)]).some(function (item) { return item.type === 'composite'; }), 'a Weak child cannot form a composite');

var mixed = implications([card('foldToThreeBet', 30, 40), card('foldToFlopCBet', 2, 40)]);
assert.ok(!mixed.some(function (item) { return item.type === 'composite'; }), 'mixed street behavior is not flattened into one conclusion');
assert.match(single(mixed, 'foldToThreeBet-high').adjustment, /^Preflop:/);
assert.match(single(mixed, 'foldToFlopCBet-low').adjustment, /^Flop:/);
var tightFrequentReraise = implications([card('vpip', 10, 50), card('threeBet', 4, 15)]);
assert.ok(single(tightFrequentReraise, 'vpip-low').interpretation, 'low-VPIP observation remains visible');
assert.strictEqual(single(tightFrequentReraise, 'vpip-low').adjustment, null, 'specific high-3Bet advice supersedes broad low-VPIP adjustment');
assert.strictEqual(single(tightFrequentReraise, 'vpip-low').adjustmentSuppressedBy, 'implication-threeBet-high');
assert.ok(single(tightFrequentReraise, 'threeBet-high').adjustment);
var looseSelectiveReraise = implications([card('vpip', 25, 50), card('threeBet', 0, 15)]);
assert.strictEqual(single(looseSelectiveReraise, 'vpip-high').adjustment, null, 'specific low-3Bet advice supersedes broad high-VPIP adjustment');
assert.ok(single(looseSelectiveReraise, 'threeBet-low').adjustment);
var shuffledCards = [card('wtsd', 20, 50), card('threeBet', 4, 40), card('vpip', 25, 50), card('foldToFlopCBet', 2, 40)];
assert.deepStrictEqual(implications(shuffledCards), implications(shuffledCards.slice().reverse()), 'ordering and output are deterministic');

var oop = { position: null, situation: 'oop', opponentMode: 'overall' };
var btn = { position: 'BTN', situation: 'overall', opponentMode: 'overall' };
var vsHero = { position: null, situation: 'overall', opponentMode: 'self' };
assert.match(single(implications([card('foldToFlopCBet', 0, 15, 'session', oop)], 'session', oop), 'foldToFlopCBet-low').interpretation, /when out of position/);
assert.match(single(implications([card('vpip', 10, 50, 'career', btn)], 'career', btn), 'vpip-low').interpretation, /from BTN/);
assert.match(single(implications([card('foldToThreeBet', 15, 15, 'session', vsHero)], 'session', vsHero), 'foldToThreeBet-high').interpretation, /against you/);
assert.deepStrictEqual(implications([card('vpip', 10, 50)], 'session', btn), [], 'Overall cannot fill a position context');
assert.deepStrictEqual(implications([card('vpip', 10, 50)], 'career'), [], 'Session cannot fill Career');
assert.deepStrictEqual(Strategic.derive({ observations: [], source: 'session', context: { position: 'UNKNOWN', situation: 'overall', opponentMode: 'overall' } }), [], 'unsupported context fails closed');
assert.deepStrictEqual(Strategic.derive({ observations: null, source: 'session', context: overall }), [], 'missing observations fail closed');
var valid = Insights.derive({ cards: [card('threeBet', 4, 15)], source: 'session', context: overall, tableSizeSupported: true })[0];
assert.deepStrictEqual(Strategic.derive({ observations: [Object.assign({}, valid, { stats: [] })], source: 'session', context: overall }), [], 'malformed structured observation fails closed');
assert.deepStrictEqual(Strategic.derive({ observations: [Object.assign({}, valid, { evidenceLevel: 1 })], source: 'session', context: overall }), [], 'forged Weak aggregate Evidence fails closed');
assert.deepStrictEqual(Strategic.derive({ observations: [Object.assign({}, valid, { context: btn })], source: 'session', context: overall }), [], 'mismatched observation context fails closed');
console.log('Strategic Implications supported singles, composites, precedence, context, contradiction, determinism, and malformed-input tests passed.');
