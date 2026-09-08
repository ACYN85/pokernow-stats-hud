'use strict';

var assert = require('assert');
var recovery = require('./interruptedHandRecovery.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var fingerprint = recovery.fingerprint({
  explicitHandId: 'deal-17',
  participantIds: ['playerA-id', 'playerB-id'],
  smallBlindPlayerId: 'playerA-id',
  bigBlindPlayerId: 'playerB-id',
  dealerOrButton: 'playerA-id',
  boardCardCount: 0,
  settlementPresent: false
});
var accounting = hands.createState({ finalizedEvents: [] });
hands.beginHand(accounting, 'socket-hand-17', { activate: true, timestamp: 1 });
hands.addParticipant(accounting, 'socket-hand-17', { playerId: 'playerA-id', name: 'PlayerA', evidence: 'iHPI', timestamp: 1 });
hands.addParticipant(accounting, 'socket-hand-17', { playerId: 'playerB-id', name: 'PlayerB', evidence: 'iHPI', timestamp: 1 });
var preRaise = { handId: 'socket-hand-17', playerId: 'playerA-id', player: 'PlayerA', action: 'raise', street: 'preflop', amount: 60, timestamp: 2, eventKey: 'h17|playerA|raise|preflop|60|1' };
var preCall = { handId: 'socket-hand-17', playerId: 'playerB-id', player: 'PlayerB', action: 'call', street: 'preflop', amount: 40, timestamp: 3, eventKey: 'h17|playerB|call|preflop|40|1' };
hands.stageEvent(accounting, preRaise, { playerId: 'playerA-id', reason: 'verified raise' });
hands.stageEvent(accounting, preCall, { playerId: 'playerB-id', reason: 'verified call' });
hands.setRecoveryMetadata(accounting, 'socket-hand-17', { fingerprint: fingerprint, pausedVerified: true, lifecycleAtPersistence: 'temporarily stopped', timestamp: 4 });

var persisted = hands.serializeActiveHand(accounting);
var restoredAccounting = hands.createState({ finalizedEvents: [], activeHand: persisted });
var recoveryState = recovery.createState(hands.activeHand(restoredAccounting));
var currentFingerprint = recovery.fingerprint(Object.assign({}, fingerprint, { boardCardCount: 3 }));
var claim = recovery.attempt(recoveryState, {
  timestamp: 10,
  lifecycleInactive: true,
  persistedPausedVerified: true,
  bootstrapFingerprint: currentFingerprint
});
assert.strictEqual(claim.claimed, true, 'paused bootstrap reclaims the same unfinished hand');
assert.strictEqual(hands.reclaimRecoveredHand(restoredAccounting, 'socket-hand-17', { timestamp: 10, sameHandEvidence: claim.comparison.evidence }).reclaimed, true);
assert.strictEqual(recovery.remainsSameHand(recoveryState, recovery.fingerprint(Object.assign({}, fingerprint, { boardCardCount: 4 }))), true, 'flop/turn/river board progression remains the same hand');

assert.strictEqual(hands.stageEvent(restoredAccounting, preRaise, { playerId: 'playerA-id', reason: 'replayed pre-reload action' }).duplicate, true, 'persisted pre-reload action is not duplicated');
recoveryState.duplicateActionsSkipped += 1;
var flopBet = { handId: 'socket-hand-17', playerId: 'playerA-id', player: 'PlayerA', action: 'bet', street: 'flop', amount: 80, timestamp: 11, eventKey: 'h17|playerA|bet|flop|80|1' };
var flopCall = { handId: 'socket-hand-17', playerId: 'playerB-id', player: 'PlayerB', action: 'call', street: 'flop', amount: 80, timestamp: 12, eventKey: 'h17|playerB|call|flop|80|1' };
var turnBet = { handId: 'socket-hand-17', playerId: 'playerB-id', player: 'PlayerB', action: 'bet', street: 'turn', amount: 100, timestamp: 13, eventKey: 'h17|playerB|bet|turn|100|1' };
var turnCall = { handId: 'socket-hand-17', playerId: 'playerA-id', player: 'PlayerA', action: 'call', street: 'turn', amount: 100, timestamp: 14, eventKey: 'h17|playerA|call|turn|100|1' };
[flopBet, flopCall, turnBet, turnCall].forEach(function (event) {
  assert.strictEqual(hands.stageEvent(restoredAccounting, event, { playerId: event.playerId, reason: 'verified post-reload action' }).staged, true);
});
var committed = hands.commitHand(restoredAccounting, 'socket-hand-17', 'settlement after resume', 20);
assert.strictEqual(committed.committed, true);
assert.strictEqual(hands.commitHand(restoredAccounting, 'socket-hand-17', 'duplicate settlement', 21).duplicate, true);
assert.strictEqual(recovery.finalize(recoveryState, 'socket-hand-17'), true);
assert.strictEqual(recoveryState.finalizedAfterRecovery, true);

var playerA = stats.computePlayerStats(restoredAccounting.finalizedEvents, 'PlayerA');
var playerB = stats.computePlayerStats(restoredAccounting.finalizedEvents, 'PlayerB');
assert.strictEqual(playerA.handsPlayed, 1);
assert.strictEqual(playerB.handsPlayed, 1);
assert.strictEqual(playerA.vpip, 100);
assert.strictEqual(playerA.pfr, 100);
assert.strictEqual(playerA.afDetails.bets, 1);
assert.strictEqual(playerA.afDetails.calls, 1);
assert.strictEqual(playerA.af, 1);
assert.strictEqual(playerB.vpip, 100);
assert.strictEqual(playerB.pfr, 0);
assert.strictEqual(playerB.afDetails.bets, 1);
assert.strictEqual(playerB.afDetails.calls, 1);
assert.strictEqual(restoredAccounting.finalizedEvents.filter(function (event) { return event.eventKey === preRaise.eventKey; }).length, 1);

var repeatedReloadAccounting = hands.createState({ finalizedEvents: [], activeHand: persisted });
var repeatedState = recovery.createState(hands.activeHand(repeatedReloadAccounting));
assert.strictEqual(recovery.attempt(repeatedState, { timestamp: 30, lifecycleInactive: true, persistedPausedVerified: true, bootstrapFingerprint: currentFingerprint }).claimed, true, 'repeated paused reload reclaims the same persisted owner without creating a second hand');

var different = recovery.createState(persisted);
assert.strictEqual(recovery.attempt(different, {
  timestamp: 40,
  lifecycleInactive: true,
  persistedPausedVerified: true,
  bootstrapFingerprint: recovery.fingerprint(Object.assign({}, fingerprint, { explicitHandId: 'deal-18', dealerOrButton: 'playerB-id', smallBlindPlayerId: 'playerB-id', bigBlindPlayerId: 'playerA-id' }))
}).claimed, false, 'different verified hand fingerprint rejects stale recovery');
var settled = recovery.createState(persisted);
assert.strictEqual(recovery.attempt(settled, {
  timestamp: 41,
  lifecycleInactive: true,
  persistedPausedVerified: true,
  bootstrapFingerprint: recovery.fingerprint(Object.assign({}, fingerprint, { settlementPresent: true }))
}).claimed, false, 'settlement before reload prevents recovery');
var insufficient = recovery.createState(persisted);
assert.strictEqual(recovery.attempt(insufficient, {
  timestamp: 42,
  lifecycleInactive: true,
  persistedPausedVerified: true,
  bootstrapFingerprint: recovery.fingerprint({ participantIds: ['playerA-id'], boardCardCount: 3 })
}).claimed, false, 'insufficient identity evidence rejects safely');

console.log('Interrupted paused-reload hand ownership, action dedupe, finalization, and stats tests passed.');
