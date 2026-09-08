'use strict';

var assert = require('assert');
var fs = require('fs');
var lifecycle = require('./gameBreakLifecycle.js');
var hands = require('./handFinalization.js');
var walk = require('./walkDetection.js');
var stats = require('./stats.js');

var players = [
  { playerId: 'a', playerName: 'Alice', mapped: true, occupied: true, activeInGame: false },
  { playerId: 'b', playerName: 'Bob', mapped: true, occupied: true, activeInGame: false },
  { playerId: 'c', playerName: 'Cara', mapped: true, occupied: true, activeInGame: false }
];

function waitingSnapshot(state, timestamp) {
  return lifecycle.recordSnapshot(state, {
    timestamp: timestamp,
    eventName: 'registered',
    currentTableStatus: 'waitingForPlayer',
    normalizedLifecycle: { classification: 'waiting', confidence: 'authoritative', reason: 'all eligible players are away' },
    playerStatuses: players,
    occupiedSeatCount: 3,
    activeInGamePlayerCount: 0,
    mappedPlayerCount: 3,
    activeHand: null,
    activeHandId: null,
    socketGameContextHandId: null,
    currentBoundaryBaseline: { holeCardCount: 0, boardCardCount: 0, pot: 0, inHandPlayerIds: [] },
    currentDealFingerprint: 'reload-waiting-baseline',
    cleanPreDealBaseline: true,
    dealingPossible: false,
    priorHandResolved: false,
    initialAuthoritativeSnapshot: true,
    storageHydrationComplete: true
  });
}

function activeSnapshot(state, timestamp, fingerprint) {
  return lifecycle.recordSnapshot(state, {
    timestamp: timestamp,
    eventName: 'gC',
    currentTableStatus: 'inProgress',
    normalizedLifecycle: { classification: 'active', reason: 'verified deal state' },
    playerStatuses: players.map(function (player) { return Object.assign({}, player, { activeInGame: true }); }),
    occupiedSeatCount: 3,
    activeInGamePlayerCount: 3,
    mappedPlayerCount: 3,
    activeHand: null,
    activeHandId: null,
    currentBoundaryBaseline: {
      holeCardCount: 2,
      boardCardCount: 0,
      pot: 30,
      inHandPlayerIds: ['a', 'b', 'c'],
      smallBlindPlayerId: 'b',
      bigBlindPlayerId: 'c',
      currentPlayerId: 'a',
      playerInTurnId: 'a'
    },
    holeCardCount: 2,
    inHandPlayerIds: ['a', 'b', 'c'],
    currentDealFingerprint: fingerprint,
    cleanPreDealBaseline: false,
    dealingPossible: true,
    priorHandResolved: true,
    initialAuthoritativeSnapshot: false,
    storageHydrationComplete: true
  });
}

function resumeEvaluation(state, activeTrace, fingerprint) {
  return lifecycle.evaluateResumeBoundary(state, {
    noActiveHand: true,
    mappedPlayerIds: ['a', 'b', 'c'],
    recoveredEligiblePlayerIds: ['a', 'b', 'c'],
    inHandPlayerIds: ['a', 'b', 'c'],
    smallBlindPlayerId: 'b',
    bigBlindPlayerId: 'c',
    currentPlayerId: 'a',
    playerInTurnId: 'a',
    holeCardPlayerIds: ['a'],
    blindCommitmentsValid: true,
    dealSpecificTransitionObserved: true,
    tableActive: true,
    verifiedDealStarted: true,
    lifecycleTransitionVerified: activeTrace.gameBreakToActiveDetected,
    currentDealFingerprint: fingerprint,
    confidenceBeforeOverride: 48,
    requiredConfidence: 50,
    observedSignals: ['iHPI appeared', 'sBPI appeared', 'bBPI appeared', 'hole cards appeared']
  });
}

function createReloadedAccounting() {
  return hands.createState({
    finalizedEvents: [
      { handId: 'pre-break', playerId: 'a', player: 'Alice', action: 'fold', street: 'preflop', amount: 0, timestamp: 1 },
      { handId: 'pre-break', playerId: 'b', player: 'Bob', action: 'fold', street: 'preflop', amount: 0, timestamp: 2 },
      { handId: 'pre-break', playerId: 'c', player: 'Cara', action: 'blind', blindType: 'big', street: 'preflop', amount: 20, timestamp: 3 }
    ],
    finalizedHandIds: ['pre-break'],
    activeHand: null
  });
}

function beginAndCommitRestartedHand(accounting, handId, timestamp) {
  hands.beginHand(accounting, handId, { activate: true, timestamp: timestamp });
  [
    walk.createInitialHandEvent({ handId: handId, playerId: 'a', player: 'Alice', smallBlindPlayerId: 'b', bigBlindPlayerId: 'c', timestamp: timestamp }),
    walk.createInitialHandEvent({ handId: handId, playerId: 'b', player: 'Bob', smallBlindPlayerId: 'b', bigBlindPlayerId: 'c', timestamp: timestamp }),
    walk.createInitialHandEvent({ handId: handId, playerId: 'c', player: 'Cara', smallBlindPlayerId: 'b', bigBlindPlayerId: 'c', timestamp: timestamp })
  ].forEach(function (event) {
    hands.stageEvent(accounting, event, { playerId: event.playerId, reason: 'verified first post-break deal participant' });
  });
  assert.strictEqual(hands.activeHand(accounting).handId, handId, 'first post-break hand owns activeHand');
  return hands.commitHand(accounting, handId, 'authoritative websocket settlement', timestamp + 1);
}

var accounting = createReloadedAccounting();
var state = lifecycle.createState({ buildId: 'break-reload-test', gameSessionKey: 'table' });
var waiting = waitingSnapshot(state, 100);
assert.strictEqual(waiting.classification, 'broken heads-up game');
assert.strictEqual(waiting.breakInitializedFromReload, true, 'the first hydrated waiting snapshot initializes a break epoch');
assert.strictEqual(waiting.breakOpen, true);
assert.strictEqual(waiting.resumeEpoch.source, 'reload-broken-baseline');
assert.strictEqual(waiting.initialAuthoritativeLifecycle.classification, 'broken heads-up game');
assert.strictEqual(hands.activeHand(accounting), null, 'the broken baseline cannot synthesize a stale active hand');

var active = activeSnapshot(state, 200, 'restart-hand-1');
assert.strictEqual(active.gameBreakToActiveDetected, true);
assert.strictEqual(active.classification, 'resumed');
var evaluation = resumeEvaluation(state, active, 'restart-hand-1');
assert.strictEqual(evaluation.activated, true);
assert.strictEqual(evaluation.epochSource, 'reload-broken-baseline');
assert.strictEqual(evaluation.reason, 'verified first deal after a reload-initialized game-break epoch');
assert.strictEqual(evaluation.confidenceBeforeOverride, 48, 'reload override is separate from the unchanged ordinary threshold');
assert.strictEqual(lifecycle.consumeResumeBoundary(state, evaluation, 200), true);
assert.strictEqual(lifecycle.consumeResumeBoundary(state, evaluation, 201), false, 'the restart epoch is one-shot');
var repeatedBeforeCommit = activeSnapshot(state, 201, 'restart-hand-1');
assert.strictEqual(repeatedBeforeCommit.breakOpen, false);
assert.strictEqual(lifecycle.evaluateResumeBoundary(state, {
  noActiveHand: true,
  currentDealFingerprint: 'restart-hand-1'
}), false, 'a repeated active snapshot cannot create a second active hand before settlement');
var firstCommit = beginAndCommitRestartedHand(accounting, 'restart-hand-1', 200);
assert.strictEqual(firstCommit.committed, true);
assert.strictEqual(stats.computePlayerStats(accounting.finalizedEvents, 'Alice').handsPlayed, 2, 'first restarted hand commits exactly once');

var repeatedActive = activeSnapshot(state, 202, 'restart-hand-1');
assert.strictEqual(lifecycle.evaluateResumeBoundary(state, {
  noActiveHand: true,
  currentDealFingerprint: 'restart-hand-1'
}), false, 'identical active snapshots cannot reuse the consumed epoch');
var replayCommit = hands.commitHand(accounting, 'restart-hand-1', 'replayed settlement', 203);
assert.strictEqual(replayCommit.committed, false);
assert.strictEqual(replayCommit.duplicate, true);
assert.strictEqual(stats.computePlayerStats(accounting.finalizedEvents, 'Alice').handsPlayed, 2);
assert.strictEqual(repeatedActive.breakOpen, false);

var staleCommit = hands.commitHand(accounting, 'pre-break', 'stale pre-break settlement replay', 204);
assert.strictEqual(staleCommit.committed, false);
assert.strictEqual(staleCommit.duplicate, true, 'no stale pre-break hand is recreated or committed');

var quickAccounting = createReloadedAccounting();
var quickState = lifecycle.createState({ buildId: 'quick-break-reload-test', gameSessionKey: 'table' });
waitingSnapshot(quickState, 300);
var quickActive = activeSnapshot(quickState, 301, 'quick-restart-hand');
var quickEvaluation = resumeEvaluation(quickState, quickActive, 'quick-restart-hand');
assert.strictEqual(quickEvaluation.activated, true);
assert.strictEqual(lifecycle.consumeResumeBoundary(quickState, quickEvaluation, 301), true);
assert.strictEqual(beginAndCommitRestartedHand(quickAccounting, 'quick-restart-hand', 301).committed, true, 'a quickly settled first restarted hand still commits');
assert.strictEqual(stats.computePlayerStats(quickAccounting.finalizedEvents, 'Alice').handsPlayed, 2);

var staleBaselineAccounting = createReloadedAccounting();
var staleBaselineState = lifecycle.createState({ buildId: 'stale-break-reload-test', gameSessionKey: 'table' });
var staleWaiting = lifecycle.recordSnapshot(staleBaselineState, {
  timestamp: 350,
  currentTableStatus: 'waitingForPlayer',
  normalizedLifecycle: { classification: 'waiting', confidence: 'authoritative', reason: 'current gC status is waitingForPlayer' },
  playerStatuses: players,
  occupiedSeatCount: 3,
  activeInGamePlayerCount: 0,
  mappedPlayerCount: 3,
  activeHand: null,
  activeHandId: null,
  currentBoundaryBaseline: {
    holeCardCount: 2,
    boardCardCount: 0,
    pot: 0,
    inHandPlayerIds: ['a', 'b', 'c'],
    settlementPresent: true
  },
  currentDealFingerprint: 'stale-pre-break-terminal',
  cleanPreDealBaseline: false,
  dealingPossible: false,
  priorHandResolved: false,
  initialAuthoritativeSnapshot: true,
  storageHydrationComplete: true
});
assert.strictEqual(staleWaiting.breakInitializedFromReload, true, 'authoritative break status may own a stale terminal representation without creating a hand');
assert.strictEqual(hands.activeHand(staleBaselineAccounting), null);
var staleRestartActive = activeSnapshot(staleBaselineState, 351, 'fresh-after-stale-break');
var staleRestartEvaluation = resumeEvaluation(staleBaselineState, staleRestartActive, 'fresh-after-stale-break');
assert.strictEqual(staleRestartEvaluation.activated, true);
assert.strictEqual(staleRestartEvaluation.checks.fingerprintChangedFromTerminal, true);

var pausedState = lifecycle.createState({ buildId: 'paused-reload-safety', gameSessionKey: 'table' });
var paused = lifecycle.recordSnapshot(pausedState, {
  timestamp: 400,
  currentTableStatus: 'paused',
  normalizedLifecycle: { classification: 'paused', reason: 'authoritative pause' },
  playerStatuses: players,
  occupiedSeatCount: 3,
  activeInGamePlayerCount: 0,
  mappedPlayerCount: 3,
  activeHand: { handId: 'persisted-paused-hand' },
  activeHandId: 'persisted-paused-hand',
  currentBoundaryBaseline: { holeCardCount: 2, boardCardCount: 3, pot: 100, inHandPlayerIds: ['a', 'b'] },
  currentDealFingerprint: 'paused-hand',
  cleanPreDealBaseline: false,
  initialAuthoritativeSnapshot: true,
  storageHydrationComplete: true
});
assert.strictEqual(paused.breakInitializedFromReload, false, 'paused-hand reload remains owned by interrupted-hand recovery');
assert.strictEqual(pausedState.resumeEpoch, null);

var unhydratedState = lifecycle.createState({ buildId: 'unhydrated-safety', gameSessionKey: 'table' });
var unhydrated = lifecycle.recordSnapshot(unhydratedState, {
  timestamp: 500,
  currentTableStatus: 'waitingForPlayer',
  normalizedLifecycle: { classification: 'waiting', reason: 'pre-hydration frame' },
  playerStatuses: players,
  occupiedSeatCount: 3,
  activeInGamePlayerCount: 0,
  mappedPlayerCount: 3,
  activeHand: null,
  cleanPreDealBaseline: true,
  initialAuthoritativeSnapshot: true,
  storageHydrationComplete: false
});
assert.strictEqual(unhydrated.breakInitializedFromReload, false, 'pre-hydration frames cannot initialize lifecycle ownership');
var source = fs.readFileSync('./content.js', 'utf8');
assert.match(source, /storageHydrationComplete: Boolean\(firstHandLifecycle\.ready\)/);
assert.match(source, /lifecycleTransitionVerified: Boolean\(gameBreakSnapshotTrace && gameBreakSnapshotTrace\.gameBreakToActiveDetected\)/);
assert.match(source, /\[HUD BREAK RELOAD TRACE\]/);
assert.match(source, /\[HUD BREAK RELOAD COMMIT\]/);
assert.match(source, /firstHandAfterReloadBreak: Boolean\(resumeBoundaryOverride/);
assert.match(source, /PokerHudDiagnostics\.enabled\('deep'\)/, 'reload lifecycle diagnostics remain gated');
assert.match(source, /full-log-stats-withheld/, 'Full Log remains display-only');
assert.doesNotMatch(source, /finalizeStatsHand\([^)]*full-log/i, 'Full Log cannot finalize stats');

console.log('Break/reload/restart first-hand production regression passed.');
