'use strict';

var assert = require('assert');
var fs = require('fs');
var lifecycle = require('./gameBreakLifecycle.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var accounting = hands.createState({ finalizedEvents: [] });
function commitHand(handId, timestamp) {
  hands.beginHand(accounting, handId, { activate: true, timestamp: timestamp });
  ['PlayerA', 'PlayerB'].forEach(function (player, index) {
    hands.stageEvent(accounting, {
      handId: handId,
      playerId: player.toLowerCase(),
      player: player,
      action: 'blind',
      blindType: index ? 'big' : 'small',
      street: 'preflop',
      amount: index ? 20 : 10,
      timestamp: timestamp + index,
      eventKey: handId + '|blind|' + player
    }, { playerId: player.toLowerCase(), reason: 'verified live participant' });
  });
  return hands.commitHand(accounting, handId, 'live settlement', timestamp + 50);
}

function displayedHands() {
  return stats.computePlayerStats(accounting.finalizedEvents, 'PlayerA').handsPlayed;
}

assert.strictEqual(commitHand('A', 100).committed, true);
assert.strictEqual(commitHand('B', 200).committed, true);
assert.strictEqual(displayedHands(), 2);

var staleTerminalBaseline = {
  holeCardCount: 4,
  holeCardCollections: [{ path: '$.players.playerA.cards', length: 2 }, { path: '$.players.playerB.cards', length: 2 }],
  boardCardCount: 0,
  pot: 0,
  inHandPlayerIds: ['playerA', 'playerB'],
  smallBlindPlayerId: 'playerA',
  bigBlindPlayerId: 'playerB',
  currentPlayerId: 'playerA',
  playerInTurnId: 'playerB',
  dealerOrButton: 'playerA',
  tB: { playerA: '<D>', playerB: '<D>' },
  settlementPresent: true
};

var state = lifecycle.createState({ buildId: 'resume-trace-test', gameSessionKey: 'table-1' });
function snapshot(timestamp, input) {
  return lifecycle.recordSnapshot(state, Object.assign({
    timestamp: timestamp,
    currentTableStatus: 'inProgress',
    playerStatuses: [
      { playerId: 'playerA', mapped: true, activeInGame: true },
      { playerId: 'playerB', mapped: true, activeInGame: true }
    ],
    occupiedSeatCount: 2,
    activeInGamePlayerCount: 2,
    mappedPlayerCount: 2,
    activeHand: null,
    socketGameContextHandId: null,
    lastFinalizedHandId: 'B',
    lastSettlementTimestamp: 250,
    lastAcceptedBoundaryTimestamp: 200,
    currentBoundaryBaseline: { holeCardCount: 0, boardCardCount: 0, pot: 0, inHandPlayerIds: [] },
    cleanPreDealBaseline: true,
    priorHandResolved: true,
    currentDealFingerprint: 'clean-active-baseline',
    dealingPossible: true,
    changedPaths: []
  }, input || {}));
}

assert.strictEqual(snapshot(300).classification, 'active');
var breakTrace = snapshot(400, {
  currentTableStatus: 'waitingForPlayer',
  activeInGamePlayerCount: 1,
  dealingPossible: false,
  playerStatuses: [
    { playerId: 'playerA', mapped: true, activeInGame: true },
    { playerId: 'playerB', mapped: true, rawStatus: 'away', activeInGame: false }
  ],
  currentBoundaryBaseline: staleTerminalBaseline,
  cleanPreDealBaseline: false,
  currentDealFingerprint: 'stale-terminal-B',
  changedPaths: [{ path: 'players.playerB.status', previous: 'inGame', current: 'away' }]
});
assert.strictEqual(breakTrace.breakStartedOnThisSnapshot, true);
assert.strictEqual(breakTrace.classification, 'broken heads-up game');
assert.strictEqual(breakTrace.breakEpoch, 1);
assert.strictEqual(breakTrace.resumeEpoch.armed, true);
assert.deepStrictEqual(breakTrace.resumeEpoch.expectedPlayerIds, ['playerA', 'playerB']);
assert.strictEqual(breakTrace.resumeEpoch.normalizedBaseline.holeCardCount, 0);
assert.deepStrictEqual(breakTrace.resumeEpoch.normalizedBaseline.inHandPlayerIds, []);

for (var wait = 1; wait <= 5; wait += 1) {
  var waiting = snapshot(400 + wait * 60000, {
    currentTableStatus: 'waitingForPlayer',
    activeInGamePlayerCount: 1,
    dealingPossible: false,
    currentBoundaryBaseline: staleTerminalBaseline,
    currentDealFingerprint: 'stale-terminal-B',
    cleanPreDealBaseline: false
  });
  assert.strictEqual(waiting.classification, 'broken heads-up game', 'long waiting snapshots remain diagnostic-only');
  assert.strictEqual(displayedHands(), 2, 'waiting cannot create a hand');
}

var returned = snapshot(400000, {
  currentTableStatus: 'waitingToStart',
  activeInGamePlayerCount: 2,
  dealingPossible: true,
  currentBoundaryBaseline: staleTerminalBaseline,
  currentDealFingerprint: 'stale-terminal-B',
  cleanPreDealBaseline: false,
  changedPaths: [{ path: 'players.playerB.status', previous: 'away', current: 'inGame' }]
});
assert.strictEqual(returned.classification, 'temporarily stopped');
assert.strictEqual(returned.postReturnWaitingBaseline, null, 'omitted fields keep the global merged waiting baseline stale, matching production');
assert.strictEqual(displayedHands(), 2, 'returning alone cannot create a hand');
var staleSettlementReplay = hands.commitHand(accounting, 'B', 'stale previous settlement replay', 400500);
assert.strictEqual(staleSettlementReplay.committed, false);
assert.strictEqual(staleSettlementReplay.duplicate, true);
assert.strictEqual(displayedHands(), 2, 'stale previous settlement cannot add another hand');

function resumeEvaluation(overrides) {
  return lifecycle.evaluateResumeBoundary(state, Object.assign({
    noActiveHand: true,
    mappedPlayerIds: ['playerA', 'playerB'],
    recoveredEligiblePlayerIds: ['playerA', 'playerB'],
    inHandPlayerIds: ['playerA', 'playerB'],
    smallBlindPlayerId: 'playerA',
    bigBlindPlayerId: 'playerB',
    currentPlayerId: 'playerA',
    playerInTurnId: 'playerB',
    holeCardPlayerIds: ['playerA'],
    blindCommitmentsValid: true,
    dealSpecificTransitionObserved: true,
    tableActive: false,
    verifiedDealStarted: true,
    currentDealFingerprint: 'resumed-C',
    confidenceBeforeOverride: 15,
    requiredConfidence: 50,
    observedSignals: ['cPI changed', 'pITT changed', 'mAVTB decreased']
  }, overrides || {}));
}

var returnOnly = resumeEvaluation({ dealSpecificTransitionObserved: false, verifiedDealStarted: false, currentDealFingerprint: 'status-return-only' });
assert.strictEqual(returnOnly.activated, false, 'standing up and returning without a deal cannot activate the override');
assert.ok(returnOnly.missingRequirements.includes('dealSpecificTransitionObserved'));

var onePlayer = resumeEvaluation({ recoveredEligiblePlayerIds: ['playerA'] });
assert.strictEqual(onePlayer.activated, false, 'one eligible player cannot activate the override');
var joiningActiveHand = resumeEvaluation({ noActiveHand: false });
assert.strictEqual(joiningActiveHand.activated, false, 'joining an already-active hand cannot activate the override');
var staleFingerprint = resumeEvaluation({ currentDealFingerprint: 'stale-terminal-B' });
assert.strictEqual(staleFingerprint.activated, false, 'the stale terminal representation cannot be accepted as a resumed deal');

var cOverride = resumeEvaluation();
assert.strictEqual(cOverride.activated, true, 'the captured 15-point first resumed deal satisfies the separate current-state resume signature');
assert.strictEqual(cOverride.confidenceBeforeOverride, 15);
assert.strictEqual(cOverride.requiredConfidence, 50);
assert.strictEqual(cOverride.breakEpoch, 1);
assert.strictEqual(cOverride.reason, 'verified first deal after a stopped heads-up epoch');
assert.strictEqual(cOverride.normalizedBaseline.holeCardCount, 0);
assert.strictEqual(cOverride.checks.blindCommitmentsValid, true);
assert.strictEqual(lifecycle.consumeResumeBoundary(state, cOverride, 401000), true, 'Hand C consumes the epoch exactly once');
assert.strictEqual(lifecycle.consumeResumeBoundary(state, cOverride, 401001), false, 'the same resumed boundary cannot consume twice');

function boundary(handId, timestamp, accepted) {
  return lifecycle.recordBoundaryEvaluation(state, {
    timestamp: timestamp,
    frameId: 'ws-' + handId,
    patchRecordId: timestamp,
    allChangedSnapshotPaths: [{ path: 'iHPI', previous: [], current: ['playerA', 'playerB'] }],
    firstDealtSnapshot: { holeCardCount: 2, inHandPlayerIds: ['playerA', 'playerB'], sBPI: 'playerA', bBPI: 'playerB' },
    holeCardEvidence: { previousTotal: 0, currentTotal: 2 },
    blindPositionEvidence: { smallBlindPlayerId: 'playerA', bigBlindPlayerId: 'playerB' },
    playerInHandEvidence: { previous: [], current: ['playerA', 'playerB'] },
    confidenceScore: 48,
    requiredConfidence: 50,
    scoreContributions: [{ name: 'player hole cards appeared', weight: 36 }, { name: 'action turn started', weight: 12 }],
    rejectionReason: accepted ? null : 'multi-signal confidence below 50',
    accepted: accepted,
    detectGcNewHandRan: true,
    detectGcNewHandReturnedHandId: accepted ? handId : null,
    activeHandCreated: accepted,
    dealClassification: 'resume boundary candidate',
    completeDealSignature: true,
    dealFingerprint: handId,
    retainedLifecycleState: { socketGameContextHandId: accepted ? handId : null }
  });
}

var cDiagnostic = boundary('C', 401000, true);
assert.strictEqual(cDiagnostic.resumeDealOrdinal, 1);
assert.strictEqual(cDiagnostic.preBreakBaseline.holeCardCount, 0);
assert.strictEqual(cDiagnostic.postReturnWaitingBaseline, null);
assert.strictEqual(commitHand('C', 401000).committed, true);
assert.strictEqual(displayedHands(), 3, 'resumed Hand C counts once when the unchanged production owner accepts it');
var duplicateC = hands.commitHand(accounting, 'C', 'duplicate resumed settlement', 401100);
assert.strictEqual(duplicateC.committed, false);
assert.strictEqual(duplicateC.duplicate, true);
assert.strictEqual(displayedHands(), 3, 'duplicate C settlement cannot count twice');

var dDiagnostic = boundary('D', 402000, true);
assert.strictEqual(dDiagnostic.resumeDealOrdinal, 2);
assert.strictEqual(lifecycle.evaluateResumeBoundary(state, Object.assign({}, cOverride, { currentDealFingerprint: 'ordinary-D' })), false, 'Hand D cannot reuse the consumed resume epoch');
assert.strictEqual(commitHand('D', 402000).committed, true);
assert.strictEqual(displayedHands(), 4, 'resumed Hand D counts once');

var settlement = lifecycle.recordSettlementEvaluation(state, {
  timestamp: 402050,
  frameId: 'ws-D-settle',
  settlementObserved: true,
  gameResult: { playerB: { gained: 40 } },
  socketGameContextHandId: 'D',
  activeHandId: 'D',
  derivedFinalizeHandId: 'D',
  finalizeStatsHandCalled: false
});
var completedSettlement = lifecycle.completeSettlementEvaluation(state, settlement.traceId, {
  finalizeStatsHandCalled: true,
  derivedFinalizeHandId: 'D',
  accepted: true,
  exactReason: 'hand committed'
});
assert.strictEqual(completedSettlement.finalization.accepted, true);

snapshot(500000);
snapshot(500100, {
  currentTableStatus: 'stopped',
  activeInGamePlayerCount: 1,
  dealingPossible: false,
  playerStatuses: [
    { playerId: 'playerA', mapped: true, activeInGame: true },
    { playerId: 'playerB', mapped: true, activeInGame: false }
  ],
  currentDealFingerprint: 'stale-terminal-D'
});
snapshot(800000, { currentTableStatus: 'waitingToStart', activeInGamePlayerCount: 2, dealingPossible: true });
var secondOverride = lifecycle.evaluateResumeBoundary(state, {
  noActiveHand: true,
  mappedPlayerIds: ['playerA', 'playerB'],
  recoveredEligiblePlayerIds: ['playerA', 'playerB'],
  inHandPlayerIds: ['playerA', 'playerB'],
  smallBlindPlayerId: 'playerB',
  bigBlindPlayerId: 'playerA',
  currentPlayerId: 'playerB',
  playerInTurnId: 'playerA',
  holeCardPlayerIds: ['playerB'],
  blindCommitmentsValid: null,
  dealSpecificTransitionObserved: true,
  verifiedDealStarted: true,
  currentDealFingerprint: 'resumed-E',
  confidenceBeforeOverride: 18,
  requiredConfidence: 50
});
assert.strictEqual(secondOverride.activated, true, 'a later verified break gets its own one-shot override');
assert.strictEqual(lifecycle.consumeResumeBoundary(state, secondOverride, 801000), true);
var secondCycle = boundary('E', 801000, true);
assert.strictEqual(secondCycle.breakEpoch, 2, 'a later break/resume cycle gets a distinct diagnostic epoch');
assert.strictEqual(secondCycle.resumeDealOrdinal, 1);

var reloadStopped = lifecycle.createState({ buildId: 'reload-stopped', gameSessionKey: 'table-1' });
lifecycle.recordSnapshot(reloadStopped, {
  timestamp: 900000,
  currentTableStatus: 'waitingForPlayer',
  occupiedSeatCount: 2,
  activeInGamePlayerCount: 1,
  mappedPlayerCount: 2,
  activeHand: null,
  dealingPossible: false,
  cleanPreDealBaseline: true
});
assert.strictEqual(reloadStopped.breakOpen, false, 'reload/reconnect into an already-stopped table does not invent a break epoch or a hand');
assert.strictEqual(displayedHands(), 4, 'diagnostic recording cannot mutate finalized statistics');
assert.deepStrictEqual(Object.keys(lifecycle).sort(), ['closeEpochFromOrdinaryBoundary', 'completeSettlementEvaluation', 'consumeResumeBoundary', 'createState', 'evaluateResumeBoundary', 'recordBoundaryEvaluation', 'recordSettlementEvaluation', 'recordSnapshot', 'snapshot'].sort());

var unresolved = lifecycle.createState({ buildId: 'unresolved-break', gameSessionKey: 'table-1' });
lifecycle.recordSnapshot(unresolved, {
  timestamp: 1,
  currentTableStatus: 'inProgress',
  playerStatuses: [{ playerId: 'playerA', mapped: true, activeInGame: true }, { playerId: 'playerB', mapped: true, activeInGame: true }],
  occupiedSeatCount: 2,
  activeInGamePlayerCount: 2,
  mappedPlayerCount: 2,
  activeHand: null,
  dealingPossible: true
});
lifecycle.recordSnapshot(unresolved, {
  timestamp: 2,
  currentTableStatus: 'stopped',
  playerStatuses: [{ playerId: 'playerA', mapped: true, activeInGame: true }, { playerId: 'playerB', mapped: true, activeInGame: false }],
  occupiedSeatCount: 2,
  activeInGamePlayerCount: 1,
  mappedPlayerCount: 2,
  activeHand: null,
  dealingPossible: false,
  priorHandResolved: false
});
assert.strictEqual(unresolved.resumeEpoch, null, 'an unresolved prior hand cannot arm a resume epoch');

var source = fs.readFileSync('./content.js', 'utf8');
var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
assert.ok(isolated.js.indexOf('gameBreakLifecycle.js') < isolated.js.indexOf('content.js'));
assert.match(source, /gameBreakLifecycleTraces: PokerGameBreakLifecycle\.snapshot\(gameBreakLifecycleState\)/);
assert.match(source, /var gameBreakSnapshotTrace = recordGameBreakSnapshot\(/);
assert.match(source, /recordResumeBoundaryResult\(null, false\)/, 'rejected boundary evaluations are recorded');
assert.match(source, /recordResumeBoundaryResult\(handId,/, 'accepted boundary evaluations are recorded');
assert.match(source, /completeSettlementEvaluation/, 'settlement finalizer outcome is attached to the same trace');
assert.match(source, /var requiredConfidence = 50;/, 'generic confidence remains unchanged');
assert.match(source, /PokerGameBreakLifecycle\.evaluateResumeBoundary\(/, 'production boundary detection evaluates the separately owned resume epoch');
assert.match(source, /PokerGameBreakLifecycle\.consumeResumeBoundary\(/, 'an accepted resumed boundary consumes its epoch once');
assert.match(source, /full-log-stats-withheld/, 'Full Log remains stats-neutral');

console.log('Game-break/resumption one-shot resume boundary production regression passed.');
