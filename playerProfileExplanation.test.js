'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier.js');
var presentation = require('./playerProfilePresentation.js');
var explanation = require('./playerProfileExplanation.js');
var dashboard = require('./playerDashboard.js');

function base(overrides) {
  return Object.assign({
    playerId: 'explain-player',
    player: 'Explain Player',
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

function recordFor(stats) {
  var classified = classifier.classify(stats);
  return {
    hands: classified.support.hands,
    primary: classified.primary,
    featureSummary: classified.features,
    tableContext: classified.tableContext,
    support: classified.support
  };
}

function visible(primary, hands) {
  return {
    visible: true,
    archetype: primary.archetype,
    status: 'visible_stable',
    reason: 'raw_profile_matches_display',
    rawArchetype: primary.archetype,
    rawStatus: primary.classificationStatus,
    rawHands: hands,
    rawBestCandidate: primary.bestCandidate,
    rawBestScore: primary.scores[primary.bestCandidate],
    rawScores: primary.scores,
    rawMargin: primary.scoreMargin,
    rawConfidence: primary.confidence
  };
}

function explainStats(stats, displayed) {
  var record = recordFor(stats);
  return explanation.explain({
    record: record,
    presentation: displayed || visible(record.primary, record.hands),
    decomposition: classifier.scoreDecomposition(stats)
  });
}

var archetypeCases = {
  Nit: base({ vpipHands: 28, pfrHands: 20, afDetails: { bets: 14, raises: 12, calls: 24 }, threeBetMade: 2 }),
  TAG: base({ vpipHands: 48, pfrHands: 40, afDetails: { bets: 38, raises: 27, calls: 35 }, threeBetMade: 5 }),
  LAG: base({ vpipHands: 80, pfrHands: 66, afDetails: { bets: 50, raises: 35, calls: 35 }, threeBetMade: 11 }),
  'Tight Passive': base({ vpipHands: 44, pfrHands: 16, afDetails: { bets: 10, raises: 10, calls: 40 }, threeBetMade: 2 }),
  'Loose Passive': base({ vpipHands: 100, pfrHands: 30, afDetails: { bets: 10, raises: 15, calls: 55 }, threeBetMade: 3 }),
  'Calling Station': base({ vpipHands: 120, pfrHands: 24, afDetails: { bets: 7, raises: 8, calls: 55 }, foldToFlopCBet: 8, foldToFlopCBetOpportunities: 50, wentToShowdown: 50, sawFlopForWTSD: 100 }),
  Maniac: base({ vpipHands: 160, pfrHands: 138, afDetails: { bets: 65, raises: 40, calls: 15 }, threeBetMade: 26, threeBetOpportunities: 80 })
};

Object.keys(archetypeCases).forEach(function (archetype) {
  var result = explainStats(archetypeCases[archetype]);
  assert.strictEqual(result.rawArchetype, archetype, archetype + ' explanation consumes the actual classifier result');
  assert.strictEqual(result.displayedArchetype, archetype, archetype + ' explanation consumes the actual displayed result');
  assert.ok(result.title.includes(archetype), archetype + ' has a user-facing title');
  assert.ok(result.description.length > 30, archetype + ' has a concise plain-English definition');
  assert.ok(result.evidence.length > 0, archetype + ' exposes supported classifier evidence');
  assert.ok(result.evidence.every(function (item) { return item.sample && item.membership > 0; }), archetype + ' evidence retains exact samples and positive classifier membership');
  assert.doesNotThrow(function () { JSON.stringify(result); }, archetype + ' explanation is JSON-safe');
});

var insufficientStats = base({ handsPlayed: 8, vpipHands: 3, vpipOpportunities: 8, pfrHands: 2, pfrOpportunities: 8 });
var insufficientRecord = recordFor(insufficientStats);
var insufficientPresentation = presentation.resolveDisplayedProfile(Object.assign({ hands: insufficientRecord.hands }, insufficientRecord));
var unknown = explanation.explain({ record: insufficientRecord, presentation: insufficientPresentation, decomposition: classifier.scoreDecomposition(insufficientStats) });
assert.strictEqual(unknown.displayedArchetype, null, 'Unknown explanation is available without a visible chip');
assert.strictEqual(unknown.title, 'No profile shown yet');
assert.ok(unknown.gatingReasons.some(function (reason) { return reason.code === 'classifier_minimum_hands'; }), 'insufficient classifier hands are explained');
assert.ok(unknown.gatingReasons.some(function (reason) { return reason.code === 'presentation_minimum_hands'; }), 'minimum visible hands are explained from the presentation policy');

function rawRecord(hands, archetype, status, best, bestScore, margin, confidence, runnerUp) {
  var scores = { Nit: 0.10, TAG: 0.10, LAG: 0.10, 'Tight Passive': 0.10, 'Loose Passive': 0.10, 'Calling Station': 0.10, Maniac: 0.10 };
  if (best) scores[best] = bestScore;
  if (runnerUp) scores[runnerUp] = Math.max(0, bestScore - margin);
  return { hands: hands, primary: { archetype: archetype, classificationStatus: status, bestCandidate: best, runnerUp: runnerUp, confidence: confidence, scoreMargin: margin, scores: scores }, tableContext: { supported: false, applied: false, status: 'unsupported' } };
}

var lowConfidenceRecord = rawRecord(50, 'TAG', 'supported', 'TAG', 0.55, 0.13, 0.40, 'Nit');
var lowConfidenceDisplay = presentation.resolveDisplayedProfile(lowConfidenceRecord);
var lowConfidence = explanation.explain({ record: lowConfidenceRecord, presentation: lowConfidenceDisplay });
assert.strictEqual(lowConfidenceDisplay.reason, 'early_strength_requirements_not_met');
assert.ok(lowConfidence.gatingReasons.some(function (reason) { return reason.code === 'presentation_confidence'; }), 'insufficient confidence is derived from the actual early presentation policy');

var closeRecord = rawRecord(100, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.62, 0.02, 0.58, 'Nit');
var closeExplanation = explanation.explain({ record: closeRecord, presentation: presentation.resolveDisplayedProfile(closeRecord) });
assert.ok(closeExplanation.gatingReasons.some(function (reason) { return reason.code === 'classifier_fit_margin'; }), 'insufficient top-two margin is explained from classifier gates');

var earlyLagRecord = rawRecord(50, 'LAG', 'supported', 'LAG', 0.72, 0.22, 0.78, 'TAG');
var earlyLagDisplay = presentation.resolveDisplayedProfile(earlyLagRecord);
assert.strictEqual(earlyLagDisplay.reason, 'early_lag_hidden');
assert.ok(explanation.explain({ record: earlyLagRecord, presentation: earlyLagDisplay }).gatingReasons.some(function (reason) { return reason.code === 'presentation_lag_evidence'; }), 'LAG early evidence gate is explained');

var earlyManiacRecord = rawRecord(80, 'Maniac', 'supported', 'Maniac', 0.80, 0.30, 0.82, 'LAG');
var earlyManiacDisplay = presentation.resolveDisplayedProfile(earlyManiacRecord);
assert.strictEqual(earlyManiacDisplay.reason, 'early_maniac_hidden');
assert.ok(explanation.explain({ record: earlyManiacRecord, presentation: earlyManiacDisplay }).gatingReasons.some(function (reason) { return reason.code === 'presentation_maniac_sample'; }), 'Maniac sample gate is explained');

var stableTag = rawRecord(80, 'TAG', 'supported', 'TAG', 0.80, 0.25, 0.80, 'Nit');
var stableDisplay = presentation.resolveDisplayedProfile(stableTag);
assert.strictEqual(stableDisplay.visible, true, 'control profile is visibly established');
var rawUnknownRecord = rawRecord(82, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.44, 0.03, 0.54, 'Nit');
var heldDisplay = presentation.resolveDisplayedProfile(rawUnknownRecord, stableDisplay);
var held = explanation.explain({ record: rawUnknownRecord, presentation: heldDisplay });
assert.strictEqual(heldDisplay.status, 'visible_holding_uncertain');
assert.strictEqual(held.displayedArchetype, 'TAG');
assert.ok(held.hysteresis.active && held.hysteresis.message.includes('held'), 'temporary raw uncertainty explains why the established label is held');

var lagReplacement = rawRecord(90, 'LAG', 'supported', 'LAG', 0.68, 0.20, 0.75, 'TAG');
var replacementDisplay = presentation.resolveDisplayedProfile(lagReplacement, stableDisplay);
var replacement = explanation.explain({ record: lagReplacement, presentation: replacementDisplay });
assert.strictEqual(replacementDisplay.status, 'visible_pending_replacement');
assert.ok(replacement.gatingReasons.some(function (reason) { return reason.code === 'hysteresis_replacement_pending'; }), 'replacement persistence is explained without changing it');

var tableStats = Object.assign({}, archetypeCases.TAG, { preflopTableSizeSum: 1200, preflopTableSizeOpportunities: 200 });
var tableAdjusted = explainStats(tableStats);
assert.strictEqual(tableAdjusted.tableSize.applied, true, 'six-handed effective table size applies the actual classifier shift');
assert.strictEqual(tableAdjusted.tableSize.effectiveTableSize, 6);
assert.ok(tableAdjusted.tableSize.message.includes('adjusted'), 'table-size adjustment receives a concise explanation');

var unsupportedThreeBetStats = Object.assign({}, archetypeCases.TAG, { threeBetMade: 0, threeBetOpportunities: 0 });
var unsupportedThreeBet = explainStats(unsupportedThreeBetStats);
assert.strictEqual(unsupportedThreeBet.evidence.some(function (item) { return item.feature === 'threeBetRate'; }), false, 'unsupported 3Bet evidence is omitted');
Object.keys(archetypeCases).forEach(function (archetype) {
  assert.strictEqual(explainStats(archetypeCases[archetype]).evidence.some(function (item) { return item.feature === 'wsdRate'; }), false, 'W$SD is never presented as primary ' + archetype + ' evidence');
});

var tagExplanation = explainStats(archetypeCases.TAG);
assert.ok(tagExplanation.evidence.filter(function (item) { return item.feature === 'vpipPfrGap' || item.feature === 'pfrVpipRatio'; }).every(function (item) { return item.sample !== '0 / 0' && /opportunities$/.test(item.sample); }), 'derived features show their actual opportunity sample rather than synthetic zero counts');
var fitSum = tagExplanation.fitScores.reduce(function (sum, entry) { return sum + entry.score; }, 0);
assert.notStrictEqual(Math.round(fitSum * 1000) / 1000, 1, 'fit scores remain independent and unnormalized');
assert.ok(tagExplanation.fitExplanation.includes('not probabilities') && tagExplanation.fitExplanation.includes('do not have to sum to 100%'));
assert.ok(tagExplanation.confidenceExplanation.includes('top fit') && tagExplanation.confidenceExplanation.includes('VPIP/PFR'));
assert.deepStrictEqual(tagExplanation.guide.map(function (entry) { return entry.archetype; }), ['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac', 'Unknown']);
assert.ok(tagExplanation.guide.find(function (entry) { return entry.archetype === 'TAG'; }).majorTendencies.includes('VPIP'), 'guide tendencies come from classifier configuration');

var session = { handsPlayed: 200, vpipHands: 48, vpipOpportunities: 200, pfrHands: 40, pfrOpportunities: 200, afDetails: { bets: 38, raises: 27, calls: 35 } };
var profile = { displayedArchetype: 'TAG', rawArchetype: 'TAG', rawScores: recordFor(archetypeCases.TAG).primary.scores, explanation: tagExplanation };
var coreStats = { schemaVersion: 1, playerId: 'stable-profile', filters: {},
  counters: { hands: session.handsPlayed, vpipMade: session.vpipHands, vpipOpportunities: session.vpipOpportunities,
    pfrMade: session.pfrHands, pfrOpportunities: session.pfrOpportunities,
    postflopAggressiveActions: session.afDetails.bets + session.afDetails.raises, postflopCalls: session.afDetails.calls },
  coverage: { totalSessionHands: session.handsPlayed, positionTrackedHands: session.handsPlayed,
    matchedPositionHands: session.handsPlayed, tableSizeHands: { HU: 0, '3_TO_5': session.handsPlayed, SIX_PLUS: 0 } } };
var dashboardBase = { playerId: 'stable-profile', displayName: 'Profile Player', mode: 'session', sessionStats: session, coreStats: coreStats, profile: profile, note: '' };
var html = dashboard.render(dashboardBase);
assert.ok(html.includes('Why this profile?') && html.includes('Profile Guide') && html.includes('Advanced details'), 'dashboard renders compact native explanation toggles');
assert.strictEqual(html.split('Why this profile?').length - 1, 1, 'supported profile has one explanation toggle');
assert.ok(html.includes('Fit scores measure how compatible') && html.includes('They are not probabilities'));
assert.ok(html.includes('Current fit') && html.includes('Confidence') && html.includes('Why it fits'));
assert.ok(html.includes('W$SD') && !html.includes('W$SD is compatible with TAG'), 'ordinary dashboard stat remains while W$SD is absent from profile evidence');

function profileSection(rendered) {
  var start = rendered.indexOf('<section class="pnhud-dashboard-section"><h3>Current profile</h3>');
  var end = rendered.indexOf('<section class="pnhud-dashboard-section"><div class="pnhud-dashboard-notes-heading">', start);
  return rendered.slice(start, end);
}
var filteredHtml = dashboard.render(Object.assign({}, dashboardBase, { position: 'BTN', opponentMode: 'others', selfPlayerId: 'hero' }));
assert.strictEqual(profileSection(filteredHtml), profileSection(html), 'Session profile explanation is unaffected by dashboard Position/Vs filters');
var hiddenHtml = dashboard.render(Object.assign({}, dashboardBase, { profile: { displayedArchetype: null, rawArchetype: unknown.rawArchetype, rawScores: insufficientRecord.primary.scores, explanation: unknown } }));
assert.ok(hiddenHtml.includes('Displayed profile unavailable') && hiddenHtml.includes('No profile shown yet') && hiddenHtml.includes('Why no profile is shown'), 'dashboard explains why a profile is not displayed');

for (var bucket of ['HU', '3_TO_5', 'SIX_PLUS']) {
  var counts = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 }; counts[bucket] = session.handsPlayed;
  var supportedHtml = dashboard.render(Object.assign({}, dashboardBase, { coreStats: Object.assign({}, coreStats,
    { coverage: Object.assign({}, coreStats.coverage, { tableSizeHands: counts }) }) }));
  assert.ok(supportedHtml.includes('Current profile') && supportedHtml.includes('Why this profile?') &&
    supportedHtml.includes('Profile Guide') && supportedHtml.includes('Advanced details'), bucket + ' supported profile retains its explanation UI');
  assert.strictEqual(supportedHtml.split('Why this profile?').length - 1, 1, bucket + ' shows one explanation toggle');
}
for (var population of [{ label: 'unknown', counts: { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 } },
  { label: 'mixed All', counts: { HU: 80, '3_TO_5': 120, SIX_PLUS: 0 } }]) {
  var unsupportedHtml = dashboard.render(Object.assign({}, dashboardBase, { coreStats: Object.assign({}, coreStats,
    { coverage: Object.assign({}, coreStats.coverage, { tableSizeHands: population.counts }) }) }));
  assert.ok(unsupportedHtml.includes('pnhud-dashboard-stat-hands') && unsupportedHtml.includes('<strong>200</strong>'),
    population.label + ' retains raw numeric stats');
  assert.ok(!unsupportedHtml.includes('Current profile') && !unsupportedHtml.includes('Why this profile?'),
    population.label + ' suppresses calibrated profile and explanation');
}
var legacyHtml = dashboard.render(Object.assign({}, dashboardBase, { coreStats: session }));
assert.ok(!legacyHtml.includes('Current profile') && !legacyHtml.includes('Why this profile?'),
  'legacy unclassified Session counters do not imply a supported table-size bucket');
var staleSwitchHtml = dashboard.render(Object.assign({}, dashboardBase, { tableSize: 'HU' }));
assert.ok(!staleSwitchHtml.includes('Why this profile?'), 'switching table size cannot reuse a stale All profile explanation');
for (var switched of [{ playerId: 'other-player', coreStats: null }, { mode: 'career', coreStats: null }]) {
  assert.ok(!dashboard.render(Object.assign({}, dashboardBase, switched)).includes('Why this profile?'),
    'player/source switch cannot display the prior profile explanation without matching core stats');
}

console.log('Player-profile explanations: 7 archetypes, Unknown, actual gates, hysteresis, table context, evidence, dashboard toggles, and filter neutrality passed.');
