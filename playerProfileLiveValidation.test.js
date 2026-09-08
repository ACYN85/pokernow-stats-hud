'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');
var store = require('./playerProfileShadowStore');
var fixtures = require('./testSupport/playerProfileLiveValidationFixtures');

function eligibility(result) {
  return result.primary.scoreDiagnostics['Calling Station'].semanticEligibility;
}

var cResults = fixtures.callingStation.map(function (entry) { return classifier.classify(entry.stats); });
assert.strictEqual(eligibility(cResults[0]).eligible, false, 'C1: absent FCB/WTSD evidence leaves Calling Station ineligible');
assert.deepStrictEqual(eligibility(cResults[0]).supportedFeatures, []);
assert.strictEqual(eligibility(cResults[1]).eligible, false, 'C2: supported non-sticky FCB remains ineligible');
assert.deepStrictEqual(eligibility(cResults[1]).supportedFeatures, ['foldToFlopCBetRate']);
assert.deepStrictEqual(eligibility(cResults[1]).positiveFeatures, []);
assert.strictEqual(eligibility(cResults[2]).eligible, true, 'C3: supported low FCB creates positive eligibility');
assert.deepStrictEqual(eligibility(cResults[2]).positiveFeatures, ['foldToFlopCBetRate']);
if (cResults[2].primary.archetype === 'Calling Station') {
  assert.ok(cResults[2].primary.scores['Calling Station'] >= classifier.DEFAULT_CONFIG.minimumPrimaryScore, 'C3 still passes the normal score gate');
  assert.ok(cResults[2].primary.scoreMargin >= classifier.DEFAULT_CONFIG.minimumScoreMargin, 'C3 still passes the normal margin gate');
}
assert.strictEqual(eligibility(cResults[3]).eligible, true, 'C4: supported high WTSD creates positive eligibility');
assert.ok(eligibility(cResults[3]).positiveFeatures.includes('wtsdRate'));
assert.strictEqual(eligibility(cResults[4]).eligible, false, 'C5: later non-sticky FCB/WTSD naturally removes eligibility');
assert.deepStrictEqual(eligibility(cResults[4]).positiveFeatures, []);

var callingState = store.createState({ classifier: classifier, sessionKey: 'synthetic:calling', maxValidationTransitions: 100, maxValidationSamples: 250 });
fixtures.callingStation.forEach(function (entry, index) {
  store.update(callingState, 'C-PLAYER', entry.stats, { generatedAt: 1000 + index });
});
var callingTimeline = store.profileTimeline(callingState, 'C-PLAYER');
assert.ok(callingTimeline.some(function (entry) { return entry.reasons.some(function (reason) { return reason.type === 'semantic_eligibility_changed' && reason.to === true; }); }), 'Calling Station eligibility gain is explained');
assert.ok(callingTimeline.some(function (entry) { return entry.reasons.some(function (reason) { return reason.type === 'semantic_eligibility_changed' && reason.to === false; }); }), 'Calling Station eligibility loss is explained');
assert.strictEqual(callingTimeline.slice(-1)[0].callingStationEligibility.satisfied, false);

var expectedTransitions = {
  T1: ['Nit', 'Unknown / Uncertain', 'TAG'],
  T2: ['TAG', 'Unknown / Uncertain', 'LAG'],
  T3: ['Loose Passive'],
  T4: ['Loose Passive', 'Calling Station', 'Loose Passive'],
  T5: ['LAG', 'Maniac', 'LAG'],
  T6: ['TAG'],
  T7: ['TAG'],
  T8: ['TAG']
};
var sequenceReport = {};
Object.keys(fixtures.transitions).forEach(function (id) {
  var state = store.createState({ classifier: classifier, sessionKey: 'synthetic:' + id, maxValidationTransitions: 100, maxValidationSamples: 250 });
  fixtures.transitions[id].forEach(function (stats, index) { store.update(state, id, stats, { generatedAt: 2000 + index }); });
  var samples = store.profileSamples(state, id);
  var observed = samples.map(function (sample) { return sample.archetype; }).filter(function (archetype, index, values) { return index === 0 || archetype !== values[index - 1]; });
  assert.deepStrictEqual(observed, expectedTransitions[id], id + ' deterministic observed primary sequence');
  assert.strictEqual(samples.length, fixtures.transitions[id].length, id + ' retains one compact diagnostic sample per distinct cumulative input');
  assert.ok(store.profileBandSnapshots(state, id).length <= store.PROFILE_HAND_BANDS.length, id + ' band snapshots remain fixed and bounded');
  sequenceReport[id] = { sequence: observed, stability: store.profileStability(state, id) };

  if (id === 'T6') {
    assert.strictEqual(samples.some(function (sample) { return sample.archetype === 'Maniac' || sample.archetype === 'LAG'; }), false, 'T6 tiny 3Bet spike cannot force LAG/Maniac');
  }
  if (id === 'T7') {
    assert.strictEqual(samples[1].tags.includes('Showdown Heavy'), true, 'T7 temporary supported showdown spike is visible');
    assert.strictEqual(samples.slice(-1)[0].tags.includes('Showdown Heavy'), false, 'T7 temporary showdown tag clears naturally');
    assert.strictEqual(store.profileStability(state, id).totalClassificationChanges, 0, 'T7 showdown noise does not alter the primary');
  }
  if (id === 'T8') {
    assert.strictEqual(store.profileStability(state, id).totalClassificationChanges, 0, 'T8 adds 100 hands without primary flicker');
    assert.strictEqual(store.get(state, id).history.length, 1, 'the existing 0.05 history rule intentionally omits sub-threshold confidence movement');
    assert.strictEqual(store.profileSamples(state, id).length, 4, 'separate validation samples preserve the otherwise hidden trajectory');
  }
});

assert.deepStrictEqual(sequenceReport.T1.sequence, ['Nit', 'Unknown / Uncertain', 'TAG'], 'T1 passes through justified uncertainty before stabilizing as TAG');
assert.deepStrictEqual(sequenceReport.T4.sequence, ['Loose Passive', 'Calling Station', 'Loose Passive'], 'T4 follows genuine eligibility gain and loss');
assert.deepStrictEqual(sequenceReport.T5.sequence, ['LAG', 'Maniac', 'LAG'], 'T5 records the concerning short-sample aggressive flicker without tuning it away');

var bounded = store.createState({ classifier: classifier, sessionKey: 'synthetic:bounded', maxValidationTransitions: 2, maxValidationSamples: 3 });
fixtures.callingStation.forEach(function (entry, index) { store.update(bounded, 'BOUNDED', entry.stats, { generatedAt: 3000 + index }); });
assert.strictEqual(store.profileTimeline(bounded, 'BOUNDED').length, 2, 'transition history is FIFO bounded');
assert.strictEqual(store.profileSamples(bounded, 'BOUNDED').length, 3, 'per-update validation samples are FIFO bounded');
assert.strictEqual(store.profileBandSnapshots(bounded, 'BOUNDED').length, 5, 'band snapshots are fixed at five entries');
assert.strictEqual(store.profileStability(bounded, 'BOUNDED').timelineTruncated, true);
assert.strictEqual(store.profileStability(bounded, 'BOUNDED').confidenceTrajectory.samplesTruncated, true);

var api = store.createDebugApi(bounded);
['profileTimeline', 'profileSamples', 'profileStability', 'profileBandSnapshots', 'allProfileStability', 'exportLiveProfileValidation', 'identityDiagnostics'].forEach(function (method) {
  assert.strictEqual(typeof api[method], 'function', method + ' exists on the isolated debug API');
});
var exported = api.exportLiveProfileValidation();
assert.strictEqual(exported.schemaVersion, store.LIVE_VALIDATION_SCHEMA_VERSION);
assert.strictEqual(exported.session.sessionKey, 'synthetic:bounded');
assert.strictEqual(exported.players.length, 1);
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported.players[0].currentProfile, 'player'), false, 'export excludes display names');
assert.doesNotThrow(function () { JSON.stringify(exported); }, 'export is JSON-safe');
['cards', 'board', 'chat', 'cookie', 'websocket', 'token', 'password'].forEach(function (forbidden) {
  assert.strictEqual(JSON.stringify(exported).toLowerCase().includes(forbidden), false, 'export excludes ' + forbidden + ' payloads');
});
var detached = api.profileTimeline('BOUNDED');
detached[0].archetype = 'external mutation';
assert.notStrictEqual(api.profileTimeline('BOUNDED')[0].archetype, 'external mutation', 'telemetry reads are detached');
assert.strictEqual(api.clear(), 1, 'clear removes the profile and its validation data');
assert.deepStrictEqual(api.profileTimeline('BOUNDED'), []);
assert.deepStrictEqual(api.allProfileStability(), []);

console.log('Live shadow profile validation C1-C5 and T1-T8 passed:', JSON.stringify(sequenceReport));
