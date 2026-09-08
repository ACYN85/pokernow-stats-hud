'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var replay = require('./testSupport/captureDerivedPreflopProductionReplay.js');

var fixtureDirectory = path.join(__dirname, 'fixtures', 'capture-derived-preflop');
function load(file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), 'utf8'));
}

var a1 = replay.replayFixture(load('a1-open-3bet-fold.sanitized.json'));
assert.strictEqual(a1.finalizedRecords.length, 1);
assert.strictEqual(a1.contributions.length, 1);
assert.deepStrictEqual(a1.contributions[0].hand, {
  openRaiser: 'P2',
  threeBettor: 'P1',
  validThreeBetSequence: true,
  isSqueeze: false,
  interveningCallers: []
});
assert.deepStrictEqual({
  opportunity: a1.contributions[0].players.P1.threeBet.opportunity,
  made: a1.contributions[0].players.P1.threeBet.made,
  folded: a1.contributions[0].players.P2.foldToThreeBet.folded
}, { opportunity: true, made: true, folded: true });

var a3 = replay.replayFixture(load('a3-open-coldcall-squeeze-showdown-chop.sanitized.json'));
assert.strictEqual(a3.finalizedRecords[0].preflopRoles.squeezer, 'P3');
assert.deepStrictEqual(a3.finalizedRecords[0].preflopRoles.coldCallers, ['P2']);
assert.strictEqual(a3.contributions[0].players.P2.foldToThreeBet.response, 'call');
assert.strictEqual(a3.finalizedRecords[0].settlement.chopped, true);

var a4 = replay.replayFixture(load('a4-short-nonfull-allin-runout-chop.sanitized.json'));
var shortRaise = a4.finalizedRecords[0].actions.find(function (action) {
  return action.playerId === 'P3' && action.type === 'raise';
});
assert.ok(shortRaise);
assert.strictEqual(shortRaise.isAllIn, true);
assert.strictEqual(shortRaise.isFullRaise, false);
assert.strictEqual(shortRaise.isShortAllInRaise, true);
assert.strictEqual(a4.contributions[0].players.P3.threeBet.opportunity, null);

var duplicate = replay.replayFixture(load('a3-open-coldcall-squeeze-showdown-chop.sanitized.json'), {
  prefixNoise: true,
  duplicateTerminal: true
});
assert.strictEqual(duplicate.finalizedRecords.length, 1);
assert.strictEqual(duplicate.contributions.length, 1);
assert.ok(duplicate.commitResults.some(function (result) { return result.duplicate === true; }));
assert.ok(duplicate.ledgerResults.some(function (result) { return result.duplicate === true; }));

console.log('Privacy-sanitized capture-derived preflop fixtures verify 3Bet, Fold-to-3Bet, squeeze ownership, short all-in nullability, and deduplication.');
