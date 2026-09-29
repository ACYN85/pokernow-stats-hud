'use strict';
var assert = require('assert');
var Evidence = require('./statEvidence.js');
var Personal = require('./personalLeakAnalysis.js');
var overall = { position: null, situation: 'overall', opponentMode: 'overall' };
var ip = { position: null, situation: 'ip', opponentMode: 'overall' };
var oop = { position: null, situation: 'oop', opponentMode: 'overall' };
var btn = { position: 'BTN', situation: 'overall', opponentMode: 'overall' };
var bb = { position: 'BB', situation: 'overall', opponentMode: 'overall' };
function card(id, made, count, source, context) {
  source = source || 'session'; context = context || overall;
  return { id: id, numerator: made, denominator: count,
    evidence: Evidence.evaluateStatEvidence({ statKey: id, numerator: made, opportunities: count, source: source, context: context }) };
}
function derive(cards, source, context, comparisons) { return Personal.derive({ cards: cards, source: source || 'session', context: context || overall, comparisons: comparisons, tableSizeSupported: true }); }
function ids(items) { return items.map(function (item) { return item.id; }); }
function slice(context, cards, source) { return { context: context, cards: cards, source: source || 'session', tableSizeSupported: true }; }

assert.deepStrictEqual(ids(derive([card('threeBet', 0, 15)])), ['self-threeBet-low'], 'Moderate qualifies');
assert.deepStrictEqual(ids(derive([card('threeBet', 0, 40)])), ['self-threeBet-low'], 'Strong qualifies');
assert.deepStrictEqual(derive([card('threeBet', 0, 14)]), [], 'Weak suppressed');
assert.deepStrictEqual(derive([card('threeBet', 0, 4)]), [], 'Insufficient suppressed');
assert.deepStrictEqual(derive([card('threeBet', 0, 20)]).length, 1, 'same rate appears at Moderate');
assert.deepStrictEqual(derive([card('threeBet', 0, 10)]), [], 'same rate hidden at Weak');
[
  ['threeBet', 5, 12], ['foldToThreeBet', 38, 62], ['flopCBet', 42, 65],
  ['foldToFlopCBet', 34, 58], ['wtsd', 22, 34]
].forEach(function (values) {
  var id = values[0]; var low = values[1]; var high = values[2];
  assert.deepStrictEqual(ids(derive([card(id, low, 100)])), ['self-' + id + '-low'], id + ' low boundary');
  assert.deepStrictEqual(ids(derive([card(id, high, 100)])), ['self-' + id + '-high'], id + ' high boundary');
  assert.deepStrictEqual(derive([card(id, Math.round((low + high) / 2), 100)]), [], id + ' middle suppressed');
});
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 20, 100)])), ['self-vpip-pfr-gap'], 'supported gap');
assert.deepStrictEqual(derive([card('vpip', 30, 100), card('pfr', 20, 100)]), [], 'small gap');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100), card('pfr', 10, 49)])), ['self-vpip-high'], 'unsupported PFR cannot form gap');
assert.deepStrictEqual(ids(derive([card('vpip', 20, 100)])), ['self-vpip-low'], 'low participation');
assert.deepStrictEqual(ids(derive([card('vpip', 40, 100)])), ['self-vpip-high'], 'high participation');
assert.deepStrictEqual(derive([card('vpip', 30, 100)]), [], 'middle participation');
[
  [[card('vpip', 20, 100)], 'Consider widening preflop participation', /observed VPIP is low/],
  [[card('vpip', 40, 100)], 'Review whether you enter too many pots', /observed VPIP is high/],
  [[card('vpip', 40, 100), card('pfr', 20, 100)], 'Review passive preflop entries', /more pots than you raise/],
  [[card('foldToThreeBet', 70, 100)], 'Review whether you overfold to 3-bets', /fold to 3-bets frequently/],
  [[card('foldToThreeBet', 20, 100)], 'Review whether you continue too widely vs 3-bets', /continue against 3-bets frequently/],
  [[card('foldToFlopCBet', 70, 100)], 'Review whether you overfold to flop CBets', /fold to flop CBets frequently/],
  [[card('foldToFlopCBet', 20, 100)], 'Review whether you continue too widely on flops', /continue against flop CBets frequently/],
  [[card('wtsd', 40, 100)], 'Review whether you call down too often', /reach showdown frequently/],
  [[card('wtsd', 10, 100)], 'Review whether you give up too early', /reach showdown relatively infrequently/]
].forEach(function (testCase) {
  var result = derive(testCase[0])[0];
  assert.strictEqual(result.reviewTitle, testCase[1], 'self review title leads with a possible change');
  assert.match(result.reason, testCase[2], 'self review reason is concise');
  assert.ok(result.reviewTitle.length < 60 && result.reason.length < 100);
});
assert.deepStrictEqual(derive([card('wsd', 5, 40)]), [], 'W$SD alone has no verdict');
assert.deepStrictEqual(derive([card('af', 30, 40)]), [], 'AF has no first-pass rule');
var showdown = derive([card('wtsd', 35, 100), card('wsd', 18, 40)]);
assert.deepStrictEqual(ids(showdown), ['self-wtsd-high']);
assert.deepStrictEqual(showdown[0].stats.map(function (item) { return item.statKey; }), ['wtsd', 'wsd'], 'supported W$SD is context only');

var pairs = [slice(ip, [card('flopCBet', 80, 100, 'session', ip), card('foldToFlopCBet', 70, 100, 'session', ip)]),
  slice(oop, [card('flopCBet', 50, 100, 'session', oop), card('foldToFlopCBet', 40, 100, 'session', oop)]),
  slice(btn, [card('vpip', 50, 100, 'session', btn)]), slice(bb, [card('vpip', 20, 100, 'session', bb)])];
var compared = derive([], 'session', overall, pairs);
assert.deepStrictEqual(compared.map(function (item) { return item.family; }), ['positionVpip', 'situationCBet', 'situationFoldToCBet']);
assert.deepStrictEqual(compared[0].comparedContexts, [btn, bb], 'exact labels retained');
assert.deepStrictEqual(compared[1].comparedContexts, [ip, oop], 'IP/OOP retained');
assert.strictEqual(compared[0].reviewTitle, 'Review your position-based participation gap');
assert.match(compared[0].reason, /higher from BTN than BB/);
assert.strictEqual(compared[1].reviewTitle, 'Review your IP\/OOP CBet gap');
assert.match(compared[1].reason, /higher IP than OOP/);
assert.deepStrictEqual(ids(derive([], 'session', overall, pairs.slice().reverse())), ids(compared), 'input order does not affect signal order');
assert.strictEqual(new Set(compared.map(function (item) { return item.family; })).size, compared.length, 'one signal per family');
assert.deepStrictEqual(derive([], 'session', overall, [pairs[0]]), [], 'missing comparison context');
assert.deepStrictEqual(derive([], 'session', overall, [pairs[0], slice(oop, [card('flopCBet', 7, 14, 'session', oop)])]), [], 'Weak comparison side');
assert.deepStrictEqual(ids(derive([], 'session', overall, [slice(ip, [card('flopCBet', 12, 15, 'session', ip)]), slice(oop, [card('flopCBet', 8, 15, 'session', oop)])])), ['self-situationCBet-IP-OOP'], 'both Moderate qualify');
assert.deepStrictEqual(derive([], 'session', overall, [slice(ip, [card('flopCBet', 70, 100, 'session', ip)]), slice(oop, [card('flopCBet', 50, 100, 'session', oop)])]), [], 'small context delta');
assert.deepStrictEqual(derive([], 'session', overall, [slice(ip, [card('flopCBet', 80, 100)]), pairs[1]]), [], 'Overall cannot fill IP');
assert.deepStrictEqual(derive([], 'career', overall, pairs), [], 'Session slices cannot fill Career');
assert.deepStrictEqual(ids(derive([], 'career', overall, [slice(ip, [card('flopCBet', 80, 100, 'career', ip)], 'career'), slice(oop, [card('flopCBet', 50, 100, 'career', oop)], 'career')])), ['self-situationCBet-IP-OOP'], 'Career is independent');
assert.deepStrictEqual(derive([], 'session', overall, [slice({ position: 'BTN', situation: 'ip', opponentMode: 'overall' }, [card('vpip', 50, 100)])]), [], 'invalid mixed context');
assert.deepStrictEqual(derive([null, {}, { id: 'threeBet', numerator: -1, denominator: 20 }]), [], 'malformed input');
assert.deepStrictEqual(derive([card('threeBet', 0, 0)]), [], 'zero opportunities');
assert.deepStrictEqual(derive([card('threeBet', 0, 40)], 'career'), [], 'source mismatch');
var forged = card('threeBet', 0, 40); forged.denominator = 39;
assert.deepStrictEqual(derive([forged]), [], 'Evidence support count must match');
assert.deepStrictEqual(Personal.derive({ cards: [card('threeBet', 0, 40)], source: 'session' }), [], 'missing context cannot borrow Overall');
console.log('Personal Leak Analysis pure Evidence, boundaries, comparison, and robustness regressions passed.');
