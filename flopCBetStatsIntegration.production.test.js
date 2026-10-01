'use strict';

var assert = require('assert');
var fs = require('fs');
var reducer = require('./flopCBetOpportunityReducer');
var stats = require('./stats');
var fixtures = require('./testSupport/flopCBetOpportunityFixtures');
var COUNTERS = ['flopCBetMade', 'flopCBetOpportunities', 'foldToFlopCBet', 'foldToFlopCBetOpportunities'];

function eventsFor(record) {
  return record.players.map(function (player, index) {
    return {
      eventKey: record.handIdentity.lifecycleHandId + ':' + player.playerId + ':dealt',
      handId: record.handIdentity.lifecycleHandId,
      playerId: player.playerId,
      player: player.playerId,
      seat: index + 1,
      action: 'dealt',
      street: 'preflop',
      amount: 0,
      timestamp: index + 1
    };
  });
}

function values(events, playerName) {
  var result = stats.computePlayerStats(events, playerName);
  return COUNTERS.map(function (field) { return result[field]; });
}

function integrate(name) {
  var record = fixtures[name];
  var contribution = reducer.deriveContribution(record);
  var events = eventsFor(record);
  var before = {};
  record.players.forEach(function (player) {
    var value = stats.computePlayerStats(events, player.playerId);
    before[player.playerId] = [value.vpip, value.pfr, value.af, value.threeBetMade, value.threeBetOpportunities, value.foldToThreeBet, value.foldToThreeBetOpportunities];
  });
  var integration = stats.applyFlopCBetContribution(events, contribution);
  record.players.forEach(function (player) {
    var value = stats.computePlayerStats(integration.events, player.playerId);
    assert.deepStrictEqual(
      [value.vpip, value.pfr, value.af, value.threeBetMade, value.threeBetOpportunities, value.foldToThreeBet, value.foldToThreeBetOpportunities],
      before[player.playerId],
      name + ' leaves existing statistics unchanged'
    );
  });
  return { record: record, contribution: contribution, events: events, integration: integration };
}

var p1 = integrate('C1');
assert.deepStrictEqual(values(p1.integration.events, 'A'), [1, 1, 0, 0]);
assert.deepStrictEqual(values(p1.integration.events, 'B'), [0, 0, 1, 1]);
var p2 = integrate('C2');
assert.deepStrictEqual(values(p2.integration.events, 'A'), [1, 1, 0, 0]);
assert.deepStrictEqual(values(p2.integration.events, 'B'), [0, 0, 0, 1]);
var p3 = integrate('C3');
assert.deepStrictEqual(values(p3.integration.events, 'A'), [0, 1, 0, 0]);
assert.deepStrictEqual(values(p3.integration.events, 'B'), [0, 0, 0, 0]);
var p4 = integrate('C4');
assert.deepStrictEqual(values(p4.integration.events, 'A'), [0, 0, 0, 0]);
assert.deepStrictEqual(values(p4.integration.events, 'B'), [0, 0, 0, 0]);
var p5 = integrate('C5');
assert.deepStrictEqual(values(p5.integration.events, 'A'), [1, 1, 0, 0]);
assert.deepStrictEqual(values(p5.integration.events, 'B'), [0, 0, 1, 1]);
assert.deepStrictEqual(values(p5.integration.events, 'C'), [0, 0, 0, 1]);
var p6 = integrate('C6');
assert.deepStrictEqual(values(p6.integration.events, 'B'), [1, 1, 0, 0], 'P6 3-bettor owns the CBet');
assert.deepStrictEqual(values(p6.integration.events, 'A'), [0, 0, 0, 0]);
var p7 = integrate('C7');
assert.deepStrictEqual(values(p7.integration.events, 'A'), [1, 1, 0, 0], 'P7 4-bettor owns the CBet');
assert.deepStrictEqual(values(p7.integration.events, 'B'), [0, 0, 0, 0]);
var p8 = integrate('C8');
assert.deepStrictEqual(values(p8.integration.events, 'A'), [0, 0, 0, 0]);
assert.deepStrictEqual(values(p8.integration.events, 'B'), [0, 0, 0, 0]);
var p9 = integrate('C9');
assert.strictEqual(p9.integration.changed, false, 'P9 unsupported ordering does not annotate events');
['A', 'B', 'C'].forEach(function (playerId) {
  assert.deepStrictEqual(values(p9.integration.events, playerId), [0, 0, 0, 0]);
});

assert.notStrictEqual(p1.record.handIdentity.lifecycleHandId, p1.record.handIdentity.handId);
assert.strictEqual(p1.integration.changed, true, 'P10 matches the explicit lifecycle alias');
assert.ok(p1.integration.events.every(function (event) {
  return event.flopCBetOpportunityHandId === event.handId;
}), 'P10 stores the exact finalized lifecycle identity');
var duplicate = stats.applyFlopCBetContribution(p1.integration.events, p1.contribution);
assert.strictEqual(duplicate.changed, false, 'duplicate reducer invocation is rejected by contribution identity');
assert.deepStrictEqual(values(duplicate.events, 'A'), [1, 1, 0, 0]);
assert.deepStrictEqual(values(duplicate.events, 'B'), [0, 0, 1, 1]);

var legacyEvent = {
  handId: 'legacy', playerId: 'LEGACY', player: 'Legacy', action: 'raise', street: 'preflop', amount: 40, timestamp: 1,
  threeBetMade: 1, threeBetOpportunities: 1, foldToThreeBet: 0, foldToThreeBetOpportunities: 1
};
var legacy = stats.computePlayerStats(JSON.parse(JSON.stringify([legacyEvent])), 'Legacy');
assert.deepStrictEqual(COUNTERS.map(function (field) { return legacy[field]; }), [0, 0, 0, 0], 'P15 missing CBet fields normalize to zero');
assert.deepStrictEqual(
  [legacy.vpipHands, legacy.pfrHands, legacy.af, legacy.threeBetMade, legacy.threeBetOpportunities, legacy.foldToThreeBet, legacy.foldToThreeBetOpportunities],
  [1, 1, 0, 1, 1, 0, 1],
  'P15 existing values survive restoration'
);

var stable = stats.applyFlopCBetContribution([
  { handId: 'lifecycle-C1', playerId: 'A', player: 'Alice', seat: 1, action: 'dealt', street: 'preflop' },
  { handId: 'lifecycle-C1', playerId: 'OTHER', player: 'Alice', seat: 2, action: 'dealt', street: 'preflop' }
], { reducerVersion: 1, handIdentity: { lifecycleHandId: 'lifecycle-C1', handId: 'C1' }, players: { A: p1.contribution.players.A } });
assert.deepStrictEqual(stable.appliedPlayerIds, ['A']);
assert.strictEqual(stable.events[1].flopCBetMade, undefined, 'P16 same-name player never receives another stable ID contribution');
var restoredAfterSeatChange = JSON.parse(JSON.stringify(stable.events)).map(function (event) {
  if (event.playerId === 'A') return Object.assign({}, event, { player: 'Alice Returned', seat: 8 });
  return Object.assign({}, event, { player: 'Other Alice', seat: 1 });
});
assert.deepStrictEqual(values(restoredAfterSeatChange, 'Alice Returned'), [1, 1, 0, 0], 'P16 leave/return/seat-change retains counters on the stable-player event');
assert.deepStrictEqual(values(restoredAfterSeatChange, 'Other Alice'), [0, 0, 0, 0]);

assert.deepStrictEqual(values([], 'A'), [0, 0, 0, 0], 'P17 Reset Session empty event state clears session counters');
var allTime = stats.combinePlayerStats('A', [stats.computePlayerStats(p1.integration.events, 'A')]);
assert.deepStrictEqual(COUNTERS.map(function (field) { return allTime[field]; }), [1, 1, 0, 0], 'P17 all-time aggregation remains independent of session reset');

var accumulated = [];
['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'].forEach(function (name) {
  var record = fixtures[name];
  accumulated = accumulated.concat(eventsFor(record));
  accumulated = stats.applyFlopCBetContribution(accumulated, reducer.deriveContribution(record)).events;
});
assert.deepStrictEqual(values(accumulated, 'A'), [4, 5, 0, 0], 'P18 A sums only supported CBet contributions');
assert.deepStrictEqual(values(accumulated, 'B'), [1, 1, 2, 3], 'P18 B sums supported CBet and response contributions');
assert.deepStrictEqual(values(accumulated, 'C'), [0, 0, 0, 1], 'P18 C includes only the supported multiway call response');

['seatOverlay.js', 'leaderboardStats.js', 'popup.js', 'settingsUi.js'].forEach(function (file) {
  var source = fs.readFileSync(file, 'utf8');
  if (file === 'seatOverlay.js') source = source.replace(/  function careerStatsToOverlayStats\([\s\S]*?\n  function rowItems\(/, '  function rowItems(');
  COUNTERS.forEach(function (field) {
    assert.strictEqual(source.includes(field), false, file + ' does not duplicate calculation ownership for ' + field);
  });
});
assert.ok(fs.readFileSync('seatOverlay.js', 'utf8').includes('function careerStatsToOverlayStats(value)'), 'the isolated Career-to-existing-HUD shape adapter may read authoritative counters without owning their calculation');
var visibleRegistrySource = fs.readFileSync('overlayStats.js', 'utf8');
COUNTERS.forEach(function (field) {
  assert.strictEqual(visibleRegistrySource.includes(field), true, 'the shared visible registry maps authoritative ' + field);
});
assert.strictEqual(fs.readFileSync('content.js', 'utf8').includes('globalThis.PokerNowRuntimeScope.buildId'), true, 'the content script consumes the canonical runtime Build ID while preserving certified stats');

console.log('Authoritative Flop CBet counter ingestion P1-P10 and P15-P18 tests passed.');
