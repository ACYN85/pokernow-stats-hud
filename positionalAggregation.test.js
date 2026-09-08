'use strict';
var assert = require('assert'); var aggregator = require('./careerStatsAggregator.js'); var filtered = require('./filteredStats.js'); var fixtures = require('./testSupport/careerBackupFixtures.js');
function record(hand, label, counters, at) {
  var subject = fixtures.player('subject', 'Player', counters);
  var other = fixtures.player('other-' + hand, 'Other');
  subject.position = { schemaVersion: 1, status: 'supported', dealtPosition: label, dealtPlayerCount: 9, unsupportedReason: null };
  other.position = { schemaVersion: 1, status: 'supported', dealtPosition: 'BTN', dealtPlayerCount: 9, unsupportedReason: null };
  return fixtures.record('POSITION-STATS', hand, [subject, other], { finalizedAt: at });
}
var records = [
  record('BTN-VPIP', 'BTN', { vpipMade: 1 }, 101),
  record('UTG-PFR', 'UTG', { pfrMade: 1 }, 102),
  record('SB-3BET', 'SB', { threeBetMade: 1, threeBetOpportunities: 1 }, 103),
  record('BB-F3B-FCB', 'BB', { foldToThreeBet: 1, foldToThreeBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1 }, 104),
  record('CO-CBET', 'CO', { flopCBetMade: 1, flopCBetOpportunities: 1 }, 105),
  record('HJ-WTSD', 'HJ', { wtsdMade: 1, wtsdOpportunities: 1 }, 106),
  record('LJ-WSD', 'LJ', { wsdMade: 1, wsdOpportunities: 1 }, 107),
  record('UTG1-AF', 'UTG+1', { postflopAggressiveActions: 2, postflopCalls: 1 }, 108)
];
function by(label) { return filtered.careerStatsFiltered(records, 'subject', { position: label }); }
assert.strictEqual(by('BTN').counters.vpipMade, 1, 'BTN VPIP');
assert.strictEqual(by('UTG').counters.pfrMade, 1, 'UTG PFR');
assert.deepStrictEqual([by('SB').counters.threeBetMade, by('SB').counters.threeBetOpportunities], [1, 1], 'SB 3Bet');
assert.deepStrictEqual([by('BB').counters.foldToThreeBet, by('BB').counters.foldToThreeBetOpportunities], [1, 1], 'BB F3B');
assert.deepStrictEqual([by('CO').counters.flopCBetMade, by('CO').counters.flopCBetOpportunities], [1, 1], 'CO CBet');
assert.deepStrictEqual([by('BB').counters.foldToFlopCBet, by('BB').counters.foldToFlopCBetOpportunities], [1, 1], 'BB FCB');
assert.deepStrictEqual([by('HJ').counters.wtsdMade, by('HJ').counters.wtsdOpportunities], [1, 1], 'position WTSD');
assert.deepStrictEqual([by('LJ').counters.wsdMade, by('LJ').counters.wsdOpportunities], [1, 1], 'position W$SD');
assert.deepStrictEqual([by('UTG+1').counters.postflopAggressiveActions, by('UTG+1').counters.postflopCalls, by('UTG+1').derived.af], [2, 1, 2], 'position AF components');
assert.strictEqual(by('BTN').coverage.totalCareerHands, 8);
assert.strictEqual(by('BTN').coverage.positionTrackedHands, 8);
assert.strictEqual(by('BTN').coverage.matchedPositionHands, 1);
assert.strictEqual(by('BTN').coverage.earliestPositionTrackedAt, 101);
var old = JSON.parse(JSON.stringify(records[0])); old.authoritativeHandId = 'OLD'; old.handKey = 'pokernow|pokernow.com|POSITION-STATS|OLD'; old.schemaVersion = 2; old.players.forEach(function (player) { delete player.position; }); old.fingerprint = aggregator.fingerprint(old);
var boundary = filtered.careerStatsFiltered(records.concat([old]), 'subject', { position: 'BTN' });
assert.strictEqual(boundary.coverage.totalCareerHands, 9); assert.strictEqual(boundary.coverage.positionTrackedHands, 8); assert.strictEqual(boundary.counters.hands, 1);
console.log('BTN/UTG/SB/BB/CO/HJ/LJ/UTG+1 exact positional counters and coverage boundary tests passed.');
