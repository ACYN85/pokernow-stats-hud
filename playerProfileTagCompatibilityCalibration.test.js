'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');

function profile(vpip, pfr, tableSize, liveLikeAggression) {
  var hands = 100;
  var stats = {
    handsPlayed: hands,
    vpipHands: Math.round(vpip * hands), vpipOpportunities: hands,
    pfrHands: Math.round(pfr * hands), pfrOpportunities: hands,
    preflopTableSizeSum: tableSize * hands,
    preflopTableSizeOpportunities: hands
  };
  if (liveLikeAggression) {
    // 30 aggressive actions / 40 decisions is AF 3.0; 5/50 is 10% 3Bet.
    stats.afDetails = { bets: 30, raises: 0, calls: 10 };
    stats.threeBetMade = 5;
    stats.threeBetOpportunities = 50;
  }
  return stats;
}

function withoutTagRamp() {
  var requirements = JSON.parse(JSON.stringify(classifier.DEFAULT_CONFIG.archetypeRequirements));
  delete requirements.TAG.scoreCompatibilityRamp;
  return { config: { archetypeRequirements: requirements } };
}

function metrics(stats, options) {
  var result = classifier.classify(stats, options);
  var decomposition = classifier.scoreDecomposition(stats, options);
  var tag = decomposition.archetypes.TAG;
  var vpip = tag.evidence.find(function (entry) { return entry.feature === 'vpipRate'; });
  return {
    primary: result.primary,
    stabilizedVpip: result.features.vpipRate.stabilizedRate,
    stabilizedPfr: result.features.pfrRate.stabilizedRate,
    tagVpipMembership: vpip.membership,
    originalTagScore: tag.unadjustedScore,
    modifiedTagScore: tag.finalScore,
    compatibility: tag.scoreCompatibility
  };
}

var matrix = [];
[
  [0.20, 0.16], [0.24, 0.18], [0.27, 0.18], [0.30, 0.16], [0.30, 0.22], [0.35, 0.25]
].forEach(function (shape) {
  [9, 6].forEach(function (tableSize) {
    [false, true].forEach(function (liveLikeAggression) {
      var stats = profile(shape[0], shape[1], tableSize, liveLikeAggression);
      var before = metrics(stats, withoutTagRamp());
      var after = metrics(stats);
      matrix.push({
        id: tableSize + 'h ' + Math.round(shape[0] * 100) + '/' + Math.round(shape[1] * 100) + (liveLikeAggression ? ' live-like' : ' neutral'),
        before: before,
        after: after
      });
      assert.strictEqual(after.stabilizedVpip, before.stabilizedVpip, 'ramp does not change VPIP shrinkage');
      assert.strictEqual(after.stabilizedPfr, before.stabilizedPfr, 'ramp does not change PFR shrinkage');
      assert.strictEqual(after.tagVpipMembership, before.tagVpipMembership, 'ramp does not change table-adjusted membership curves');
      assert.strictEqual(after.originalTagScore, before.originalTagScore, 'decomposition retains the original normalized TAG score');
      if (after.tagVpipMembership > 0) {
        assert.strictEqual(after.compatibility.applied, true, 'supported TAG VPIP receives the compatibility ramp');
        assert.ok(after.modifiedTagScore <= after.originalTagScore, 'ramp only limits TAG compensation');
      }
    });
  });
});

function caseById(id) {
  return matrix.find(function (entry) { return entry.id === id; });
}

assert.strictEqual(caseById('9h 20/16 live-like').after.primary.archetype, 'TAG');
assert.strictEqual(caseById('9h 24/18 live-like').after.primary.archetype, 'TAG');
assert.strictEqual(caseById('9h 35/25 live-like').after.primary.archetype, 'LAG');
assert.strictEqual(caseById('6h 20/16 live-like').after.primary.archetype, 'Nit');
assert.strictEqual(caseById('6h 30/22 live-like').after.primary.archetype, 'TAG');
assert.strictEqual(caseById('6h 35/25 live-like').after.primary.archetype, 'TAG');

var liveThirtySixteen = caseById('9h 30/16 live-like');
assert.strictEqual(liveThirtySixteen.before.primary.archetype, 'TAG', 'baseline proves aggression could rescue weak full-ring TAG compatibility');
assert.strictEqual(liveThirtySixteen.after.primary.archetype, 'Unknown / Uncertain', 'ramp rejects the live-like 30/16 full-ring TAG result');
assert.ok(liveThirtySixteen.after.modifiedTagScore < classifier.DEFAULT_CONFIG.minimumPrimaryScore);

[
  [0.28, 0.17, 'TAG'],
  [0.29, 0.16, 'Unknown / Uncertain'],
  [0.30, 0.18, 'Unknown / Uncertain'],
  [0.30, 0.20, 'TAG'],
  [0.30, 0.22, 'Unknown / Uncertain']
].forEach(function (shape) {
  var after = metrics(profile(shape[0], shape[1], 9, true));
  assert.strictEqual(after.primary.archetype, shape[2], 'full-ring ' + Math.round(shape[0] * 100) + '/' + Math.round(shape[1] * 100) + ' preserves the calibrated TAG/LAG distinction');
});

console.log('TAG VPIP compatibility calibration matrix passed:', JSON.stringify(matrix.map(function (entry) {
  return {
    id: entry.id,
    vpip: entry.after.stabilizedVpip,
    pfr: entry.after.stabilizedPfr,
    membership: entry.after.tagVpipMembership,
    originalTag: entry.after.originalTagScore,
    modifiedTag: entry.after.modifiedTagScore,
    best: entry.after.primary.bestCandidate,
    runnerUp: entry.after.primary.runnerUp,
    margin: entry.after.primary.scoreMargin,
    primary: entry.after.primary.archetype
  };
})));
