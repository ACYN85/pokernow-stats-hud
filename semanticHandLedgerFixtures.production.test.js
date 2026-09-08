'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var replay = require('./testSupport/captureDerivedPreflopProductionReplay.js');

var fixtureDirectory = path.join(__dirname, 'fixtures', 'capture-derived-preflop');
function load(file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), 'utf8'));
}

var normal = replay.replayFixture(load('a1-open-3bet-fold.sanitized.json'));
assert.strictEqual(normal.finalizedRecords.length, 1);
assert.strictEqual(normal.finalizedRecords[0].status, 'finalized');
assert.strictEqual(normal.finalizedRecords[0].mode, 'production_shadow');
assert.deepStrictEqual(normal.ledgerInspection.finalizedHandIds, ['A1-HAND']);
assert.strictEqual(normal.reducerInspection.coverage.reducedHandCount, 1);

var allIn = replay.replayFixture(load('a4-short-nonfull-allin-runout-chop.sanitized.json'));
var record = allIn.finalizedRecords[0];
assert.strictEqual(record.settlement.chopped, true);
assert.strictEqual(record.automaticRunout.detected, true);
assert.strictEqual(record.automaticRunout.postflopActionCount, 0);
assert.ok(record.actions.some(function (action) {
  return action.playerId === 'P3' && action.isShortAllInRaise === true;
}));
assert.deepStrictEqual(record.actions.filter(function (action) {
  return action.street === 'flop' || action.street === 'turn' || action.street === 'river';
}), []);

var duplicate = replay.replayFixture(load('a4-short-nonfull-allin-runout-chop.sanitized.json'), {
  duplicateTerminal: true
});
assert.strictEqual(duplicate.finalizedRecords.length, 1);
assert.ok(duplicate.ledgerResults.some(function (result) { return result.duplicate === true; }));

console.log('Privacy-sanitized capture-derived semantic-ledger fixtures verify finalization, automatic runout, chopped settlement, and duplicate suppression.');
