'use strict';
var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');

function player(id, hands) { return { playerId: id, displayName: id, counters: Object.assign(aggregator.emptyCounters(), { hands: hands, vpipMade: hands, vpipOpportunities: hands }), decisions: {} }; }
function record(handKey, players, versions, predecessor) {
  var parts = handKey.split('|');
  var value = { schemaVersion: 1, recordType: 'certified-career-hand', handKey: handKey, namespace: { provider: 'pokernow', host: parts[1], gameId: parts[2] }, authoritativeHandId: parts[3], lifecycleHandIds: [], finalizedAt: 1, semanticVersions: versions, players: players, supersedesFingerprint: predecessor || null };
  value.fingerprint = aggregator.fingerprint(value); return value;
}
var v1 = { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 };
var v2 = { core: 1, preflop: 3, flopCBet: 1, showdown: 1, sourceLedger: 1 };
var v3 = { core: 2, preflop: 3, flopCBet: 1, showdown: 1, sourceLedger: 1 };
var key = 'pokernow|pokernow.com|G|H';
var a = record(key, [player('P1', 1)], v1);
var b = record(key, [player('P1', 2)], v2, a.fingerprint);
var c = record(key, [player('P1', 3)], v3, b.fingerprint);

var ab = aggregator.rebuild([a, b]);
assert.strictEqual(ab.aggregate.physicalRecordCount, 2);
assert.strictEqual(ab.aggregate.ledgerRecordCount, 1);
assert.strictEqual(ab.aggregate.players.P1.counters.hands, 2, 'A->B counts only active B');
var abc = aggregator.rebuild([c, a, b]);
assert.strictEqual(abc.aggregate.players.P1.counters.hands, 3, 'A->B->C deterministically selects C independent of physical order');
assert.deepStrictEqual(abc.activeRecords.map(function (value) { return value.fingerprint; }), [c.fingerprint]);

var incremental = aggregator.createState([a]);
assert.strictEqual(aggregator.append(incremental, b).accepted, true);
assert.strictEqual(aggregator.append(incremental, c).accepted, true);
assert.deepStrictEqual(aggregator.exactAggregate(incremental), abc.aggregate, 'incremental supersession equals full rebuild');
assert.strictEqual(aggregator.append(incremental, c).duplicate, true);

var fork = record(key, [player('P1', 4)], { core: 1, preflop: 2, flopCBet: 2, showdown: 1, sourceLedger: 1 }, a.fingerprint);
var forked = aggregator.rebuild([a, b, fork]);
assert.strictEqual(forked.aggregate.ledgerRecordCount, 0, 'ambiguous fork quarantines the logical hand instead of double counting');
assert.match(forked.rejectedRecords[forked.rejectedRecords.length - 1].reason, /competing/);
assert.strictEqual(aggregator.append(aggregator.createState([a, b]), fork).conflict, true);

var missing = record(key, [player('P1', 2)], v2, 'missing-fingerprint');
assert.match(aggregator.rebuild([a, missing]).rejectedRecords.pop().reason, /missing/);
var crossPlayer = record(key, [player('P2', 2)], v2, a.fingerprint);
assert.match(aggregator.rebuild([a, crossPlayer]).rejectedRecords.pop().reason, /cross-player/);
var crossHand = record('pokernow|pokernow.com|G|OTHER', [player('P1', 2)], v2, a.fingerprint);
assert.match(aggregator.rebuild([a, crossHand]).rejectedRecords.pop().reason, /cross-hand/);
var noAdvance = record(key, [player('P1', 2)], v1, a.fingerprint);
assert.match(aggregator.rebuild([a, noAdvance]).rejectedRecords.pop().reason, /advance/);

var self = JSON.parse(JSON.stringify(a)); self.supersedesFingerprint = self.fingerprint;
assert.match(aggregator.validateRecord(self), /self-supersession|fingerprint mismatch/, 'content-addressed self-cycle is rejected');
var unknown = record('pokernow|pokernow.com|G|UNKNOWN', [player('P1', 1)], { core: 99, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 });
assert.match(aggregator.validateRecord(unknown), /unsupported semantic version/);
console.log('Career supersession chains, active tips, forks, malformed transitions, identity, and conservative version tests passed.');
