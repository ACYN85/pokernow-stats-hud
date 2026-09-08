'use strict';

var assert = require('assert');
var fs = require('fs');
var walk = require('./walkDetection.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var capture = JSON.parse(fs.readFileSync('./fixtures/synthetic-walk.json', 'utf8'));
var ids = { small: capture.beforeSettlement.sBPI, big: capture.beforeSettlement.bBPI };
var names = {};
Object.keys(capture.players).forEach(function (id) { names[id] = capture.players[id].name; });

var baseline = [{ handId: 'baseline', playerId: ids.big, player: names[ids.big], action: 'raise', street: 'preflop', amount: 60, timestamp: 1 }];
var accounting = hands.createState({ finalizedEvents: baseline });
hands.beginHand(accounting, capture.handId, { activate: true, timestamp: 10 });
capture.beforeSettlement.iHPI.forEach(function (playerId) {
  var initial = walk.createInitialHandEvent({
    handId: capture.handId,
    playerId: playerId,
    player: names[playerId],
    smallBlindPlayerId: ids.small,
    bigBlindPlayerId: ids.big,
    blindDeduction: null,
    timestamp: 10
  });
  hands.stageEvent(accounting, initial, { playerId: playerId, reason: 'synthetic verified blind assignment' });
});

var beforeFixEvents = accounting.stagedHands[capture.handId].events.slice();
assert.deepStrictEqual(beforeFixEvents.map(function (event) { return event.action; }), ['blind', 'blind']);
assert.strictEqual(walk.detectBigBlindWalk(beforeFixEvents, names[ids.big]).isWalk, false);

var settlementInput = {
  handId: capture.handId,
  street: capture.street,
  players: capture.players,
  participants: capture.beforeSettlement.iHPI,
  smallBlindPlayerId: ids.small,
  bigBlindPlayerId: ids.big,
  previousTb: capture.beforeSettlement.tB,
  currentTb: capture.settlementPatch.tB,
  stagedEvents: beforeFixEvents,
  boardCards: capture.beforeSettlement.board,
  settlement: capture.settlementPatch.gameResult,
  showdown: false,
  timestamp: 20
};
var preFixStats = stats.computePlayerStats(baseline.concat(beforeFixEvents), names[ids.big]);
assert.deepStrictEqual({ hands: preFixStats.handsPlayed, vpipOpportunities: preFixStats.vpipOpportunities, pfrOpportunities: preFixStats.pfrOpportunities, vpip: preFixStats.vpip, pfr: preFixStats.pfr }, { hands: 2, vpipOpportunities: 2, pfrOpportunities: 2, vpip: 50, pfr: 50 }, 'synthetic pre-fix path reproduces the 100% to 50% regression');

var inferredFold = walk.inferHeadsUpSettlementFold(settlementInput);
assert.ok(inferredFold, 'synthetic settlement must preserve authoritative fold evidence');
hands.stageEvent(accounting, inferredFold, { playerId: inferredFold.playerId, reason: inferredFold.evidence.kind });
assert.strictEqual(hands.commitHand(accounting, capture.handId, 'settlement/gameResult', 21).committed, true);
var finalized = accounting.finalizedEvents.filter(function (item) { return item.handId === capture.handId; });
assert.deepStrictEqual(finalized.map(function (item) { return item.action; }), ['blind', 'blind', 'fold']);
assert.strictEqual(walk.detectBigBlindWalk(finalized, names[ids.big]).isWalk, true);
var corrected = stats.computePlayerStats(accounting.finalizedEvents, names[ids.big]);
assert.deepStrictEqual({
  hands: corrected.handsPlayed,
  vpipHands: corrected.vpipHands,
  vpipOpportunities: corrected.vpipOpportunities,
  pfrHands: corrected.pfrHands,
  pfrOpportunities: corrected.pfrOpportunities,
  vpip: corrected.vpip,
  pfr: corrected.pfr
}, { hands: 2, vpipHands: 1, vpipOpportunities: 1, pfrHands: 1, pfrOpportunities: 1, vpip: 100, pfr: 100 });

function changed(overrides) {
  var copy = Object.assign({}, settlementInput, overrides || {});
  copy.players = Object.assign({}, settlementInput.players, overrides && overrides.players || {});
  copy.previousTb = Object.assign({}, settlementInput.previousTb, overrides && overrides.previousTb || {});
  copy.currentTb = Object.assign({}, settlementInput.currentTb, overrides && overrides.currentTb || {});
  return copy;
}

var sbCall = Object.assign({}, beforeFixEvents[0], { action: 'call', blindType: null, amount: 10 });
var bbCheck = Object.assign({}, beforeFixEvents[1], { action: 'check', blindType: null });
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ stagedEvents: beforeFixEvents.concat([sbCall, bbCheck]) })), null, 'SB limp and BB check is not a walk');
var sbRaise = Object.assign({}, sbCall, { action: 'raise', amount: 60 });
var bbCall = Object.assign({}, bbCheck, { action: 'call', amount: 40 });
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ stagedEvents: beforeFixEvents.concat([sbRaise, bbCall]) })), null, 'BB call rejects settlement fold inference');
var bbRaise = Object.assign({}, bbCheck, { action: 'raise', amount: 60 });
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ stagedEvents: beforeFixEvents.concat([bbRaise]) })), null, 'BB raise rejects settlement fold inference');
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ street: 'flop', boardCards: ['As', 'Kd', '2c'] })), null, 'a flop rejects settlement fold inference');
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ showdown: true })), null, 'showdown rejects settlement fold inference');
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ stagedEvents: beforeFixEvents.concat([sbCall]) })), null, 'winner after voluntary action is not a walk');
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ bigBlindPlayerId: '<D>' })), null, 'uncertain blind identity rejects inference');
var nonBigBlindWinner = {};
nonBigBlindWinner[ids.small] = { position: 1 };
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ settlement: nonBigBlindWinner })), null, 'similar deletion settlement won by the non-BB is rejected');
var multiwayPlayers = {};
multiwayPlayers['third-id'] = { name: 'third' };
var multiwayPreviousTb = {};
multiwayPreviousTb['third-id'] = 0;
var multiwayCurrentTb = {};
multiwayCurrentTb['third-id'] = '<D>';
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ participants: [ids.small, ids.big, 'third-id'], players: multiwayPlayers, previousTb: multiwayPreviousTb, currentTb: multiwayCurrentTb })), null, 'multiway settlement is rejected');
assert.strictEqual(walk.inferHeadsUpSettlementFold(changed({ stagedEvents: beforeFixEvents.concat([inferredFold]) })), null, 'duplicate settlement cannot create a second fold');

var productionSource = fs.readFileSync('./content.js', 'utf8');
var integrationCall = productionSource.indexOf('var settlementFolds = inferCapturedSettlementFolds(');
var integrationStage = productionSource.indexOf('events.push(settlementFold)', integrationCall);
var snapshotAdvance = productionSource.indexOf('previousGcSnapshot = currentSnapshot', integrationStage);
var finalizationReturn = productionSource.indexOf('finalizeHandId:', snapshotAdvance);
assert.ok(integrationCall >= 0, 'production gc handler invokes the synthetic-settlement evidence adapter');
assert.ok(integrationStage > integrationCall, 'authoritative fold evidence enters the ordinary event staging array');
assert.ok(snapshotAdvance > integrationStage, 'fold evidence is preserved before the prior snapshot advances');
assert.ok(finalizationReturn > snapshotAdvance, 'fold evidence is returned before the settlement requests finalization');

console.log('Synthetic settlement walk regression passed.');
