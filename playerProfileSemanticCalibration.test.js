'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');
var fixtures = require('./testSupport/playerProfileSemanticCalibrationFixtures');

var r7 = fixtures.cases.find(function (entry) { return entry.id === 'R7'; });
var legacyRequirements = {
  'Calling Station': {
    anyPositiveMembership: ['foldToFlopCBetRate', 'wtsdRate'],
    reason: 'calling_station_requires_supported_stickiness_evidence'
  }
};
var legacy = classifier.classify(r7.stats, { config: { archetypeRequirements: legacyRequirements } });
assert.strictEqual(legacy.primary.bestCandidate, 'Nit', 'legacy positive-membership average reproduces the real defect');
assert.strictEqual(legacy.primary.runnerUp, 'Loose Passive');
assert.strictEqual(legacy.primary.scores.Nit, 0.3567);
assert.strictEqual(legacy.primary.scores['Loose Passive'], 0.2926);
assert.strictEqual(legacy.primary.scoreMargin, 0.0641);
assert.strictEqual(legacy.primary.confidence, 0.5083);

var report = {};
fixtures.cases.forEach(function (entry) {
  var result = classifier.classify(entry.stats);
  assert.strictEqual(result.primary.archetype, entry.expected.primary, entry.id + ' primary');
  assert.strictEqual(result.primary.bestCandidate, entry.expected.best, entry.id + ' leading semantic candidate');
  report[entry.id] = {
    primary: result.primary.archetype,
    bestCandidate: result.primary.bestCandidate,
    runnerUp: result.primary.runnerUp,
    bestScore: result.primary.scores[result.primary.bestCandidate],
    margin: result.primary.scoreMargin,
    confidence: result.primary.confidence
  };
});

var corrected = classifier.classify(r7.stats);
assert.notStrictEqual(corrected.primary.bestCandidate, 'Nit', 'ultra-loose VPIP excludes Nit from semantic leadership');
assert.notStrictEqual(corrected.primary.bestCandidate, 'Tight Passive', 'ultra-loose VPIP excludes Tight Passive from semantic leadership');
assert.strictEqual(corrected.primary.bestCandidate, 'Loose Passive');
assert.strictEqual(corrected.primary.archetype, 'Unknown / Uncertain', 'unchanged global score gate keeps the weak result uncertain');
assert.strictEqual(corrected.primary.scores.Nit, 0);
assert.strictEqual(corrected.primary.scores['Tight Passive'], 0);
assert.strictEqual(corrected.primary.scores['Loose Passive'], 0.2926, 'compatible Loose Passive positive-membership geometry is not rescaled');
assert.deepStrictEqual(corrected.primary.scoreDiagnostics.Nit.semanticEligibility.contradictoryFeatures, ['vpipRate']);
assert.strictEqual(corrected.primary.scoreDiagnostics.Nit.semanticEligibility.reason, 'nit_requires_tight_vpip_compatibility');
assert.strictEqual(corrected.primary.scoreDiagnostics['Calling Station'].semanticEligibility.reason, 'calling_station_requires_supported_stickiness_evidence', 'Calling Station retains its existing evidence requirement');

assert.deepStrictEqual({
  vpipRate: corrected.features.vpipRate.stabilizedRate,
  pfrRate: corrected.features.pfrRate.stabilizedRate,
  vpipPfrGap: corrected.features.vpipPfrGap.stabilizedRate,
  pfrVpipRatio: corrected.features.pfrVpipRatio.stabilizedRate,
  aggressionFrequency: corrected.features.aggressionFrequency.stabilizedRate,
  aggressionFactor: corrected.features.aggressionFactor.stabilizedRate,
  threeBetRate: corrected.features.threeBetRate.stabilizedRate,
  foldToFlopCBetRate: corrected.features.foldToFlopCBetRate.stabilizedRate,
  wtsdRate: corrected.features.wtsdRate.stabilizedRate,
  wsdRate: corrected.features.wsdRate.stabilizedRate
}, {
  vpipRate: 0.6224,
  pfrRate: 0.0943,
  vpipPfrGap: 0.5281,
  pfrVpipRatio: 0.1515,
  aggressionFrequency: 0.5162,
  aggressionFactor: 1.067,
  threeBetRate: 0.0351,
  foldToFlopCBetRate: 0.5714,
  wtsdRate: 0.2755,
  wsdRate: 0.525
}, 'R7 reconstructs the sanitized real stabilized feature shape exactly');

var before = classifier.scoreDecomposition(r7.stats, { config: { archetypeRequirements: legacyRequirements } });
var after = classifier.scoreDecomposition(r7.stats);
assert.strictEqual(before.archetypes.Nit.weightedScore, 3.0189);
assert.strictEqual(before.archetypes.Nit.normalizationDenominator, 8.4636);
assert.strictEqual(before.archetypes['Loose Passive'].weightedScore, 3.0931);
assert.strictEqual(before.archetypes['Loose Passive'].normalizationDenominator, 10.5701);
assert.strictEqual(after.archetypes.Nit.unadjustedScore, 0.3567, 'diagnostics retain positive evidence before semantic exclusion');
assert.strictEqual(after.archetypes.Nit.finalScore, 0);
assert.strictEqual(after.archetypes['Loose Passive'].finalScore, 0.2926);
assert.ok(after.archetypes.Nit.evidence.every(function (entry) {
  return typeof entry.effectiveWeight === 'number' && typeof entry.weightedContribution === 'number';
}), 'decomposition exposes every supported factor, normalization weight, and contribution');
assert.doesNotThrow(function () { JSON.stringify(after); }, 'score decomposition is JSON-safe');
assert.strictEqual(JSON.stringify(after).includes('playerId'), false, 'decomposition contains no player identity');

assert.strictEqual(classifier.DEFAULT_CONFIG.minimumPrimaryScore, 0.42, 'global score gate is unchanged');
assert.strictEqual(classifier.DEFAULT_CONFIG.minimumScoreMargin, 0.08, 'global margin gate is unchanged');
assert.ok(Object.keys(classifier.DEFAULT_CONFIG.archetypes).every(function (name) {
  return classifier.DEFAULT_CONFIG.archetypeRequirements[name].allPositiveMembership[0] === 'vpipRate';
}), 'every archetype uses its existing VPIP curve as a defining compatibility dimension');

console.log('Player-profile semantic contradiction R7-R11 and score decomposition passed:', JSON.stringify(report));
