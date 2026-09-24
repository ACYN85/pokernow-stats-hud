'use strict';
var assert = require('assert');
var evidence = require('./statEvidence.js');

function evaluate(statKey, support, made) {
  if (statKey === 'hands') return evidence.evaluateStatEvidence({ statKey: statKey, hands: support, numerator: support });
  if (statKey === 'af') return evidence.evaluateStatEvidence({ statKey: statKey, aggressiveActions: made, calls: support - made, numerator: made, denominator: support - made });
  return evidence.evaluateStatEvidence({ statKey: statKey, numerator: made || 0, opportunities: support, denominator: support });
}

assert.deepStrictEqual([0, 19, 20, 49, 50, 99, 100].map(function (count) { return evaluate('hands', count).status; }),
  ['insufficient', 'insufficient', 'weak', 'weak', 'moderate', 'moderate', 'strong'], 'Hands uses centralized hand thresholds');

['vpip', 'pfr'].forEach(function (statKey) {
  assert.strictEqual(evaluate(statKey, 19, 19).status, 'insufficient');
  assert.strictEqual(evaluate(statKey, 20, 0).status, 'weak');
  assert.strictEqual(evaluate(statKey, 50, 17).status, 'moderate');
  assert.strictEqual(evaluate(statKey, 100, 31).status, 'strong');
  assert.strictEqual(evaluate(statKey, 100, 100).status, 'strong', statKey + ' strength depends on support, not effect extremity');
});

['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (statKey) {
  assert.strictEqual(evaluate(statKey, 2, 2).status, 'insufficient', statKey + ' extreme tiny sample stays insufficient');
  assert.strictEqual(evaluate(statKey, 5, 0).status, 'weak');
  assert.strictEqual(evaluate(statKey, 15, 7).status, 'moderate');
  assert.strictEqual(evaluate(statKey, 40, 16).status, 'strong');
});

var af = evidence.evaluateStatEvidence({ statKey: 'af', aggressiveActions: 18, calls: 12, numerator: 18, denominator: 12 });
assert.strictEqual(af.supportCount, 30, 'AF support is aggressive actions plus calls, not the calls denominator alone');
assert.strictEqual(af.supportType, 'observed_postflop_aggression_actions');
assert.strictEqual(af.status, 'moderate');
assert.strictEqual(evaluate('af', 9, 9).status, 'insufficient');
assert.strictEqual(evaluate('af', 75, 20).status, 'strong');

var zero = evaluate('threeBet', 0, 0);
assert.strictEqual(zero.status, 'insufficient');
assert.strictEqual(zero.label, 'Insufficient', 'the internal evidence label remains available to analysis consumers');
assert.strictEqual(zero.compactSupportText, 'No opportunities');
assert.ok(zero.explanation.includes('More observations are needed before an evidence-strength label is shown.'));
assert.ok(zero.explanation.includes('not probability or proof'));
assert.strictEqual(evidence.meets(zero, 'weak'), false, 'zero opportunities never meet a positive evidence threshold');
var unavailable = evidence.evaluateStatEvidence({ statKey: 'vpip', available: false });
assert.strictEqual(unavailable.status, 'unavailable');
assert.strictEqual(unavailable.supportCount, null);
assert.strictEqual(evidence.meets(unavailable, 'insufficient'), false);
assert.strictEqual(evidence.evaluateStatEvidence({ statKey: 'unsupportedFutureStat', denominator: 100, numerator: 50 }).status, 'unavailable');

var sameValueSmall = evidence.evaluateStatEvidence({ statKey: 'foldToThreeBet', numerator: 2, opportunities: 4, denominator: 4 });
var sameValueLarge = evidence.evaluateStatEvidence({ statKey: 'foldToThreeBet', numerator: 20, opportunities: 40, denominator: 40 });
assert.strictEqual(sameValueSmall.status, 'insufficient');
assert.strictEqual(sameValueLarge.status, 'strong');
assert.strictEqual(evidence.meets(sameValueLarge, 'moderate'), true);
assert.ok(sameValueLarge.explanation.includes('not probability or proof'));

var context = evidence.evaluateStatEvidence({ statKey: 'threeBet', numerator: 3, opportunities: 15, source: 'career', context: { situation: 'ip', opponentMode: 'self' } });
assert.strictEqual(context.source, 'career');
assert.deepStrictEqual(context.context, { situation: 'ip', opponentMode: 'self' });
assert.strictEqual(context.status, 'moderate');

console.log('Stat evidence thresholds, support bases, tiny-extreme, zero, unavailable, context, and future-policy tests passed.');
