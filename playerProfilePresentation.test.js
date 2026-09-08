'use strict';

var assert = require('assert');
var presentation = require('./playerProfilePresentation');
var classifier = require('./playerProfileClassifier');
var fixtures = require('./testSupport/playerProfilePresentationFixtures');
var liveFixtures = require('./testSupport/playerProfileLiveValidationFixtures');
var syntheticShapes = require('./fixtures/player-profile/synthetic-calibration-shapes.v1.json');

function displayedSequence(outputs) {
  return outputs.map(function (output) { return output.visible ? output.archetype : 'hidden'; }).filter(function (value, index, values) {
    return index === 0 || value !== values[index - 1];
  });
}

function rawSequence(sequence) {
  return sequence.map(function (entry) { return entry.primary.archetype; }).filter(function (value, index, values) {
    return index === 0 || value !== values[index - 1];
  });
}

function summary(result) {
  var primary = result.primary;
  return {
    hands: result.support.hands,
    archetype: primary.archetype,
    status: primary.classificationStatus,
    best: primary.bestCandidate,
    score: primary.scores[primary.bestCandidate],
    margin: primary.scoreMargin,
    confidence: primary.confidence
  };
}

var outputs = {};
Object.keys(fixtures.cases).forEach(function (id) {
  outputs[id] = presentation.replay(fixtures.cases[id].sequence);
  assert.doesNotThrow(function () { JSON.stringify(outputs[id]); }, id + ' output is JSON-safe');
});

assert.deepStrictEqual(displayedSequence(outputs.D1), ['hidden', 'Loose Passive'], 'D1 reveals the stable early Loose Passive control after bounded persistence');
assert.strictEqual(outputs.D1[2].sinceHands, 51);
assert.deepStrictEqual(displayedSequence(outputs.D2), ['TAG'], 'D2 immediately reveals a strong mature TAG');
assert.deepStrictEqual(Object.keys(outputs.D2[0].rawScores), ['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac'], 'presentation carries a fixed seven-archetype score map');
assert.strictEqual(outputs.D2[0].rawScores.TAG, fixtures.cases.D2.sequence[0].primary.scores.TAG, 'presentation carries the classifier-owned TAG score without recalculation or normalization');
assert.strictEqual(outputs.D2[0].rawScores.Nit, fixtures.cases.D2.sequence[0].primary.scores.Nit, 'presentation carries the classifier-owned Nit score without recalculation or normalization');
assert.deepStrictEqual(displayedSequence(outputs.D3), ['hidden'], 'D3 mature TAG/Tight-Passive raw crossings never visibly flicker');
assert.deepStrictEqual(displayedSequence(outputs.D4), ['TAG'], 'D4 established TAG is held across one-hand TAG/Nit boundary uncertainty');
assert.ok(outputs.D4.some(function (entry) { return entry.status === 'visible_holding_uncertain'; }));
assert.deepStrictEqual(displayedSequence(outputs.D5), ['hidden', 'Tight Passive'], 'D5 reveals Tight Passive once and holds it across one-hand uncertainty');
assert.deepStrictEqual(displayedSequence(outputs.D6), ['TAG', 'Loose Passive'], 'D6 genuine sustained style transition eventually replaces the visible label');
assert.strictEqual(outputs.D6.slice(-1)[0].sinceHands, 132);
assert.deepStrictEqual(rawSequence(fixtures.cases.D7.sequence), ['LAG', 'Maniac', 'LAG']);
assert.deepStrictEqual(displayedSequence(outputs.D7), ['hidden', 'LAG'], 'D7 early LAG/Maniac spike is never shown as visible flicker');
assert.deepStrictEqual(displayedSequence(outputs.D8), ['Maniac'], 'D8 mature strong R3 Maniac remains revealable without delay');

// D7 and D8 are tied to unchanged raw-classifier results, not hand-authored alternative semantics.
var actualT5 = liveFixtures.transitions.T5.map(function (stats) { return summary(classifier.classify(stats)); });
var expectedT5 = fixtures.cases.D7.sequence.map(function (entry) {
  return {
    hands: entry.hands,
    archetype: entry.primary.archetype,
    status: entry.primary.classificationStatus,
    best: entry.primary.bestCandidate,
    score: entry.primary.scores[entry.primary.bestCandidate],
    margin: entry.primary.scoreMargin,
    confidence: entry.primary.confidence
  };
});
assert.deepStrictEqual(actualT5, expectedT5, 'D7 preserves the exact T5 raw classifier sequence');
var r3 = syntheticShapes.cases.find(function (entry) { return entry.id === 'R3'; });
var actualR3 = summary(classifier.classify(r3.stats));
var expectedR3 = fixtures.cases.D8.sequence[0];
assert.deepStrictEqual(actualR3, {
  hands: expectedR3.hands,
  archetype: expectedR3.primary.archetype,
  status: expectedR3.primary.classificationStatus,
  best: expectedR3.primary.bestCandidate,
  score: expectedR3.primary.scores[expectedR3.primary.bestCandidate],
  margin: expectedR3.primary.scoreMargin,
  confidence: expectedR3.primary.confidence
}, 'D8 preserves the exact mature R3 raw Maniac result');

// Sustained ambiguity eventually removes a held label; it is not frozen forever.
var raw = fixtures.raw;
var sustainedUnknown = presentation.replay([
  raw(80, 'TAG', 'supported', 'TAG', 0.65, 0.22, 0.75, 'Nit'),
  raw(82, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.45, 0.05, 0.55, 'Nit'),
  raw(84, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.44, 0.05, 0.54, 'Nit'),
  raw(88, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.43, 0.04, 0.53, 'Nit'),
  raw(90, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.42, 0.03, 0.52, 'Nit')
]);
assert.strictEqual(sustainedUnknown[1].archetype, 'TAG', 'short uncertainty holds the established label');
assert.strictEqual(sustainedUnknown.slice(-1)[0].visible, false, 'sustained uncertainty eventually becomes neutral/hidden');
assert.strictEqual(sustainedUnknown.slice(-1)[0].reason, 'sustained_raw_uncertainty');

var unsupported = presentation.resolveDisplayedProfile(raw(100, 'Unknown / Unsupported', 'unsupported', null, 0, 0, 0), outputs.D2[0]);
assert.strictEqual(unsupported.visible, false, 'unsupported raw state fails closed immediately');
assert.strictEqual(unsupported.status, 'hidden_unsupported');

// A simple 40-hand/raw-supported policy visibly follows every D4 crossing; the combined policy does not.
var simpleD4 = fixtures.cases.D4.sequence.map(function (entry) {
  return entry.hands >= 40 && entry.primary.classificationStatus === 'supported' ? entry.primary.archetype : 'hidden';
}).filter(function (value, index, values) { return index === 0 || value !== values[index - 1]; });
assert.ok(simpleD4.length > displayedSequence(outputs.D4).length, 'combined policy is materially more stable than minimum-hands-only gating');

var original = JSON.stringify(fixtures.cases.D6.sequence);
presentation.replay(fixtures.cases.D6.sequence);
assert.strictEqual(JSON.stringify(fixtures.cases.D6.sequence), original, 'presentation replay never mutates raw profiles');
assert.ok(Object.isFrozen(presentation.DEFAULT_POLICY), 'default policy is immutable');

console.log('Player-profile presentation D1-D8, persistence, hold, replacement, sustained Unknown, raw parity, and immutability passed:', JSON.stringify(Object.keys(outputs).reduce(function (report, id) {
  report[id] = { raw: rawSequence(fixtures.cases[id].sequence), displayed: displayedSequence(outputs[id]) };
  return report;
}, {})));
