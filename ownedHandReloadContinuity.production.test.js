'use strict';

var assert = require('assert');
var fs = require('fs');
var hands = require('./handFinalization.js');
var recovery = require('./interruptedHandRecovery.js');
var continuity = require('./ownedHandReloadContinuity.js');
var hostTrace = require('./hostControlTrace.js');
var lifecycleSignal = require('./pokerNowLifecycleSignal.js');
var runtime = require('./hudRuntimeStatus.js');
var stats = require('./stats.js');

var ids = ['P1', 'y65AIpIFzL'];
var handId = 'table:socket:owned-live-hand';
var fingerprint = recovery.fingerprint({
  explicitHandId: null,
  participantIds: ids,
  smallBlindPlayerId: ids[0],
  bigBlindPlayerId: ids[1],
  dealerOrButton: ids[0],
  boardCardCount: 0,
  settlementPresent: false
});

function event(playerId, player, action, amount, timestamp) {
  return {
    handId: handId,
    playerId: playerId,
    player: player,
    action: action,
    street: 'preflop',
    amount: amount,
    timestamp: timestamp,
    eventKey: [handId, playerId, action, amount, timestamp].join('|')
  };
}

var finalized = [];
for (var priorIndex = 1; priorIndex <= 36; priorIndex += 1) {
  finalized.push({ handId: 'prior-' + priorIndex, player: 'playerA', action: 'dealt', street: 'preflop', amount: 0, timestamp: priorIndex });
  finalized.push({ handId: 'prior-' + priorIndex, player: 'playerB', action: 'dealt', street: 'preflop', amount: 0, timestamp: priorIndex });
}
var accounting = hands.createState({ finalizedEvents: finalized });
hands.beginHand(accounting, handId, { activate: true, timestamp: 100 });
hands.addParticipant(accounting, handId, { playerId: ids[0], name: 'playerA', evidence: 'verified iHPI', timestamp: 100 });
hands.addParticipant(accounting, handId, { playerId: ids[1], name: 'playerB', evidence: 'verified iHPI', timestamp: 100 });
var staged = [
  event(ids[0], 'playerA', 'blind', 10, 100),
  event(ids[1], 'playerB', 'blind', 20, 100),
  event(ids[0], 'playerA', 'raise', 60, 101),
  event(ids[1], 'playerB', 'call', 40, 102)
];
staged.forEach(function (item) {
  assert.strictEqual(hands.stageEvent(accounting, item, { playerId: item.playerId, reason: 'verified ' + item.action }).staged, true);
});
hands.setRecoveryMetadata(accounting, handId, {
  boundaryVerified: true,
  boundarySource: 'live-websocket',
  boundarySignature: 'verified-live-signature',
  fingerprint: fingerprint,
  pausedVerified: false,
  lifecycleAtPersistence: 'active',
  timestamp: 103
});
var persisted = hands.serializeActiveHand(accounting);
assert.strictEqual(persisted.events.length, 4);

var restored = hands.createState({ finalizedEvents: finalized, activeHand: persisted });
var restoredHand = hands.activeHand(restored);
var continuityState = continuity.createState(restoredHand);
var bootstrapPatch = {
  status: 'inProgress',
  iHPI: ids,
  sBPI: ids[0],
  bBPI: ids[1],
  dealerID: ids[0],
  cPI: ids[1],
  pITT: ids[1],
  pot: 120,
  tB: { 'P1': 60, 'y65AIpIFzL': 60 }
};
var normalizedStatus = lifecycleSignal.normalize({
  currentPatch: bootstrapPatch,
  mergedState: bootstrapPatch,
  eligiblePlayerCount: 2,
  occupiedPlayerCount: 2
});
assert.strictEqual(normalizedStatus.classification, 'active');
assert.strictEqual(normalizedStatus.confidence, 'corroborated', 'registered inProgress is context, not proof of resume');

var bootstrapFingerprint = recovery.fingerprint({
  explicitHandId: null,
  participantIds: bootstrapPatch.iHPI,
  smallBlindPlayerId: bootstrapPatch.sBPI,
  bigBlindPlayerId: bootstrapPatch.bBPI,
  dealerOrButton: bootstrapPatch.dealerID,
  boardCardCount: 0,
  settlementPresent: false
});
var claim = continuity.attempt(continuityState, {
  activeHand: restoredHand,
  bootstrapFingerprint: bootstrapFingerprint,
  alreadyFinalized: false,
  verifiedNewHandBoundary: false
});
assert.strictEqual(claim.claimed, true, 'strong owned-hand continuity does not require pausedVerified or waiting lifecycle');
assert.strictEqual(continuityState.bootstrapFingerprintBuilt, true);
assert.strictEqual(continuityState.strongContinuityVerified, true);
assert.strictEqual(hands.reclaimRecoveredHand(restored, handId, { timestamp: 110, ownedHandReloadContinuity: true }).reclaimed, true);
var socketGameContext = { handId: handId };
continuity.restored(continuityState, {
  succeeded: true,
  activeHandId: restored.activeHandId,
  stagedHandId: hands.activeHand(restored).handId,
  socketGameContextHandId: socketGameContext.handId,
  normalizedTbRestored: true
});
assert.strictEqual(restored.activeHandId, handId);
assert.strictEqual(hands.activeHand(restored).handId, handId);
assert.strictEqual(socketGameContext.handId, handId);
assert.strictEqual(continuityState.normalizedTbRestored, true);
assert.strictEqual(hands.activeHand(restored).events.length, 4, 'pre-reload staged actions remain exact');

var postReloadBet = {
  handId: handId,
  playerId: ids[0],
  player: 'playerA',
  action: 'bet',
  street: 'flop',
  amount: 80,
  timestamp: 111,
  eventKey: handId + '|playerA|bet|flop|80'
};
var postReloadCall = {
  handId: handId,
  playerId: ids[1],
  player: 'playerB',
  action: 'call',
  street: 'flop',
  amount: 80,
  timestamp: 112,
  eventKey: handId + '|playerB|call|flop|80'
};
assert.strictEqual(hands.stageEvent(restored, postReloadBet, { playerId: ids[0], reason: 'post-reload bet' }).staged, true);
assert.strictEqual(hands.stageEvent(restored, postReloadCall, { playerId: ids[1], reason: 'post-reload call' }).staged, true);
continuity.markAction(continuityState, 112);
assert.strictEqual(hands.activeHand(restored).events.length, 6);

var settlementBootstrap = recovery.fingerprint(Object.assign({}, bootstrapFingerprint, { settlementPresent: true }));
var directSettlementReload = hands.createState({ finalizedEvents: finalized, activeHand: persisted });
var directSettlementState = continuity.createState(hands.activeHand(directSettlementReload));
assert.strictEqual(continuity.attempt(directSettlementState, {
  activeHand: hands.activeHand(directSettlementReload),
  bootstrapFingerprint: settlementBootstrap,
  alreadyFinalized: false,
  verifiedNewHandBoundary: false
}).claimed, true, 'settlement itself can definitively observe a strongly matching restored hand');

continuity.markSettlement(continuityState, 120);
var beforeHands = stats.computePlayerStats(restored.finalizedEvents, 'playerA').handsPlayed;
assert.strictEqual(beforeHands, 36);
var commit = hands.commitHand(restored, socketGameContext.handId, 'settlement plus pot reset', 120);
assert.strictEqual(commit.committed, true);
continuity.markFinalized(continuityState, 120);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').handsPlayed, 37);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerB').handsPlayed, 37);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').vpip > 0, true);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').pfr > 0, true);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').afDetails.bets, 1);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerB').afDetails.calls, 1);
assert.strictEqual(hands.commitHand(restored, handId, 'duplicate settlement', 121).duplicate, true);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').handsPlayed, 37);

var repeated = hands.createState({ finalizedEvents: finalized, activeHand: persisted });
var repeatedState = continuity.createState(hands.activeHand(repeated));
assert.strictEqual(continuity.attempt(repeatedState, {
  activeHand: hands.activeHand(repeated),
  bootstrapFingerprint: bootstrapFingerprint,
  alreadyFinalized: false,
  verifiedNewHandBoundary: false
}).claimed, true, 'ordinary active-hand reload preserves strong ownership');

var differentFingerprint = recovery.fingerprint(Object.assign({}, bootstrapFingerprint, {
  participantIds: [ids[0], 'different-player'],
  smallBlindPlayerId: 'different-player'
}));
var differentState = continuity.createState(persisted);
assert.strictEqual(continuity.attempt(differentState, {
  activeHand: persisted,
  bootstrapFingerprint: differentFingerprint,
  alreadyFinalized: false,
  verifiedNewHandBoundary: false
}).claimed, false);
var boundaryState = continuity.createState(persisted);
assert.strictEqual(continuity.attempt(boundaryState, {
  activeHand: persisted,
  bootstrapFingerprint: bootstrapFingerprint,
  alreadyFinalized: false,
  verifiedNewHandBoundary: true
}).claimed, false);
var finishedState = continuity.createState(persisted);
assert.strictEqual(continuity.attempt(finishedState, {
  activeHand: persisted,
  bootstrapFingerprint: bootstrapFingerprint,
  alreadyFinalized: true,
  verifiedNewHandBoundary: false
}).claimed, false);

var traceState = hostTrace.createState();
var unknownOutgoing = hostTrace.record(traceState, {
  frameId: 'ws-action',
  timestamp: 130,
  direction: 'outgoing',
  eventName: 'action',
  namespace: '/',
  payload: { type: 'UP', token: 'must-not-appear', cards: ['SYNTHETIC_CARD_1', 'SYNTHETIC_CARD_2'], email: 'synthetic-email' },
  localUserPlayerId: 'owner-1',
  tableOwnerPlayerId: 'owner-1'
});
assert.strictEqual(unknownOutgoing.knownPokerAction, false);
assert.strictEqual(unknownOutgoing.appearsTableControl, true);
assert.strictEqual(unknownOutgoing.recognizedCommand, 'pause');
assert.strictEqual(JSON.stringify(unknownOutgoing).includes('must-not-appear'), false);
assert.strictEqual(JSON.stringify(unknownOutgoing).includes('synthetic-email'), false);
var semanticPause = hostTrace.record(traceState, {
  frameId: 'semantic-only-fixture',
  direction: 'outgoing',
  eventName: 'control',
  payload: { command: 'pause' },
  localUserPlayerId: 'owner-1',
  tableOwnerPlayerId: 'owner-1'
});
assert.strictEqual(semanticPause.diagnosticSemanticCommand, 'pause');
assert.strictEqual(semanticPause.recognizedCommand, null, 'production recognizes only exact action UP/UR transport commands');
for (var commandIndex = 0; commandIndex < 25; commandIndex += 1) {
  hostTrace.record(traceState, { frameId: 'ws-' + commandIndex, eventName: 'action', payload: { type: 'UNKNOWN-' + commandIndex } });
}
assert.strictEqual(traceState.recentOutgoingCommands.length, 20);

var hud = runtime.createState({ timestamp: 1 });
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 2,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: 'inProgress',
  tableClassification: 'active',
  eligiblePlayerCount: 2,
  localLifecycleCommand: 'paused-local-command'
}).status, 'live-socket', 'persisted local Pause evidence keeps the socket live while the game is paused');
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 3,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: 'inProgress',
  tableClassification: 'active',
  eligiblePlayerCount: 2,
  localLifecycleCommand: null
}).status, 'live', 'confirmed progression after Resume restores active Live status');

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes('recordOutgoingHostControl(frame, packet)'));
assert.ok(content.includes('reconcileOwnedHandReloadContinuity(currentSnapshot, transitionRecord)'));
assert.ok(content.includes('settlement owns this patch; next boundary waits for a later authoritative patch'));
assert.ok(content.indexOf('var continuityResult = reconcileOwnedHandReloadContinuity') < content.indexOf('var terminalSettlement ='));
assert.ok(content.indexOf('var terminalSettlement =') < content.indexOf(': detectGcNewHand('), 'settlement ownership is decided before boundary evaluation');
assert.ok(content.includes('settlementOrderingTrace.finalizeAttemptedBeforeBoundary = true'));
assert.ok(content.includes('settlementOrderingTrace.boundaryEvaluationRanAfterFinalize = true'));

console.log('Strong owned-hand reload continuity, sanitized host-control trace, and settlement-before-boundary tests passed.');
