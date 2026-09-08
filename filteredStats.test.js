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
