'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');
var fixture = require('./fixtures/player-profile/synthetic-calibration-shapes.v1.json');

var expected = {
  R1: { primary: 'Loose Passive', best: 'Loose Passive', runnerUp: 'Calling Station', score: 0.4487, margin: 0.1333, confidence: 0.6358 },
  R2: { primary: 'LAG', best: 'LAG', runnerUp: 'Loose Passive', score: 0.5055, margin: 0.1841, confidence: 0.7017 },
  R3: { primary: 'Maniac', best: 'Maniac', runnerUp: 'LAG', score: 0.8148, margin: 0.8148, confidence: 0.8929 },
  R4: { primary: 'Loose Passive', best: 'Loose Passive', runnerUp: 'LAG', score: 0.7116, margin: 0.5632, confidence: 0.8317 },
  R5: { primary: 'Unknown / Uncertain', best: 'Loose Passive', runnerUp: 'Maniac', score: 0.3658, margin: 0.2246, confidence: 0.59 },
  R6: { primary: 'Unknown / Uncertain', best: 'LAG', runnerUp: 'Loose Passive', score: 0.3988, margin: 0.247, confidence: 0.59 }
};

assert.strictEqual(fixture.version, 1);
assert.strictEqual(fixture.cases.length, 6);
assert.strictEqual(JSON.stringify(fixture).includes('www.pokernow.com'), false, 'fixture excludes session metadata');

var report = {};
fixture.cases.forEach(function (entry) {
  var result = classifier.classify(entry.stats);
  var primary = result.primary;
  var target = expected[entry.id];
  assert.ok(target, entry.id + ' has an expected calibrated result');
  assert.strictEqual(primary.archetype, target.primary, entry.id + ' primary');
  assert.strictEqual(primary.bestCandidate, target.best, entry.id + ' best candidate');
  assert.strictEqual(primary.runnerUp, target.runnerUp, entry.id + ' runner-up');
  assert.strictEqual(primary.scores[primary.bestCandidate], target.score, entry.id + ' best score');
  assert.strictEqual(primary.scoreMargin, target.margin, entry.id + ' margin');
  assert.strictEqual(primary.confidence, target.confidence, entry.id + ' confidence');
  assert.deepStrictEqual(result.tags.map(function (tag) { return tag.tag; }), entry.baseline.tags, entry.id + ' secondary tags are unchanged by primary calibration');

  var aggression = result.features.aggressionFrequency;
  var decisions = entry.stats.afDetails.bets + entry.stats.afDetails.raises + entry.stats.afDetails.calls;
  if (decisions > 0) {
    var rawCallShare = entry.stats.afDetails.calls / decisions;
    assert.ok(Math.abs((aggression.rawRate + rawCallShare) - 1) < 0.0001, entry.id + ' proves callShare is the exact complement of aggressionFrequency');
  }

  report[entry.id] = {
    before: entry.baseline,
    after: {
      primary: primary.archetype,
      bestCandidate: primary.bestCandidate,
      runnerUp: primary.runnerUp,
      bestScore: primary.scores[primary.bestCandidate],
      scoreMargin: primary.scoreMargin,
      confidence: primary.confidence,
      tags: result.tags.map(function (tag) { return tag.tag; })
    },
    stabilizedFeatures: Object.keys(result.features).reduce(function (features, name) {
      var feature = result.features[name];
      features[name] = { value: feature.stabilizedRate, supported: feature.supported, opportunities: feature.opportunities };
      return features;
    }, {})
  };
});

['R4', 'R5'].forEach(function (id) {
  var entry = fixture.cases.find(function (candidate) { return candidate.id === id; });
  var eligibility = classifier.classify(entry.stats).primary.scoreDiagnostics['Calling Station'].semanticEligibility;
  assert.strictEqual(eligibility.eligible, false, id + ' cannot assert Calling Station without supported positive stickiness evidence');
  assert.strictEqual(eligibility.reason, 'calling_station_requires_supported_stickiness_evidence');
});

var r6 = classifier.classify(fixture.cases.find(function (entry) { return entry.id === 'R6'; }).stats);
assert.strictEqual(r6.primary.scoreDiagnostics['Calling Station'].semanticEligibility.eligible, false);
assert.strictEqual(r6.primary.scoreDiagnostics['Calling Station'].semanticEligibility.reason, 'calling_station_requires_loose_vpip_compatibility', 'R6 fails the new defining loose-VPIP requirement before its existing stickiness requirement');

var r1 = classifier.classify(fixture.cases[0].stats);
assert.strictEqual(r1.primary.scoreDiagnostics['Calling Station'].semanticEligibility.eligible, true, 'R1 has supported FCB and WTSD evidence available for semantic comparison');
assert.strictEqual(r1.features.wtsdRate.stabilizedRate, 0.22, 'R1 selective showdown evidence remains a smooth scored observation');
assert.ok(r1.primary.scores['Loose Passive'] - r1.primary.scores['Calling Station'] >= classifier.DEFAULT_CONFIG.minimumScoreMargin, 'R1 overlap is resolved before applying the global margin gate');

assert.strictEqual(classifier.DEFAULT_CONFIG.minimumPrimaryScore, 0.42, 'global score gate remains unchanged');
assert.strictEqual(classifier.DEFAULT_CONFIG.minimumScoreMargin, 0.08, 'global margin gate remains unchanged');
assert.strictEqual(classifier.DEFAULT_CONFIG.priors.wtsdRate.strength, 24, 'WTSD shrinkage is unchanged');
assert.strictEqual(classifier.DEFAULT_CONFIG.priors.threeBetRate.strength, 30, '3Bet shrinkage is unchanged');
assert.strictEqual(classifier.DEFAULT_CONFIG.priors.aggressionFrequency.strength, 12, 'aggression shrinkage is unchanged');
assert.strictEqual(Object.prototype.hasOwnProperty.call(classifier.DEFAULT_CONFIG.priors, 'callShare'), false, 'redundant callShare is not introduced');

console.log('Synthetic player-profile calibration R1-R6 passed:', JSON.stringify(report));
