'use strict';

var assert = require('assert');
var fs = require('fs');
var stats = require('./stats.js');
var hands = require('./handFinalization.js');

function event(handId, playerId, player, action, fields) {
  return Object.assign({ handId: handId, playerId: playerId, player: player, action: action || 'fold', street: 'preflop', amount: 0, timestamp: Number(String(handId).replace(/\D/g, '')) || 1 }, fields || {});
}

var baseline = [];
for (var hand = 1; hand <= 26; hand += 1) {
  baseline.push(event('H' + hand, 'NALAVO-ID', 'nalavo', hand <= 5 ? 'call' : 'fold'));
}
baseline[0].action = 'raise';
baseline[1].action = 'raise';
baseline[2].action = 'raise';
baseline[3].action = 'raise';
Object.assign(baseline[5], { threeBetMade: 1, threeBetOpportunities: 1, preflopOpportunityContributionId: 'preflop:1:H6:NALAVO-ID' });
for (var opportunity = 6; opportunity < 19; opportunity += 1) baseline[opportunity].threeBetOpportunities = 1;
Object.assign(baseline[19], { foldToThreeBet: 0, foldToThreeBetOpportunities: 1 });
Object.assign(baseline[20], { flopCBetMade: 1, flopCBetOpportunities: 1, flopCBetContributionId: 'flop-cbet:1:H21:NALAVO-ID' });
Object.assign(baseline[21], { foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1 });
Object.assign(baseline[22], { foldToFlopCBet: 0, foldToFlopCBetOpportunities: 1 });
Object.assign(baseline[23], { sawFlopForWTSD: 1, wentToShowdown: 0 });

var before = stats.computePlayerStatsByIdentity(baseline, 'NALAVO-ID', 'nalavo');
assert.deepStrictEqual({
  hands: before.handsPlayed,
  vpip: before.vpip,
  pfr: before.pfr,
  threeBet: [before.threeBetMade, before.threeBetOpportunities, before.threeBetPercent],
  f3b: [before.foldToThreeBet, before.foldToThreeBetOpportunities, before.foldToThreeBetPercent],
  cbet: [before.flopCBetMade, before.flopCBetOpportunities],
  fcb: [before.foldToFlopCBet, before.foldToFlopCBetOpportunities]
}, {
  hands: 26,
  vpip: 19.2,
  pfr: 15.4,
  threeBet: [1, 14, 7.1],
  f3b: [0, 1, 0],
  cbet: [1, 1],
  fcb: [1, 2]
});

var h27 = event('H27', 'NALAVO-ID', 'nalavo', 'call', {
  foldToThreeBet: 1,
  foldToThreeBetOpportunities: 1,
  flopCBetMade: 0,
  flopCBetOpportunities: 1,
  foldToFlopCBet: 0,
  foldToFlopCBetOpportunities: 1,
  sawFlopForWTSD: 1,
  wentToShowdown: 1,
  showdownsForWSD: 1,
  wonMoneyAtShowdown: 1
});
var after = stats.computePlayerStatsByIdentity(baseline.concat(h27), 'NALAVO-ID', 'nalavo');
assert.deepStrictEqual([after.flopCBetMade, after.flopCBetOpportunities], [1, 2], 'one declined CBet opportunity changes 100% to 50%, never 0%');
assert.deepStrictEqual([after.foldToFlopCBet, after.foldToFlopCBetOpportunities], [1, 3], 'one non-fold FCB response changes 50% to 33.3%, never 0%');
assert.deepStrictEqual([after.foldToThreeBet, after.foldToThreeBetOpportunities, after.foldToThreeBetPercent], [1, 2, 50], 'one new fold can move supported 0% F3B to at most 50%');
assert.deepStrictEqual(stats.authoritativeCounterRegressions(before, after), [], 'a normal finalized hand is componentwise monotonic');

var lostHistory = baseline.filter(function (item) { return item.handId !== 'H21' && item.handId !== 'H22'; }).concat(h27);
var lost = stats.computePlayerStatsByIdentity(lostHistory, 'NALAVO-ID', 'nalavo');
var regressions = stats.authoritativeCounterRegressions(before, lost);
assert.ok(regressions.some(function (item) { return item.field === 'flopCBetMade' && item.before === 1 && item.after === 0; }), 'the screenshot-shaped CBet fall requires a historical contribution to disappear');
assert.ok(regressions.some(function (item) { return item.field === 'foldToFlopCBet' && item.before === 1 && item.after === 0; }), 'the screenshot-shaped FCB fall requires a historical contribution to disappear');

var writes = [];
var callbacks = [];
var queue = stats.createSerializedPersistenceQueue(function (payload, revision, done) {
  writes.push({ payload: payload, revision: revision });
  callbacks.push(done);
}, { initialRevision: 10, maxHistory: 10 });
assert.strictEqual(queue.enqueue({ live: ['old'] }), 11);
assert.strictEqual(queue.enqueue({ live: ['middle'] }), 12);
assert.strictEqual(queue.enqueue({ live: ['newest'] }), 13);
assert.deepStrictEqual(writes.map(function (item) { return item.revision; }), [11], 'only one authoritative snapshot is in flight');
callbacks.shift()(null);
assert.deepStrictEqual(writes.map(function (item) { return item.revision; }), [11, 13], 'superseded pending snapshots coalesce to the newest revision');
assert.deepStrictEqual(writes[1].payload.live, ['newest']);
callbacks.shift()(null);
assert.strictEqual(queue.inspect().completedRevision, 13);

var duplicateNameEvents = [
  event('I1', 'NALAVO-ID', 'nalavo', 'raise'),
  event('I2', 'OTHER-ID', 'nalavo', 'raise')
];
assert.strictEqual(stats.computePlayerStats(duplicateNameEvents, 'nalavo').handsPlayed, 2, 'legacy display-name lookup demonstrates the collision');
assert.strictEqual(stats.computePlayerStatsByIdentity(duplicateNameEvents, 'NALAVO-ID', 'nalavo').handsPlayed, 1, 'live lookup is isolated by stable player ID');

var annotated = event('RECONCILE', 'NALAVO-ID', 'nalavo', 'raise', {
  flopCBetMade: 1,
  flopCBetOpportunities: 1,
  flopCBetContributionId: 'flop-cbet:1:RECONCILE:NALAVO-ID'
});
var accounting = hands.createState({ finalizedEvents: [annotated], finalizedHandIds: ['RECONCILE'] });
hands.beginHand(accounting, 'RECONCILE', { activate: false, timestamp: 100 });
hands.stageEvent(accounting, event('RECONCILE', 'NALAVO-ID', 'nalavo', 'raise'), { playerId: 'NALAVO-ID', reason: 'replayed exact action' });
hands.stageEvent(accounting, event('RECONCILE', 'OTHER-ID', 'Other', 'fold'), { playerId: 'OTHER-ID', reason: 'later authoritative reconciliation fact' });
assert.strictEqual(hands.commitHand(accounting, 'RECONCILE', 'authoritative reconciliation', 101).reconciled, true);
var retained = accounting.finalizedEvents.find(function (item) { return item.playerId === 'NALAVO-ID'; });
assert.strictEqual(retained.flopCBetContributionId, annotated.flopCBetContributionId, 'table-context reconciliation copies retain prior reducer annotations and IDs');
assert.deepStrictEqual([retained.flopCBetMade, retained.flopCBetOpportunities], [1, 1]);

var source = fs.readFileSync('./content.js', 'utf8');
assert.match(source, /createSerializedPersistenceQueue\(writeAuthoritativeStorageSnapshot/);
assert.match(source, /incoming snapshot would decrease cumulative counters/);
assert.match(source, /if \(regressions\.length && handAccounting\) persistHandAccounting\(\)/, 'a rejected regressive external snapshot is repaired with the retained authoritative state');
assert.match(source, /PokerNowHUDProfiles[\s\S]*statsDebug: statsDebug/);
assert.match(source, /var stats = seatHudStatsForPlayer\(stringPlayerId, mapping\.name\)/, 'seat overlays route through the global Session/Career source adapter');
assert.match(source, /if \(currentSeatHudStatSource\(\) !== 'career'\) return cachedSessionPlayerStats\(playerId, playerName\)/, 'Session seat overlays still share the authoritative Session-stat cache');
assert.doesNotMatch(source, /playerProfileShadowState[^;]*authoritativeCounter/i, 'profile state is not an authoritative statistics owner');

console.log('Core statistics continuity, stable identity, and H26-to-H27 invariant regressions passed.');
