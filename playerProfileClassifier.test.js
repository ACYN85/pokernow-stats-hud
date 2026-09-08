'use strict';

var assert = require('assert');
var fs = require('fs');
var classifier = require('./playerProfileClassifier.js');

function base(overrides) {
  return Object.assign({
    playerId: 'synthetic-player',
    player: 'Synthetic Player',
    handsPlayed: 200,
    vpipHands: 56,
    vpipOpportunities: 200,
    pfrHands: 40,
    pfrOpportunities: 200,
    afDetails: { bets: 30, raises: 20, calls: 30 },
    threeBetMade: 5,
    threeBetOpportunities: 60,
    foldToThreeBet: 12,
    foldToThreeBetOpportunities: 24,
    flopCBetMade: 24,
    flopCBetOpportunities: 40,
    foldToFlopCBet: 16,
    foldToFlopCBetOpportunities: 36,
    wentToShowdown: 22,
    sawFlopForWTSD: 70,
    wonMoneyAtShowdown: 11,
    showdownsForWSD: 22
  }, overrides || {});
}

function archetype(stats) {
  return classifier.classify(stats).primary.archetype;
}

function hasTag(result, tag) {
  return result.tags.some(function (entry) { return entry.tag === tag; });
}

var profiles = {};

// P1-P7: clear primary archetypes with well-supported core evidence.
profiles.P1 = classifier.classify(base({ vpipHands: 28, pfrHands: 20, afDetails: { bets: 14, raises: 12, calls: 24 }, threeBetMade: 2 }));
profiles.P2 = classifier.classify(base({ vpipHands: 48, pfrHands: 40, afDetails: { bets: 38, raises: 27, calls: 35 }, threeBetMade: 5 }));
profiles.P3 = classifier.classify(base({ vpipHands: 80, pfrHands: 66, afDetails: { bets: 50, raises: 35, calls: 35 }, threeBetMade: 11 }));
profiles.P4 = classifier.classify(base({ vpipHands: 44, pfrHands: 16, afDetails: { bets: 10, raises: 10, calls: 40 }, threeBetMade: 2 }));
profiles.P5 = classifier.classify(base({ vpipHands: 100, pfrHands: 30, afDetails: { bets: 10, raises: 15, calls: 55 }, threeBetMade: 3 }));
profiles.P6 = classifier.classify(base({ vpipHands: 120, pfrHands: 24, afDetails: { bets: 7, raises: 8, calls: 55 }, foldToFlopCBet: 8, foldToFlopCBetOpportunities: 50, wentToShowdown: 50, sawFlopForWTSD: 100 }));
profiles.P7 = classifier.classify(base({ vpipHands: 160, pfrHands: 138, afDetails: { bets: 65, raises: 40, calls: 15 }, threeBetMade: 26, threeBetOpportunities: 80 }));

assert.strictEqual(profiles.P1.primary.archetype, 'Nit');
assert.strictEqual(profiles.P2.primary.archetype, 'TAG');
assert.strictEqual(profiles.P3.primary.archetype, 'LAG');
assert.strictEqual(profiles.P4.primary.archetype, 'Tight Passive');
assert.strictEqual(profiles.P5.primary.archetype, 'Loose Passive');
assert.strictEqual(profiles.P6.primary.archetype, 'Calling Station');
assert.strictEqual(profiles.P7.primary.archetype, 'Maniac');

// P8: total hands and core opportunity evidence are independently inadequate.
profiles.P8 = classifier.classify(base({ handsPlayed: 8, vpipHands: 3, vpipOpportunities: 8, pfrHands: 2, pfrOpportunities: 8 }));
assert.strictEqual(profiles.P8.primary.archetype, 'Unknown / Insufficient Sample');
assert.strictEqual(profiles.P8.primary.classificationStatus, 'insufficient_sample');

// P9/P10: the same eye-catching raw tendency has radically different support.
profiles.P9 = classifier.classify(base({ threeBetMade: 2, threeBetOpportunities: 2 }));
assert.strictEqual(profiles.P9.features.threeBetRate.rawRate, 1);
assert.ok(profiles.P9.features.threeBetRate.stabilizedRate < 0.20);
assert.strictEqual(profiles.P9.features.threeBetRate.supported, false);
assert.strictEqual(hasTag(profiles.P9, '3B Heavy'), false);

profiles.P10 = classifier.classify(base({ threeBetMade: 40, threeBetOpportunities: 80 }));
assert.strictEqual(profiles.P10.features.threeBetRate.rawRate, 0.5);
assert.ok(profiles.P10.features.threeBetRate.confidence > 0.7);
assert.strictEqual(hasTag(profiles.P10, '3B Heavy'), true);

// P11/P12: many hands never substitute for feature-specific opportunities.
profiles.P11 = classifier.classify(base({ foldToThreeBet: 1, foldToThreeBetOpportunities: 1 }));
assert.strictEqual(profiles.P11.support.hands, 200);
assert.strictEqual(profiles.P11.features.foldToThreeBetRate.supported, false);
assert.strictEqual(hasTag(profiles.P11, 'Folds to 3B'), false);

profiles.P12 = classifier.classify(base({ wentToShowdown: 4, sawFlopForWTSD: 4 }));
assert.strictEqual(profiles.P12.features.wtsdRate.supported, false);
assert.strictEqual(hasTag(profiles.P12, 'Showdown Heavy'), false);

// P13: weak TAG VPIP compatibility cannot be rescued by otherwise LAG-like aggression.
profiles.P13 = classifier.classify(base({ vpipHands: 64, pfrHands: 52, afDetails: { bets: 40, raises: 28, calls: 34 }, threeBetMade: 7 }));
assert.strictEqual(profiles.P13.primary.archetype, 'LAG');
assert.strictEqual(profiles.P13.primary.bestCandidate, 'LAG');
assert.strictEqual(profiles.P13.primary.runnerUp, 'TAG');
assert.strictEqual(profiles.P13.primary.scoreDiagnostics.TAG.scoreCompatibility.applied, true);
assert.ok(profiles.P13.primary.scoreDiagnostics.TAG.scoreCompatibility.scale < 1);

// P14/P15: a supported zero is real evidence; no denominator is not zero percent.
profiles.P14 = classifier.classify(base({ threeBetMade: 0, threeBetOpportunities: 50 }));
assert.strictEqual(profiles.P14.features.threeBetRate.rawRate, 0);
assert.strictEqual(profiles.P14.features.threeBetRate.supported, true);
assert.strictEqual(hasTag(profiles.P14, '3B Light'), true);

profiles.P15 = classifier.classify(base({ threeBetMade: 0, threeBetOpportunities: 0 }));
assert.strictEqual(profiles.P15.features.threeBetRate.rawRate, null);
assert.strictEqual(profiles.P15.features.threeBetRate.supported, false);
assert.strictEqual(profiles.P15.features.threeBetRate.unsupportedReason, 'zero_denominator');
assert.strictEqual(hasTag(profiles.P15, '3B Light'), false);

// P16: supported postflop tendencies may distinguish Calling Station from the
// broader Loose Passive profile, while remaining secondary evidence.
profiles.P16 = classifier.classify(base({ vpipHands: 118, pfrHands: 26, afDetails: { bets: 8, raises: 9, calls: 58 }, foldToFlopCBet: 7, foldToFlopCBetOpportunities: 50, wentToShowdown: 48, sawFlopForWTSD: 100 }));
assert.strictEqual(profiles.P16.primary.archetype, 'Calling Station');
assert.strictEqual(hasTag(profiles.P16, 'Sticky vs CBet'), true);
assert.strictEqual(hasTag(profiles.P16, 'Showdown Heavy'), true);

// P17: unsupported 3/3 W$SD cannot redefine an otherwise aggressive profile.
profiles.P17 = classifier.classify(base({ vpipHands: 80, pfrHands: 66, afDetails: { bets: 50, raises: 35, calls: 35 }, threeBetMade: 11, wonMoneyAtShowdown: 3, showdownsForWSD: 3 }));
assert.strictEqual(profiles.P17.primary.archetype, 'LAG');
assert.strictEqual(profiles.P17.features.wsdRate.supported, false);
assert.strictEqual(hasTag(profiles.P17, 'High W$SD'), false);

// P18: an extreme profile with ample support is a supported Maniac result.
profiles.P18 = classifier.classify(base({ handsPlayed: 400, vpipHands: 340, vpipOpportunities: 400, pfrHands: 300, pfrOpportunities: 400, afDetails: { bets: 105, raises: 55, calls: 10 }, threeBetMade: 50, threeBetOpportunities: 100 }));
assert.strictEqual(profiles.P18.primary.archetype, 'Maniac');
assert.strictEqual(profiles.P18.primary.classificationStatus, 'supported');
assert.strictEqual(hasTag(profiles.P18, '3B Heavy'), true);

// Every secondary rule is independently exercised with adequate support.
[
  ['Folds to 3B', { foldToThreeBet: 20, foldToThreeBetOpportunities: 24 }],
  ['Sticky vs 3B', { foldToThreeBet: 2, foldToThreeBetOpportunities: 24 }],
  ['High CBet', { flopCBetMade: 35, flopCBetOpportunities: 40 }],
  ['Low CBet', { flopCBetMade: 8, flopCBetOpportunities: 40 }],
  ['Sticky vs CBet', { foldToFlopCBet: 5, foldToFlopCBetOpportunities: 40 }],
  ['Fit-or-Fold', { foldToFlopCBet: 32, foldToFlopCBetOpportunities: 40 }],
  ['Showdown Heavy', { wentToShowdown: 40, sawFlopForWTSD: 70 }],
  ['Showdown Selective', { wentToShowdown: 8, sawFlopForWTSD: 70 }],
  ['High W$SD', { wonMoneyAtShowdown: 18, showdownsForWSD: 24 }],
  ['Low W$SD', { wonMoneyAtShowdown: 6, showdownsForWSD: 24 }]
].forEach(function (tagCase) {
  var result = classifier.classify(base(tagCase[1]));
  var tag = result.tags.find(function (entry) { return entry.tag === tagCase[0]; });
  assert.ok(tag, tagCase[0] + ' is emitted with adequate independent support');
  ['rawRate', 'stabilizedRate', 'opportunities', 'confidence'].forEach(function (field) {
    assert.strictEqual(typeof tag[field], 'number', tagCase[0] + ' retains ' + field);
  });
});

// Feature contract, JSON safety, determinism, configurability, and isolation.
var input = base({ afDetails: { bets: 5, raises: 4, calls: 0 } });
var before = JSON.stringify(input);
var first = classifier.classify(input);
var second = classifier.classify(input);
assert.deepStrictEqual(first, second, 'classification is deterministic');
assert.strictEqual(JSON.stringify(input), before, 'classification does not mutate authoritative statistics');
assert.strictEqual(first.features.aggressionFactor.rawRate, null, 'AF infinity never enters JSON as a numeric infinity');
assert.strictEqual(first.features.aggressionFactor.rawValue, 'infinity', 'valid AF infinity remains explicit');
assert.doesNotThrow(function () { JSON.stringify(first); });
assert.strictEqual(JSON.stringify(first).includes('null'), true);
assert.strictEqual(JSON.stringify(first).includes('Infinity'), false);

var custom = classifier.classify(base({ threeBetMade: 2, threeBetOpportunities: 2 }), {
  config: { priors: { threeBetRate: { mean: 0.10, strength: 10, minimumOpportunities: 2, minimumConfidence: 0.15 } } }
});
assert.strictEqual(custom.features.threeBetRate.prior.mean, 0.10);
assert.strictEqual(custom.features.threeBetRate.prior.strength, 10);
assert.strictEqual(custom.features.threeBetRate.supported, true);

var invalidOverride = classifier.classify(base(), {
  config: { priors: { threeBetRate: { mean: 'not-a-rate', strength: 0, minimumOpportunities: -1, minimumConfidence: 8 } } }
});
assert.strictEqual(invalidOverride.features.threeBetRate.prior.mean, classifier.DEFAULT_CONFIG.priors.threeBetRate.mean);
assert.strictEqual(invalidOverride.features.threeBetRate.prior.strength, classifier.DEFAULT_CONFIG.priors.threeBetRate.strength);
assert.doesNotThrow(function () { JSON.stringify(invalidOverride); }, 'invalid configuration cannot introduce non-JSON-safe numbers');

var manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
var isolatedScripts = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
var mainScripts = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; }).js;
assert.strictEqual(isolatedScripts.includes('playerProfileClassifier.js'), true, 'classifier is loaded once in the isolated production runtime');
assert.strictEqual(mainScripts.includes('playerProfileClassifier.js'), false, 'classifier is absent from the MAIN WebSocket world');
assert.strictEqual(fs.readFileSync('content.js', 'utf8').includes('PokerPlayerProfileClassifier'), true, 'content path consumes the classifier only through the shadow store');

var report = Object.keys(profiles).reduce(function (result, id) {
  result[id] = {
    archetype: profiles[id].primary.archetype,
    bestCandidate: profiles[id].primary.bestCandidate,
    confidence: profiles[id].primary.confidence,
    scoreMargin: profiles[id].primary.scoreMargin,
    tags: profiles[id].tags.map(function (tag) { return tag.tag; })
  };
  return result;
}, {});

console.log('Player-profile classifier P1-P18 passed:', JSON.stringify(report));
