'use strict';

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var classifier = require('./playerProfileClassifier.js');
var explanation = require('./playerProfileExplanation.js');
var dashboard = require('./playerDashboard.js');

function base(overrides) {
  return Object.assign({
    handsPlayed: 200, vpipHands: 56, vpipOpportunities: 200, pfrHands: 40, pfrOpportunities: 200,
    afDetails: { bets: 30, raises: 20, calls: 30 }, threeBetMade: 5, threeBetOpportunities: 60,
    foldToThreeBet: 12, foldToThreeBetOpportunities: 24, flopCBetMade: 24, flopCBetOpportunities: 40,
    foldToFlopCBet: 16, foldToFlopCBetOpportunities: 36, wentToShowdown: 22, sawFlopForWTSD: 70,
    wonMoneyAtShowdown: 11, showdownsForWSD: 22
  }, overrides || {});
}

function recordAndDecomposition(stats) {
  var classified = classifier.classify(stats);
  return {
    record: { hands: classified.support.hands, primary: classified.primary, featureSummary: classified.features, tableContext: classified.tableContext, support: classified.support },
    decomposition: classifier.scoreDecomposition(stats)
  };
}

function visible(archetype) { return { visible: true, archetype: archetype, status: 'visible_stable', reason: 'raw_profile_matches_display' }; }

var suppliedStats = base({
  handsPlayed: 159, vpipHands: 74, vpipOpportunities: 159, pfrHands: 47, pfrOpportunities: 159,
  afDetails: { bets: 30, raises: 24, calls: 20 }, threeBetMade: 6, threeBetOpportunities: 40,
  preflopTableSizeSum: 954, preflopTableSizeOpportunities: 159
});
var supplied = recordAndDecomposition(suppliedStats);
supplied.record.primary = {
  archetype: 'Unknown / Uncertain', classificationStatus: 'ambiguous', bestCandidate: 'Loose Passive', runnerUp: 'LAG',
  confidence: 0.54, scoreMargin: 0.052,
  scores: { Nit: 0, TAG: 0.092, LAG: 0.247, 'Tight Passive': 0, 'Loose Passive': 0.299, 'Calling Station': 0, Maniac: 0 }
};
var hidden = { visible: false, archetype: null, status: 'hidden_uncertain', reason: 'raw_profile_ambiguous', rawHands: 159, rawBestCandidate: 'Loose Passive', rawBestScore: 0.299, rawMargin: 0.052, rawConfidence: 0.54 };
var result = explanation.explain({ record: supplied.record, presentation: hidden, decomposition: supplied.decomposition });

assert.deepStrictEqual({ archetype: result.topCandidateArchetype, fit: result.topCandidateFit }, { archetype: 'Loose Passive', fit: 0.299 }, 'the highest compatibility score remains visible even though raw classification is Unknown');
assert.deepStrictEqual({ archetype: result.secondBestArchetype, fit: result.secondBestFit }, { archetype: 'LAG', fit: 0.247 }, 'the second-highest compatibility score is labeled separately');
assert.strictEqual(result.fitMargin, 0.052, 'fit margin remains the classifier-supplied top-minus-second value');
assert.strictEqual(Math.round((result.topCandidateFit - result.secondBestFit) * 1000) / 1000, result.fitMargin);
assert.strictEqual(result.rawArchetype, 'Unknown / Uncertain');
assert.strictEqual(result.displayedArchetype, null);
assert.ok(result.fitCompetition && /loose/i.test(result.fitCompetition) && /passive/i.test(result.fitCompetition) && /aggressive/i.test(result.fitCompetition), 'close-fit wording explains shared loose evidence and passive/aggressive competition');
assert.ok(result.supportingEvidence.length > 0 && result.counterEvidence.length > 0, 'decomposition comparisons separate support from mixed/counterevidence');
assert.ok(result.evidence.every(function (item) { return item.dimension && !/compatible with/i.test(item.summary); }), 'evidence explains behavioral dimensions rather than repeating compatibility');
assert.ok(result.evidence.some(function (item) { return item.sample === '74 / 159'; }), 'exact VPIP sample is preserved');
assert.ok(result.evidence.some(function (item) { return item.sample === '6 / 40'; }), 'exact 3Bet sample is preserved');
assert.strictEqual(result.tableSize.applied, true, 'existing table-size adjustment remains visible');
assert.strictEqual(result.tableSize.effectiveTableSize, 6);

var dashboardCore = { schemaVersion: 1, playerId: 'supplied-player', filters: {},
  counters: { hands: suppliedStats.handsPlayed, vpipMade: suppliedStats.vpipHands,
    vpipOpportunities: suppliedStats.vpipOpportunities, pfrMade: suppliedStats.pfrHands,
    pfrOpportunities: suppliedStats.pfrOpportunities },
  coverage: { totalSessionHands: suppliedStats.handsPlayed,
    tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: suppliedStats.handsPlayed } } };
var dashboardHtml = dashboard.render({
  playerId: 'supplied-player', displayName: 'Supplied example', mode: 'session', sessionStats: suppliedStats, coreStats: dashboardCore,
  profile: { displayedArchetype: null, rawArchetype: 'Unknown / Uncertain', rawScores: supplied.record.primary.scores, explanation: result }, note: ''
});
assert.ok(dashboardHtml.includes('<dt>Top candidate</dt><dd>Loose Passive 29.9%</dd>'));
assert.ok(dashboardHtml.includes('<dt>Second-best fit</dt><dd>LAG 24.7%</dd>'));
assert.ok(dashboardHtml.includes('<dt>Fit margin</dt><dd>5.2%</dd>'));
assert.ok(dashboardHtml.includes('<dt>Raw classifier result</dt><dd>Unknown / Uncertain</dd>'));
assert.ok(dashboardHtml.includes('<dt>Displayed profile</dt><dd>None</dd>'));
assert.ok(!dashboardHtml.includes('<dt>Runner-up</dt>'), 'the ambiguous standalone Runner-up label is absent');
assert.ok(dashboardHtml.includes('Supporting evidence') && dashboardHtml.includes('Mixed / counterevidence'));
assert.ok(dashboardHtml.includes('Sample: 74 / 159'));

var cases = {
  Nit: { stats: base({ vpipHands: 28, pfrHands: 20, afDetails: { bets: 14, raises: 12, calls: 24 }, threeBetMade: 2 }), words: [/tight|selective/i] },
  TAG: { stats: base({ vpipHands: 48, pfrHands: 40, afDetails: { bets: 38, raises: 27, calls: 35 }, threeBetMade: 5 }), words: [/tight|selective/i, /aggressive/i] },
  LAG: { stats: base({ vpipHands: 80, pfrHands: 66, afDetails: { bets: 50, raises: 35, calls: 35 }, threeBetMade: 11 }), words: [/loose/i, /aggressive/i] },
  'Tight Passive': { stats: base({ vpipHands: 44, pfrHands: 16, afDetails: { bets: 10, raises: 10, calls: 40 }, threeBetMade: 2 }), words: [/tight|selective/i, /passive/i] },
  'Loose Passive': { stats: base({ vpipHands: 100, pfrHands: 30, afDetails: { bets: 10, raises: 15, calls: 55 }, threeBetMade: 3 }), words: [/loose/i, /passive/i] },
  'Calling Station': { stats: base({ vpipHands: 120, pfrHands: 24, afDetails: { bets: 7, raises: 8, calls: 55 }, foldToFlopCBet: 8, foldToFlopCBetOpportunities: 50, wentToShowdown: 50, sawFlopForWTSD: 100 }), words: [/calling|low-fold/i] },
  Maniac: { stats: base({ vpipHands: 160, pfrHands: 138, afDetails: { bets: 65, raises: 40, calls: 15 }, threeBetMade: 26, threeBetOpportunities: 80 }), words: [/extremely loose/i, /aggressive/i] }
};
Object.keys(cases).forEach(function (archetype) {
  var pair = recordAndDecomposition(cases[archetype].stats);
  var explained = explanation.explain({ record: pair.record, presentation: visible(archetype), decomposition: pair.decomposition });
  var language = explained.evidence.map(function (item) { return item.dimension + ' ' + item.summary; }).join(' ');
  cases[archetype].words.forEach(function (pattern) { assert.match(language, pattern, archetype + ' explanation includes its behavioral component'); });
});

var before = classifier.classify(suppliedStats);
explanation.explain({ record: supplied.record, presentation: hidden, decomposition: classifier.scoreDecomposition(suppliedStats) });
assert.deepStrictEqual(classifier.classify(suppliedStats), before, 'explanation generation leaves classifier output bit-for-bit unchanged');
var classifierHash = crypto.createHash('sha256').update(fs.readFileSync('./playerProfileClassifier.js')).digest('hex').toUpperCase();
assert.strictEqual(classifierHash, '2C187D62B46EF7B6EF693065766669804B97888D533752927F46B62FCC57A870', 'classifier source remains byte-identical to the accepted V1.1 feature baseline');
var adapterSource = fs.readFileSync('./playerProfileExplanation.js', 'utf8');
['minimumPrimaryScore: 0.42', 'minimumScoreMargin: 0.08', 'minimumVisibleHands: 40'].forEach(function (copiedThreshold) { assert.strictEqual(adapterSource.includes(copiedThreshold), false, 'no classifier/presentation decision threshold is duplicated: ' + copiedThreshold); });

console.log('Final UI profile clarity: top/second fits, trait evidence, counterevidence, close competition, samples, table context, and classifier freeze passed.');
