'use strict';

var assert = require('assert');
var fs = require('fs');
var signal = require('./pokerNowLifecycleSignal.js');
var tbTrace = require('./tbTrace.js');
var merge = tbTrace.mergeSnapshot;
var lifecycle = require('./gameBreakLifecycle.js');
var runtime = require('./hudRuntimeStatus.js');
var hands = require('./handFinalization.js');
var recovery = require('./interruptedHandRecovery.js');
var stats = require('./stats.js');

var playerIds = ['Lwy-ervQBl', 'y65AIpIFzL'];
['paused', 'isPaused', 'gamePaused', 'game_paused'].forEach(function (key) {
  assert.strictEqual(signal.authoritativeControl('gC', { [key]: true }, 'incoming').classification, 'paused');
  assert.strictEqual(signal.authoritativeControl('registered', { gameState: { [key]: true } }, 'incoming').classification, 'paused');
  assert.strictEqual(signal.authoritativeControl('gC', { [key]: false, status: 'inProgress' }, 'incoming'), null, 'false/active fields cannot authorize Resume');
  assert.strictEqual(signal.authoritativeControl('gC', { players: { P1: { [key]: true } } }, 'incoming'), null, 'player fields are not room Pause');
});
var livePatch = {
  status: 'inProgress',
  hI: 'deal-live-1',
  iHPI: playerIds,
  sBPI: playerIds[0],
  bBPI: playerIds[1],
  dealerID: playerIds[0],
  cPI: playerIds[0],
  pITT: playerIds[0],
  tB: { 'Lwy-ervQBl': 10, 'y65AIpIFzL': 20 },
  players: {
    'Lwy-ervQBl': { name: 'playerA', status: 'inGame', stack: 1990 },
    'y65AIpIFzL': { name: 'playerB', status: 'inGame', stack: 1480 }
  }
};

var decodedLiveFrame = tbTrace.decodeSocketIoEventFrame('42["gC",' + JSON.stringify(livePatch) + ']');
assert.strictEqual(decodedLiveFrame.eventName, 'gC');
var contribution = signal.authoritativeContribution(decodedLiveFrame.eventName, decodedLiveFrame.payload);
assert.ok(contribution, 'mixed-case gC is an authoritative game-state contribution');
assert.strictEqual(contribution.path, '$');
assert.strictEqual(contribution.score, 100);
assert.strictEqual(signal.authoritativeContribution('action', { type: 'PAUSE' }), null, 'outgoing controls are not authoritative lifecycle state');

var merged = merge(null, contribution.patch);
var activeSignal = signal.normalize({ currentPatch: livePatch, mergedState: merged, eligiblePlayerCount: 2, occupiedPlayerCount: 2 });
assert.strictEqual(activeSignal.classification, 'active');
assert.strictEqual(activeSignal.confidence, 'corroborated', 'inProgress alone is not authoritative resume evidence');
assert.deepStrictEqual(activeSignal.evidencePaths, ['$.status']);

var breakState = lifecycle.createState({ buildId: 'real-gc-fixture', gameSessionKey: 'table-1' });
function lifecycleTrace(timestamp, normalized, activeHand, activeCount) {
  return lifecycle.recordSnapshot(breakState, {
    timestamp: timestamp,
    currentTableStatus: normalized.rawStatus,
    normalizedLifecycle: normalized,
    playerStatuses: playerIds.map(function (id) { return { playerId: id, mapped: true, activeInGame: activeCount >= 2 }; }),
    occupiedSeatCount: 2,
    activeInGamePlayerCount: activeCount,
    mappedPlayerCount: 2,
    activeHand: activeHand,
    activeHandId: activeHand && activeHand.handId,
    holeCardCount: 2,
    inHandPlayerIds: playerIds,
    dealingPossible: activeCount >= 2,
    cleanPreDealBaseline: false,
    priorHandResolved: false
  });
}

var hud = runtime.createState({ timestamp: 1 });
var activeTrace = lifecycleTrace(2, activeSignal, { handId: 'socket-hand-1' }, 2);
assert.strictEqual(activeTrace.classification, 'active');
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 2,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: activeTrace.currentTableStatus,
  tableClassification: activeTrace.classification,
  lifecycleConfidence: activeTrace.normalizedLifecycle.confidence,
  lifecycleEvidence: activeTrace.normalizedLifecycle,
  eligiblePlayerCount: 2
}).status, 'live');

// Captured waiting-table shape. This is not treated as proof of a host-controlled mid-hand pause.
var sparsePausePatch = { status: 'waiting' };
var decodedPauseFrame = tbTrace.decodeSocketIoEventFrame('42["gC",{"status":"waiting"}]');
var pauseContribution = signal.authoritativeContribution(decodedPauseFrame.eventName, decodedPauseFrame.payload);
assert.ok(pauseContribution, 'sparse lifecycle-only gC patch is not rejected by generic object scoring');
merged = merge(merged, pauseContribution.patch);
assert.strictEqual(merged.status, 'waiting');
assert.strictEqual(merged.hI, 'deal-live-1', 'sparse lifecycle merge preserves cached unfinished-hand identity');
var pauseSignal = signal.normalize({ currentPatch: sparsePausePatch, mergedState: merged, eligiblePlayerCount: 2, occupiedPlayerCount: 2 });
assert.strictEqual(pauseSignal.classification, 'waiting');
assert.strictEqual(pauseSignal.confidence, 'authoritative');
var pauseTrace = lifecycleTrace(3, pauseSignal, { handId: 'socket-hand-1' }, 2);
assert.strictEqual(pauseTrace.classification, 'temporarily stopped', 'an existing active hand cannot mask authoritative pause');
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 3,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: pauseTrace.currentTableStatus,
  tableClassification: pauseTrace.classification,
  lifecycleConfidence: pauseTrace.normalizedLifecycle.confidence,
  lifecycleEvidence: pauseTrace.normalizedLifecycle,
  eligiblePlayerCount: 2,
  activeHandPresent: true
}).status, 'waiting', 'connected transport cannot mask paused lifecycle');

var traceState = signal.createTraceState();
var rawRecord = signal.recordPatch(traceState, {
  frameId: 'ws-pause',
  eventName: 'gC',
  timestamp: 3,
  direction: 'incoming',
  payload: sparsePausePatch,
  contribution: pauseContribution,
  previousMergedState: merge(merged, { status: 'inProgress' }),
  classificationBefore: 'active',
  statusBefore: 'live-socket'
});
signal.completePatch(traceState, rawRecord, {
  classificationAfter: pauseTrace.classification,
  statusAfter: 'waiting',
  lifecycleOnly: true,
  normalizedSignal: pauseSignal
});
assert.strictEqual(traceState.lifecycleOnlyPatchesAccepted, 1);
assert.strictEqual(rawRecord.changedRawPaths[0].path, '$.status');
assert.strictEqual(rawRecord.changedRawPaths[0].previousRawValue, 'inProgress');
assert.strictEqual(rawRecord.changedRawPaths[0].currentRawValue, 'waiting');
var boundedTrace = signal.createTraceState();
for (var traceIndex = 0; traceIndex < 35; traceIndex += 1) {
  signal.recordPatch(boundedTrace, {
    frameId: 'bounded-' + traceIndex,
    eventName: 'gC',
    timestamp: 100 + traceIndex,
    direction: 'incoming',
    payload: { status: traceIndex % 2 ? 'waiting' : 'inProgress' },
    contribution: signal.authoritativeContribution('gC', { status: traceIndex % 2 ? 'waiting' : 'inProgress' }),
    previousMergedState: { status: traceIndex % 2 ? 'inProgress' : 'waiting' }
  });
}
assert.strictEqual(boundedTrace.recentPatches.length, 30, 'raw lifecycle patch diagnostics remain bounded');
assert.strictEqual(boundedTrace.recentEventNames.length, 30, 'nearby event-name diagnostics remain bounded');

var accounting = hands.createState({ finalizedEvents: [] });
hands.beginHand(accounting, 'socket-hand-1', { activate: true, timestamp: 1 });
hands.addParticipant(accounting, 'socket-hand-1', { playerId: playerIds[0], name: 'playerA', evidence: 'iHPI', timestamp: 1 });
hands.addParticipant(accounting, 'socket-hand-1', { playerId: playerIds[1], name: 'playerB', evidence: 'iHPI', timestamp: 1 });
var raise = { handId: 'socket-hand-1', playerId: playerIds[0], player: 'playerA', action: 'raise', street: 'preflop', amount: 60, timestamp: 2, eventKey: 'h1|playerA|raise|60' };
var call = { handId: 'socket-hand-1', playerId: playerIds[1], player: 'playerB', action: 'call', street: 'preflop', amount: 40, timestamp: 2, eventKey: 'h1|playerB|call|40' };
hands.stageEvent(accounting, raise, { playerId: playerIds[0], reason: 'verified raise' });
hands.stageEvent(accounting, call, { playerId: playerIds[1], reason: 'verified call' });
var fingerprint = recovery.fingerprint({
  explicitHandId: 'deal-live-1',
  participantIds: playerIds,
  smallBlindPlayerId: playerIds[0],
  bigBlindPlayerId: playerIds[1],
  dealerOrButton: playerIds[0],
  boardCardCount: 0,
  settlementPresent: false
});
hands.setRecoveryMetadata(accounting, 'socket-hand-1', {
  fingerprint: fingerprint,
  pausedVerified: true,
  lifecycleAtPersistence: pauseSignal.classification,
  authoritativePauseTimestamp: 3,
  timestamp: 3
});
var persisted = hands.serializeActiveHand(accounting);
assert.strictEqual(persisted.recoveryMetadata.pausedVerified, true);
assert.strictEqual(persisted.recoveryMetadata.lifecycleAtPersistence, 'waiting');

var restored = hands.createState({ finalizedEvents: [], activeHand: persisted });
var recoveryState = recovery.createState(hands.activeHand(restored));
var bootstrapFingerprint = recovery.fingerprint(Object.assign({}, fingerprint, { boardCardCount: 3 }));
var claim = recovery.attempt(recoveryState, {
  timestamp: 4,
  lifecycleInactive: true,
  persistedPausedVerified: true,
  bootstrapFingerprint: bootstrapFingerprint
});
assert.strictEqual(claim.claimed, true);
assert.ok(recoveryState.bootstrapFingerprint, 'paused bootstrap builds a non-null fingerprint');
assert.strictEqual(hands.reclaimRecoveredHand(restored, 'socket-hand-1', {
  timestamp: 4,
  pausedVerified: true,
  sameHandEvidence: claim.comparison.evidence
}).reclaimed, true);
var socketGameContext = { handId: claim.handId };
recoveryState.socketGameContextHandIdAfterRestore = socketGameContext.handId;
recoveryState.ownershipRestoredBeforeSettlement = true;

// Recovery ownership is established before settlement from the same/resume patch is finalized.
var settlementPatch = { status: 'inProgress', gameResult: { 'Lwy-ervQBl': { gained: 120, position: 1 } } };
var resumed = signal.normalize({ currentPatch: settlementPatch, mergedState: merge(merged, settlementPatch), eligiblePlayerCount: 2, occupiedPlayerCount: 2 });
assert.strictEqual(resumed.classification, 'active');
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 5,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: resumed.rawStatus,
  tableClassification: 'resumed',
  lifecycleConfidence: resumed.confidence,
  lifecycleEvidence: resumed,
  eligiblePlayerCount: 2
}).status, 'live');
assert.strictEqual(socketGameContext.handId, 'socket-hand-1');
var committed = hands.commitHand(restored, socketGameContext.handId, 'settlement after resumed recovery', 5);
assert.strictEqual(committed.committed, true);
assert.strictEqual(hands.commitHand(restored, socketGameContext.handId, 'duplicate settlement', 6).duplicate, true);
assert.strictEqual(stats.computePlayerStats(restored.finalizedEvents, 'playerA').handsPlayed, 1);
assert.strictEqual(restored.finalizedEvents.filter(function (event) { return event.eventKey === raise.eventKey; }).length, 1);
assert.strictEqual(restored.finalizedEvents.filter(function (event) { return event.eventKey === call.eventKey; }).length, 1);

var raceAccounting = hands.createState({ finalizedEvents: [], activeHand: Object.assign({}, persisted, {
  recoveryMetadata: Object.assign({}, persisted.recoveryMetadata, { pausedVerified: false })
}) });
var raceState = recovery.createState(hands.activeHand(raceAccounting));
assert.strictEqual(recovery.attempt(raceState, {
  timestamp: 7,
  lifecycleInactive: true,
  persistedPausedVerified: false,
  bootstrapFingerprint: bootstrapFingerprint
}).claimed, true, 'authoritative paused bootstrap plus strong identity covers the narrow storage race');
var activeReload = recovery.createState(hands.activeHand(raceAccounting));
assert.strictEqual(recovery.attempt(activeReload, {
  timestamp: 8,
  lifecycleInactive: false,
  persistedPausedVerified: false,
  bootstrapFingerprint: bootstrapFingerprint
}).claimed, false, 'arbitrary active-page reload cannot use the pause fallback');

var brokenSignal = signal.normalize({ currentPatch: { status: 'inProgress' }, mergedState: merged, eligiblePlayerCount: 1, occupiedPlayerCount: 2 });
assert.strictEqual(brokenSignal.classification, 'broken');
var brokenTrace = lifecycleTrace(9, brokenSignal, null, 1);
assert.strictEqual(runtime.reconcile(hud, {
  timestamp: 9,
  socketHookInstalled: true,
  freshGameState: true,
  tableStatus: brokenTrace.currentTableStatus,
  tableClassification: brokenTrace.classification,
  lifecycleConfidence: brokenTrace.normalizedLifecycle.confidence,
  lifecycleEvidence: brokenTrace.normalizedLifecycle,
  eligiblePlayerCount: 1
}).status, 'waiting');

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes('PokerNowLifecycleSignal.authoritativeContribution(eventName, payload)'));
assert.ok(content.indexOf('reconcileInterruptedHandRecovery(currentSnapshot') < content.indexOf('var terminalSettlement ='), 'production recovery executes before settlement ownership is derived');
assert.ok(content.includes('[HUD LIFECYCLE] authoritative lifecycle-only patch accepted'));
assert.ok(content.includes('pausePersistenceDiagnostics.persistenceRequestedAt'));
assert.ok(content.includes('pausePersistenceDiagnostics.persistenceCompletedAt'));
assert.ok(content.includes('[HUD INTERRUPTED HAND] ownership invariant violation before settlement'));

console.log('Real sparse mixed-case gC lifecycle, pause persistence, reload recovery, and settlement-order tests passed.');
