'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var filtered = require('./filteredStats.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function position(label, count) { return { schemaVersion: 1, status: 'supported', dealtPosition: label, dealtPlayerCount: count || 6, unsupportedReason: null }; }
function make(hand, label, stat, made, opportunities, relation, at, schema) {
  var subject = fixtures.player('subject', 'Same Name');
  var counterpart = fixtures.player(relation || 'counterpart', 'Same Name');
  subject.position = position(label);
  counterpart.position = position('BTN');
  var spec = filtered.RELATIONAL_STATS[stat];
  if (spec) {
    subject.counters[spec.made] = made;
    subject.counters[spec.opportunities] = opportunities;
    subject.relational[spec.relationField] = relation;
  }
  var record = fixtures.record('FILTER', hand, [subject, counterpart], { finalizedAt: at });
  if (schema === 2) { record.schemaVersion = 2; record.players.forEach(function (player) { delete player.position; }); record.fingerprint = aggregator.fingerprint(record); }
  return record;
}
function q(records, filters) { return filtered.careerStatsFiltered(records, 'subject', filters); }

var records = [
  make('SB-FCB-ME', 'SB', 'foldToFlopCBet', 1, 1, 'me', 1001),
  make('SB-FCB-OTHER', 'SB', 'foldToFlopCBet', 0, 1, 'other', 1002),
  make('BB-3B-ME', 'BB', 'threeBet', 1, 1, 'me', 1003),
  make('CO-F3B-ME', 'CO', 'foldToThreeBet', 1, 1, 'me', 1004),
  make('OLD-RELATIONAL', 'SB', 'foldToFlopCBet', 1, 1, 'me', 900, 2),
  make('MISSING-RELATION', 'SB', 'foldToFlopCBet', 1, 1, null, 1005)
];
assert.strictEqual(records.every(function (record) { return aggregator.validateRecord(record) === null; }), true);

var sbMe = q(records, { position: 'SB', statId: 'foldToFlopCBet', counterpartMode: 'self', selfPlayerId: 'me' });
assert.deepStrictEqual([sbMe.counters.foldToFlopCBet, sbMe.counters.foldToFlopCBetOpportunities], [1, 1], 'SB FCB vs You is exact');
assert.strictEqual(sbMe.coverage.positionTrackedHands, 5);
assert.strictEqual(sbMe.coverage.excludedUnsupportedPositionRecords, 1, 'old positional history is excluded, never fabricated');
assert.strictEqual(sbMe.coverage.excludedMissingCounterpartRecords, 1, 'missing relation is excluded from self');
var sbOthers = q(records, { position: 'SB', statId: 'foldToFlopCBet', counterpartMode: 'others', selfPlayerId: 'me' });
assert.deepStrictEqual([sbOthers.counters.foldToFlopCBet, sbOthers.counters.foldToFlopCBetOpportunities], [0, 1], 'SB FCB vs Everyone Else excludes missing provenance');
var bbThreeBet = q(records, { position: 'BB', statId: 'threeBet', counterpartMode: 'specific', counterpartPlayerId: 'me' });
assert.deepStrictEqual([bbThreeBet.counters.threeBetMade, bbThreeBet.counters.threeBetOpportunities], [1, 1]);
var coF3b = q(records, { position: 'CO', statId: 'foldToThreeBet', counterpartMode: 'self', selfPlayerId: 'me' });
assert.deepStrictEqual([coF3b.counters.foldToThreeBet, coF3b.counters.foldToThreeBetOpportunities], [1, 1]);
var counterpartOnly = q(records, { statId: 'foldToFlopCBet', counterpartMode: 'self', selfPlayerId: 'me' });
assert.deepStrictEqual([counterpartOnly.counters.foldToFlopCBet, counterpartOnly.counters.foldToFlopCBetOpportunities], [2, 2], 'schema-2 relational history remains usable without invented position');
assert.throws(function () { q(records, { statId: 'flopCBet', counterpartMode: 'self', selfPlayerId: 'me' }); }, /threeBet.*foldToThreeBet.*foldToFlopCBet/);

var root = make('SUPERSEDE', 'SB', 'threeBet', 0, 1, 'me', 1100);
root.semanticVersions.preflop = 1; root.fingerprint = aggregator.fingerprint(root);
var tip = JSON.parse(JSON.stringify(root)); tip.semanticVersions.preflop = 2; tip.supersedesFingerprint = root.fingerprint; tip.players[0].counters.threeBetMade = 1; tip.fingerprint = aggregator.fingerprint(tip);
var superseded = q([root, tip], { position: 'SB', statId: 'threeBet', counterpartMode: 'self', selfPlayerId: 'me' });
assert.deepStrictEqual([superseded.counters.threeBetMade, superseded.counters.threeBetOpportunities], [1, 1], 'only active supersession tip contributes');
assert.strictEqual(superseded.coverage.physicalRecordCount, 2);
assert.strictEqual(superseded.coverage.activeRecordCount, 1);

var sessionEvent = { handId: 'SB-FCB-ME', playerId: 'subject', player: 'Same Name', countsAsHand: true, action: 'fold', street: 'flop', dealtPosition: 'SB', dealtPlayerCount: 6, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, foldToFlopCBetAggressorPlayerId: 'me' };
var session = filtered.sessionStatsFiltered([sessionEvent], 'subject', { position: 'SB', statId: 'foldToFlopCBet', counterpartMode: 'self', selfPlayerId: 'me' });
assert.deepStrictEqual([session.counters.foldToFlopCBet, session.counters.foldToFlopCBetOpportunities], [sbMe.counters.foldToFlopCBet, sbMe.counters.foldToFlopCBetOpportunities], 'session and career filtered contributions agree');

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
var legacy = make('SCHEMA-1', 'SB', 'threeBet', 1, 1, 'me', 800);
legacy.schemaVersion = 1; legacy.players.forEach(function (entry) { delete entry.position; delete entry.relational; }); legacy.fingerprint = aggregator.fingerprint(legacy);
var infinity = make('INFINITY', 'SB', null, 0, 0, 'me', 1200);
infinity.players[0].counters.postflopAggressiveActions = 3; infinity.fingerprint = aggregator.fingerprint(infinity);
var zero = make('ZERO', 'SB', null, 0, 0, 'me', 1201);
zero.players[0].counters = aggregator.emptyCounters(); zero.fingerprint = aggregator.fingerprint(zero);
var unsupported = make('UNSUPPORTED-POSITION', 'SB', 'threeBet', 1, 1, 'me', 1202);
unsupported.players[0].position = fixtures.player('unused', 'Unused').position; unsupported.fingerprint = aggregator.fingerprint(unsupported);
var chain = JSON.parse(JSON.stringify(tip)); chain.semanticVersions.preflop = 3; chain.supersedesFingerprint = tip.fingerprint; chain.fingerprint = aggregator.fingerprint(chain);
var conflict = JSON.parse(JSON.stringify(tip)); conflict.players[0].counters.vpipMade = 1; conflict.fingerprint = aggregator.fingerprint(conflict);
assert.strictEqual(aggregator.rebuild([root, tip, conflict]).quarantinedHandKeys.length, 1, 'fixture has conflicting successors and quarantines the hand');
var malformed = JSON.parse(JSON.stringify(infinity)); malformed.players[0].counters.hands = -1;
var matrix = [];
[undefined, 'SB', 'BB', 'CO', 'BTN', 'not-a-position'].forEach(function (label) {
  matrix.push({ position: label });
  ['threeBet', 'foldToThreeBet', 'foldToFlopCBet'].forEach(function (statId) {
    matrix.push({ position: label, statId: statId });
    ['self', 'others', 'specific'].forEach(function (mode) {
      matrix.push({ position: label, statId: statId, counterpartMode: mode, selfPlayerId: 'me', counterpartPlayerId: 'other' });
    });
  });
});
matrix.push(null, { position: null, statId: 'threeBet', counterpartPlayerId: 42, selfPlayerId: 7 });
deepFreeze(matrix);
var snapshots = [records.concat([legacy, infinity, zero, unsupported, root, tip, chain]), [root, tip, conflict], [null, {}, malformed].concat(records), [zero], [infinity], []];
snapshots.forEach(function (snapshot) {
  var before = JSON.stringify(snapshot); deepFreeze(snapshot);
  ['subject', 'missing-player'].forEach(function (playerId) {
    var independent = matrix.map(function (filters) { return filtered.careerStatsFiltered(snapshot, playerId, filters); });
    var batched = filtered.careerStatsFilteredBatch(snapshot, playerId, matrix);
    assert.deepStrictEqual(batched, independent, 'complete batch results equal independent calls, including coverage, normalized metadata and nonfinite AF');
  });
  assert.strictEqual(JSON.stringify(snapshot), before, 'records are immutable');
});
assert.strictEqual(q([infinity], {}).derived.af, Infinity);
assert.strictEqual(filtered.careerStatsFilteredBatch([infinity], 'subject', [{}])[0].derived.af, Infinity);
assert.strictEqual(q([zero], {}).derived.threeBet, null, 'zero opportunities stay unavailable');
assert.deepStrictEqual(filtered.careerStatsFilteredBatch(records, 'subject', []), []);
assert.deepStrictEqual(filtered.careerStatsFilteredBatch(undefined, 'subject', [{}]), [q([], {})]);
var independentObjects = filtered.careerStatsFilteredBatch(records, 'subject', [{ position: 'SB' }, { position: 'SB' }]);
var untouched = structuredClone(independentObjects[1]);
independentObjects[0].counters.hands = -1; independentObjects[0].coverage.totalCareerHands = -1; independentObjects[0].filters.position = 'BB'; independentObjects[0].derived.af = -1;
assert.deepStrictEqual(independentObjects[1], untouched, 'repeated filters return independent nested objects');
assert.deepStrictEqual(filtered.careerStatsFilteredBatch(records, 'subject', [{ position: 'SB' }])[0], untouched, 'a later request owns a fresh resolution and results');
[
  { statId: 'flopCBet', counterpartMode: 'self', selfPlayerId: 'me' },
  { statId: 'threeBet', counterpartMode: 'specific' },
  { statId: 'threeBet', counterpartMode: 'self' },
  { statId: 'threeBet', counterpartMode: 'others' },
  { statId: 'threeBet', counterpartMode: 'invalid' }
].forEach(function (filters) {
  var singleError;
  try { filtered.careerStatsFiltered({}, 'subject', filters); } catch (error) { singleError = error; }
  assert.ok(singleError instanceof TypeError);
  assert.throws(function () { filtered.careerStatsFilteredBatch({}, 'subject', [{}, filters]); }, function (error) { return error.constructor === singleError.constructor && error.message === singleError.message; }, 'filter validation precedes record resolution');
});
console.log('Position, relational, historical schemas, malformed/quarantined records, batch equivalence, immutability, validation, AF and session/career consistency tests passed.');

(function () {
  'use strict';
  var assert = require('assert');
  var Stats = require('./stats.js');
  var Filtered = require('./filteredStats.js');
  var CareerStore = require('./careerContributionStore.js');
  var Career = require('./careerStatsAggregator.js');
  var Dashboard = require('./playerDashboard.js');
  var Insights = require('./playerInsights.js');
  var Personal = require('./personalLeakAnalysis.js');
  var Strategic = require('./strategicImplications.js');

function population(playerId, name, walkCount, vpipCount, pfrCount) {
  var hands = [];
  for (var index = 0; index < 64; index += 1) {
    var handId = name.toUpperCase() + '-' + index;
    var walk = index < walkCount;
    var eligibleIndex = index - walkCount;
    var position = walk ? 'BB' : 'BTN';
    var subject = { handId: handId, playerId: playerId, player: name, street: 'preflop',
      action: walk ? 'blind' : eligibleIndex < pfrCount ? 'raise' : eligibleIndex < vpipCount ? 'call' : 'fold',
      blindType: walk ? 'big' : null, dealtPosition: position, dealtPlayerCount: 2, timestamp: index * 10 + 1 };
    // These supported reducer results are attached to finalized Session events.
    if (!walk && eligibleIndex === 0) Object.assign(subject, {
      threeBetMade: 1, threeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1,
      sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: 1
    });
    if (!walk && eligibleIndex === 1 && vpipCount > 1) Object.assign(subject, {
      foldToThreeBet: 1, foldToThreeBetOpportunities: 1, sawFlopForWTSD: 1
    });
    if (!walk && eligibleIndex === 2 && vpipCount > 2) Object.assign(subject, { foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1 });
    var other = { handId: handId, playerId: 'other', player: 'Other', street: 'preflop',
      action: walk ? 'fold' : 'dealt', dealtPosition: walk ? 'SB' : 'BB', dealtPlayerCount: 2, timestamp: index * 10 + 2 };
    var events = [subject, other];
    if (!walk && eligibleIndex === 0) events.push({ handId: handId, playerId: playerId, player: name, street: 'flop', action: 'bet', timestamp: index * 10 + 3 });
    if (!walk && eligibleIndex === 1 && vpipCount > 1) events.push({ handId: handId, playerId: playerId, player: name, street: 'flop', action: 'call', timestamp: index * 10 + 3 });
    hands.push(events);
  }
  return hands;
}

function careerRecord(events, playerId) {
  var subject = events.find(function (event) { return event.playerId === playerId; });
  var handId = subject.handId;
  return CareerStore.buildCertifiedHandRecord({
    namespace: { host: 'pokernow.com', gameId: 'SESSION-RC1-REGRESSION' },
    authoritativeHandId: handId, finalizedEvents: events, finalizedAt: 1000 + Number(handId.split('-').pop()),
    semanticRecord: { status: 'finalized', schemaVersion: 1, handIdentity: { handId: handId },
      players: [{ playerId: playerId, displayName: subject.player }, { playerId: 'other', displayName: 'Other' }],
      positionProvenance: { status: 'supported', dealtPlayerCount: 2,
        assignments: Object.fromEntries([[playerId, subject.dealtPosition], ['other', subject.dealtPosition === 'BB' ? 'SB' : 'BB']]) } }
  });
}

function check(playerId, name, walks, vpip, pfr, expectedVpip, expectedPfr) {
  var hands = population(playerId, name, walks, vpip, pfr);
  var events = hands.flat();
  var authoritative = Stats.computePlayerStatsByIdentity(events, playerId, name);
  var incrementalStats = Stats.computePlayerStatsByIdentity([], playerId, name);
  hands.forEach(function (hand) {
    incrementalStats = Object.assign(Stats.combinePlayerStats(name, [incrementalStats,
      Stats.computePlayerStatsByIdentity(hand, playerId, name)]), { playerId: playerId });
  });
  assert.deepStrictEqual(incrementalStats, authoritative, name + ' complete-hand stat accumulation preserves BB walks and support');
  var overall = Filtered.sessionStatsFiltered(events, playerId, {});
  var incrementalOverall = Filtered.sessionStatsFiltered([], playerId, {});
  hands.forEach(function (hand) { incrementalOverall = Filtered.appendSessionResult(incrementalOverall, hand, playerId, {}); });
  assert.deepStrictEqual(incrementalOverall, overall, name + ' per-hand Overall append matches full Session semantics');
  var live = Filtered.createSessionContextState();
  hands.forEach(function (hand) { Filtered.appendSessionContextHand(live, hand); });
  var hydrated = Filtered.rebuildSessionContexts(events);
  var career = Career.aggregateActiveRecords(hands.map(function (hand) { return careerRecord(hand, playerId); }));
  var careerPlayer = career.players[playerId];
  var sessionCards = Dashboard.fromCounterResult(overall, 'session', { position: null, situation: 'overall', opponentMode: 'overall' });
  var careerCards = Dashboard.fromCounterResult({ counters: careerPlayer.counters }, 'career', { position: null, situation: 'overall', opponentMode: 'overall' });
  function card(cards, id) { return cards.find(function (item) { return item.id === id; }); }

  assert.deepStrictEqual([authoritative.handsPlayed, authoritative.vpipHands, authoritative.vpipOpportunities,
    authoritative.pfrHands, authoritative.pfrOpportunities, authoritative.vpipDetails.walksExcluded],
    [64, vpip, 64 - walks, pfr, 64 - walks, walks], name + ' authoritative detail');
  assert.deepStrictEqual([overall.counters.hands, overall.counters.vpipMade, overall.counters.vpipOpportunities,
    overall.counters.pfrMade, overall.counters.pfrOpportunities], [64, vpip, 64 - walks, pfr, 64 - walks], name + ' Session cards');
  assert.deepStrictEqual([card(sessionCards, 'vpip').value, card(sessionCards, 'pfr').value], [expectedVpip, expectedPfr]);
  var detailCards = Dashboard.fromSession(authoritative, { position: null, situation: 'overall', opponentMode: 'overall' });
  assert.deepStrictEqual([card(detailCards, 'vpip').value, card(detailCards, 'pfr').value], [expectedVpip, expectedPfr], name + ' authoritative cards');
  assert.deepStrictEqual([card(careerCards, 'vpip').value, card(careerCards, 'pfr').value], [expectedVpip, expectedPfr]);
  assert.strictEqual(overall.coverage.totalSessionHands, 64, name + ' All positions coverage');
  assert.strictEqual(overall.coverage.positionTrackedHands, 64, name + ' position coverage');
  assert.deepStrictEqual(live, hydrated, name + ' live and hydration contexts');
  assert.strictEqual(live.players[playerId].coverage.totalSessionHands, 64, name + ' maintained total coverage');
  assert.deepStrictEqual(overall.counters, careerPlayer.counters, name + ' Session and Career exact counter bundles');
  assert.deepStrictEqual(overall.derived, Career.deriveCounters(careerPlayer.counters), name + ' Session and Career rates');
  if (vpip > 1) assert.deepStrictEqual([overall.counters.postflopAggressiveActions, overall.counters.postflopCalls, overall.derived.af,
    overall.counters.flopCBetMade, overall.counters.flopCBetOpportunities,
    overall.counters.wtsdMade, overall.counters.wtsdOpportunities,
    overall.counters.wsdMade, overall.counters.wsdOpportunities],
    [1, 1, 1, 1, 1, 1, 2, 1, 1], name + ' nonzero AF, CBet, WTSD and W$SD');
  ['BB', 'BTN'].forEach(function (position) {
    var selected = Filtered.sessionContextResult(live, playerId, { position: position });
    assert.deepStrictEqual(selected, Filtered.sessionStatsFiltered(events, playerId, { position: position }), name + ' selected ' + position);
    assert.deepStrictEqual(selected.counters, careerPlayer.contexts.positions[position], name + ' Career ' + position);
  });
  assert.deepStrictEqual([live.players[playerId].positions.BB.hands, live.players[playerId].positions.BB.vpipOpportunities,
    live.players[playerId].positions.BTN.hands, live.players[playerId].positions.BTN.vpipOpportunities],
    [walks, 0, 64 - walks, 64 - walks], name + ' walk and eligible position partitions');
  var html = Dashboard.render({ open: true, playerId: playerId, displayName: name, mode: 'session',
    situation: 'overall', coreStats: overall, sessionStats: authoritative, selfPlayerId: playerId });
  assert.match(html, /All positions<\/strong> · 64 total hands/);
  assert.match(html, /Position-tracked: 64 hands/);
  return { overall: overall, cards: sessionCards };
}

var playerA = check('playerA', 'PlayerA', 31, 8, 1, '24.2%', '3.0%');
check('playerB', 'PlayerB', 24, 1, 1, '2.5%', '2.5%');
var relationalHands = [
  [{ handId: 'R1', playerId: 'hero', player: 'Hero', street: 'preflop', action: 'raise', dealtPosition: 'SB', dealtPlayerCount: 3,
    threeBetMade: 1, threeBetOpportunities: 1, threeBetTargetPlayerId: 'villain' }],
  [{ handId: 'R2', playerId: 'hero', player: 'Hero', street: 'preflop', action: 'fold', dealtPosition: 'BB', dealtPlayerCount: 3,
    threeBetMade: 0, threeBetOpportunities: 1, threeBetTargetPlayerId: 'self' }]
];
['self', 'others'].forEach(function (mode) {
  var filters = { statId: 'threeBet', counterpartMode: mode, selfPlayerId: 'self' };
  var prior = Filtered.sessionStatsFiltered(relationalHands[0], 'hero', filters);
  var appended = Filtered.appendSessionResult(prior, relationalHands[1], 'hero', filters);
  assert.deepStrictEqual(appended, Filtered.sessionStatsFiltered(relationalHands.flat(), 'hero', filters), mode + ' relational append matches full counters and coverage');
});
var context = { position: null, situation: 'overall', opponentMode: 'overall' };
var vpipCard = playerA.cards.find(function (card) { return card.id === 'vpip'; });
assert.strictEqual(vpipCard.evidence.supportCount, 33, 'Evidence follows eligible opportunities');
assert.strictEqual(vpipCard.evidence.status, 'weak', '33 opportunities cannot produce Moderate Evidence');
var observations = Insights.derive({ cards: playerA.cards, source: 'session', context: context });
assert.deepStrictEqual(observations, [], 'Opponent Insights consume corrected support');
assert.deepStrictEqual(Personal.derive({ cards: playerA.cards, source: 'session', context: context }), [], 'self Review Signals consume corrected support');
assert.deepStrictEqual(Strategic.derive({ observations: observations, source: 'session', context: context }), [], 'Strategic Implications consume corrected Insights');
console.log('Session BB-walk opportunities, coverage, live/rebuild, Career equivalence, Evidence and analysis regression passed.');

})();
