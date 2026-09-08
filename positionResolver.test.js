'use strict';
var assert = require('assert'); var resolver = require('./positionResolver.js');
var expected = {
  2: ['BTN','BB'], 3: ['BTN','SB','BB'], 4: ['BTN','SB','BB','CO'],
  5: ['BTN','SB','BB','UTG','CO'], 6: ['BTN','SB','BB','UTG','HJ','CO'],
  7: ['BTN','SB','BB','UTG','LJ','HJ','CO'],
  8: ['BTN','SB','BB','UTG','UTG+1','LJ','HJ','CO'],
  9: ['BTN','SB','BB','UTG','UTG+1','UTG+2','LJ','HJ','CO']
};
function fixture(count) {
  var ids = Array.from({length:count}, function (_, index) { return 'P'+index; });
  var seats = ids.map(function (id, index) { return [index * 2 + 1, id]; });
  return { dealtPlayerIds: ids, seats: seats, buttonPlayerId: ids[0], smallBlindPlayerId: count === 2 ? ids[0] : ids[1], bigBlindPlayerId: count === 2 ? ids[1] : ids[2] };
}
Object.keys(expected).forEach(function (key) {
  var count = Number(key); var input = fixture(count); var result = resolver.resolve(input);
  assert.strictEqual(result.status, 'supported', count+' handed position is supported');
  assert.deepStrictEqual(input.dealtPlayerIds.map(function (id) { return result.assignments[id]; }), expected[count]);
  assert.strictEqual(new Set(Object.keys(result.assignments)).size, count, 'every '+count+' handed player is assigned exactly once');
});
var hu = resolver.resolve(fixture(2)); assert.strictEqual(hu.assignments.P0, 'BTN'); assert.strictEqual(hu.evidence.smallBlindPlayerId, 'P0'); assert.strictEqual(hu.assignments.P1, 'BB');
var joined = fixture(6); joined.seats.push([14,'JOINED']); assert.strictEqual(resolver.resolve(joined).status, 'supported', 'a seated join not dealt into the frozen hand is ignored');
var left = fixture(6); left.seats.push([15,'LEFT']); assert.strictEqual(resolver.resolve(left).assignments.LEFT, undefined, 'a nondealt leave/rebuy roster entry is never assigned');
var changedAfterStart = fixture(6); var frozen = JSON.parse(JSON.stringify(changedAfterStart)); changedAfterStart.seats.reverse(); assert.deepStrictEqual(resolver.resolve(frozen).assignments, resolver.resolve(frozen).assignments, 'frozen start evidence is independent from later seat changes');
var missingSeat = fixture(5); missingSeat.seats.pop(); assert.strictEqual(resolver.resolve(missingSeat).status, 'unsupported');
var observer = fixture(4); observer.seats.push([12,'OBSERVER']); assert.strictEqual(resolver.resolve(observer).assignments.OBSERVER, undefined);
var conflict = fixture(5); conflict.smallBlindPlayerId = 'P4'; assert.match(resolver.resolve(conflict).reason, /conflict/);
var dead = fixture(5); dead.deadButton = true; assert.match(resolver.resolve(dead).reason, /dead-button/);
var duplicateSeat = fixture(4); duplicateSeat.seats[3][0] = duplicateSeat.seats[2][0]; assert.strictEqual(resolver.resolve(duplicateSeat).status, 'unsupported');
var missingButton = fixture(4); missingButton.buttonPlayerId = null; assert.strictEqual(resolver.resolve(missingButton).status, 'unsupported');
var unusualBlind = fixture(4); unusualBlind.bigBlindPlayerId = 'P3'; assert.strictEqual(resolver.resolve(unusualBlind).status, 'unsupported');
console.log('Canonical certified 2-9 handed position mapping, HU, roster churn, seats, observers, blinds, dead-button, and ambiguity tests passed.');
