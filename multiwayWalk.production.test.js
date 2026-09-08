'use strict';

var assert = require('assert');
var walk = require('./walkDetection.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

function scenario(handId, playerCount, options) {
  options = options || {};
  var ids = [];
  var players = {};
  for (var index = 0; index < playerCount; index += 1) {
    var id = 'p' + (index + 1);
    ids.push(id);
    players[id] = { name: index === playerCount - 1 ? 'BB' : (index === playerCount - 2 ? 'SB' : 'P' + (index + 1)) };
  }
  (options.sittingOutIds || []).forEach(function (id) {
    players[id] = { name: 'Sitting Out ' + id, status: 'sittingOut' };
  });
  var smallBlindId = ids[ids.length - 2];
  var bigBlindId = ids[ids.length - 1];
  var stagedEvents = ids.map(function (playerId, eventIndex) {
    return walk.createInitialHandEvent({
      handId: handId,
      playerId: playerId,
      player: players[playerId].name,
      smallBlindPlayerId: smallBlindId,
      bigBlindPlayerId: bigBlindId,
      timestamp: 100 + eventIndex
    });
  }).concat(options.extraEvents || []);
  var previousTb = {};
  previousTb[smallBlindId] = 10;
  previousTb[bigBlindId] = 20;
  var currentTb = {};
  ids.forEach(function (playerId) { currentTb[playerId] = '<D>'; });
  var settlement = {};
  settlement[bigBlindId] = { position: 1, gained: 20 };
  return {
    handId: handId,
    street: 'preflop',
    players: players,
    participants: ids,
    smallBlindPlayerId: smallBlindId,
    bigBlindPlayerId: bigBlindId,
    previousTb: previousTb,
    currentTb: currentTb,
    stagedEvents: stagedEvents,
    boardCards: [],
    settlement: settlement,
    showdown: false,
    bigBlindCheck: false,
    timestamp: 200,
    ids: ids
  };
}

function finalizeScenario(input, baselineEvents) {
  var accounting = hands.createState({ finalizedEvents: baselineEvents || [] });
  hands.beginHand(accounting, input.handId, { activate: true, timestamp: 100 });
  input.stagedEvents.forEach(function (item) {
    hands.stageEvent(accounting, item, { playerId: item.playerId, reason: 'verified production participant/action' });
  });
  var evaluation = walk.evaluateSettlementWalk(Object.assign({}, input, {
    stagedEvents: accounting.stagedHands[input.handId].events.slice()
  }));
  evaluation.inferredFolds.forEach(function (item) {
    hands.stageEvent(accounting, item, { playerId: item.playerId, reason: item.evidence.kind });
  });
  var commit = hands.commitHand(accounting, input.handId, 'settlement/gameResult', 201);
  return { accounting: accounting, evaluation: evaluation, commit: commit };
}

[
  { playerCount: 3, label: 'three-handed button and small blind fold' },
  { playerCount: 4, label: 'four-handed two early players and small blind fold' },
  { playerCount: 6, label: 'six-handed all players fold to the big blind' }
].forEach(function (fixture, fixtureIndex) {
  var input = scenario('multiway-' + fixture.playerCount, fixture.playerCount);
  var result = finalizeScenario(input);
  assert.strictEqual(result.evaluation.isWalk, true, fixture.label + ' is structurally recognized at settlement');
  assert.strictEqual(result.evaluation.inferredFolds.length, fixture.playerCount - 1, fixture.label + ' preserves every missing fold');
  assert.strictEqual(result.commit.committed, true);
  var finalized = result.accounting.finalizedEvents.filter(function (item) { return item.handId === input.handId; });
  assert.strictEqual(finalized.filter(function (item) { return item.action === 'fold'; }).length, fixture.playerCount - 1);
  assert.strictEqual(walk.detectBigBlindWalk(finalized, 'BB').isWalk, true);
  var bbStats = stats.computePlayerStats(finalized, 'BB');
  assert.deepStrictEqual({
    hands: bbStats.handsPlayed,
    vpipHands: bbStats.vpipHands,
    vpipOpportunities: bbStats.vpipOpportunities,
    pfrOpportunities: bbStats.pfrOpportunities
  }, { hands: 1, vpipHands: 0, vpipOpportunities: 0, pfrOpportunities: 0 });
  input.ids.slice(0, -1).forEach(function (playerId) {
    var playerStats = stats.computePlayerStats(finalized, input.players[playerId].name);
    assert.deepStrictEqual({
      hands: playerStats.handsPlayed,
      vpipHands: playerStats.vpipHands,
      vpipOpportunities: playerStats.vpipOpportunities
    }, { hands: 1, vpipHands: 0, vpipOpportunities: 1 }, fixture.label + ' preserves the existing opportunity model for folding players');
  });
});

var sittingOut = scenario('sitting-out-walk', 4, { sittingOutIds: ['away-1', 'away-2'] });
var sittingOutResult = finalizeScenario(sittingOut);
assert.strictEqual(sittingOutResult.evaluation.isWalk, true);
assert.deepStrictEqual(sittingOutResult.evaluation.eligiblePreflopPlayerIds, sittingOut.ids, 'only dealt/in-hand participants are eligible');
assert.strictEqual(sittingOutResult.evaluation.inferredFolds.some(function (item) { return /^away-/.test(item.playerId); }), false, 'sitting-out roster records do not receive synthetic folds');

var duplicateInput = scenario('duplicate-walk', 4);
var duplicateAccounting = hands.createState();
hands.beginHand(duplicateAccounting, duplicateInput.handId, { activate: true, timestamp: 100 });
duplicateInput.stagedEvents.forEach(function (item) {
  hands.stageEvent(duplicateAccounting, item, { playerId: item.playerId, reason: 'verified participant' });
});
var firstFolds = walk.inferSettlementFolds(Object.assign({}, duplicateInput, { stagedEvents: duplicateAccounting.stagedHands[duplicateInput.handId].events }));
firstFolds.forEach(function (item) { hands.stageEvent(duplicateAccounting, item, { playerId: item.playerId, reason: item.evidence.kind }); });
var replayFolds = walk.inferSettlementFolds(Object.assign({}, duplicateInput, { stagedEvents: duplicateAccounting.stagedHands[duplicateInput.handId].events }));
assert.deepStrictEqual(replayFolds, [], 'replayed settlement emits no duplicate fold evidence');
assert.strictEqual(hands.commitHand(duplicateAccounting, duplicateInput.handId, 'settlement', 201).committed, true);
var duplicateCommit = hands.commitHand(duplicateAccounting, duplicateInput.handId, 'duplicate settlement', 202);
assert.strictEqual(duplicateCommit.committed, false);
assert.strictEqual(duplicateCommit.duplicate, true, 'replayed settlement cannot finalize the same walk twice');

var limpCheck = scenario('limp-check', 3);
limpCheck.stagedEvents.push({
  handId: limpCheck.handId, playerId: limpCheck.smallBlindPlayerId, player: 'SB',
  action: 'call', street: 'preflop', amount: 10, timestamp: 150
});
limpCheck.stagedEvents.push({
  handId: limpCheck.handId, playerId: limpCheck.bigBlindPlayerId, player: 'BB',
  action: 'check', street: 'preflop', amount: 0, timestamp: 151
});
assert.strictEqual(walk.evaluateSettlementWalk(limpCheck).isWalk, false, 'small blind limp and big blind check is not a walk');
assert.match(walk.evaluateSettlementWalk(limpCheck).reason, /voluntary preflop action/);

var callThenFold = scenario('call-fold', 4);
callThenFold.stagedEvents.push({
  handId: callThenFold.handId, playerId: callThenFold.ids[0], player: callThenFold.players[callThenFold.ids[0]].name,
  action: 'call', street: 'preflop', amount: 20, timestamp: 150
});
callThenFold.stagedEvents.push({
  handId: callThenFold.handId, playerId: callThenFold.ids[0], player: callThenFold.players[callThenFold.ids[0]].name,
  action: 'fold', street: 'preflop', amount: 0, timestamp: 151
});
assert.strictEqual(walk.evaluateSettlementWalk(callThenFold).isWalk, false, 'a caller who later folds prevents a walk');

var raiseFold = scenario('raise-fold', 5);
raiseFold.stagedEvents.push({
  handId: raiseFold.handId, playerId: raiseFold.ids[0], player: raiseFold.players[raiseFold.ids[0]].name,
  action: 'raise', street: 'preflop', amount: 60, timestamp: 150
});
raiseFold.ids.slice(1).forEach(function (playerId, index) {
  raiseFold.stagedEvents.push({
    handId: raiseFold.handId, playerId: playerId, player: raiseFold.players[playerId].name,
    action: 'fold', street: 'preflop', amount: 0, timestamp: 151 + index
  });
});
assert.strictEqual(walk.evaluateSettlementWalk(raiseFold).isWalk, false, 'a raise followed by folds is not a walk');

var preservedInput = scenario('preserved-denominator', 4);
var baseline = [{
  handId: 'prior',
  playerId: preservedInput.bigBlindPlayerId,
  player: 'BB',
  action: 'call',
  street: 'preflop',
  amount: 20,
  timestamp: 1
}];
var preservedResult = finalizeScenario(preservedInput, baseline);
var before = stats.computePlayerStats(baseline, 'BB');
var after = stats.computePlayerStats(preservedResult.accounting.finalizedEvents, 'BB');
assert.deepStrictEqual({
  numeratorBefore: before.vpipHands,
  numeratorAfter: after.vpipHands,
  denominatorBefore: before.vpipOpportunities,
  denominatorAfter: after.vpipOpportunities
}, { numeratorBefore: 1, numeratorAfter: 1, denominatorBefore: 1, denominatorAfter: 1 }, 'a true multiway walk changes neither the BB VPIP numerator nor denominator');

console.log('Multiway Big Blind walk production regressions passed.');
