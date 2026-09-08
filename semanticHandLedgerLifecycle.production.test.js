'use strict';

var assert = require('assert');
var fs = require('fs');
var ledger = require('./semanticHandLedger.js');
var hands = require('./handFinalization.js');
var gameBreak = require('./gameBreakLifecycle.js');
var manifest = require('./manifest.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseState(handId, gameNumber) {
  return {
    hI: handId,
    gN: gameNumber,
    gT: ['holdem', 0],
    pot: 30,
    tB: { p1: 10, p2: 20 },
    cHB: 20,
    mR: 40,
    cPI: 'p1',
    pITT: 'p1',
    cRPI: [],
    sBPI: 'p1',
    bBPI: 'p2',
    dealerID: 'p1',
    iHPI: ['p1', 'p2'],
    pGS: { p1: 'inGame', p2: 'inGame' },
    players: {
      p1: { id: 'p1', name: 'Alice', stack: 990 },
      p2: { id: 'p2', name: 'Bob', stack: 980 }
    },
    seats: [[1, 'p1'], [2, 'p2']]
  };
}

function terminalState(previous, awards, stacks) {
  var terminal = clone(previous);
  terminal.gT = ['holdem', 5];
  terminal.pot = 0;
  terminal.cPI = null;
  terminal.pITT = null;
  terminal.gameResult = clone(awards);
  Object.keys(stacks || {}).forEach(function (playerId) {
    terminal.players[playerId].stack = stacks[playerId];
  });
  return terminal;
}

function observeState(target, handId, currentState, previousState, patch, frameId, timestamp) {
  return ledger.observe(target, {
    handId: handId,
    authoritativeHandId: handId,
    previousHandId: previousState ? handId : null,
    previousAuthoritativeHandId: previousState ? handId : null,
    frameId: frameId,
    timestamp: timestamp,
    eventName: 'gC',
    previousState: previousState || null,
    currentState: currentState,
    patch: patch || currentState
  });
}

function stageOwnedHand(accounting, handId, timestamp) {
  hands.beginHand(accounting, handId, { activate: true, timestamp: timestamp });
  [
    { playerId: 'p1', player: 'Alice', blindType: 'small', amount: 10 },
    { playerId: 'p2', player: 'Bob', blindType: 'big', amount: 20 }
  ].forEach(function (player, index) {
    var result = hands.stageEvent(accounting, {
      handId: handId,
      playerId: player.playerId,
      player: player.player,
      action: 'blind',
      blindType: player.blindType,
      street: 'preflop',
      amount: player.amount,
      timestamp: timestamp + index,
      eventKey: handId + '|blind|' + player.playerId
    }, {
      playerId: player.playerId,
      reason: 'verified production blind'
    });
    assert.strictEqual(result.staged, true);
  });
}

function stageAction(accounting, handId, playerId, player, action, street, amount, timestamp) {
  return hands.stageEvent(accounting, {
    handId: handId,
    playerId: playerId,
    player: player,
    action: action,
    street: street,
    amount: amount,
    timestamp: timestamp,
    eventKey: [handId, playerId, action, street, amount, timestamp].join('|')
  }, {
    playerId: playerId,
    reason: 'verified production ' + action
  });
}

function mirrorCommit(accounting, semanticState, handId, reason, timestamp) {
  var commit = hands.commitHand(accounting, handId, reason, timestamp);
  var semantic = null;
  if (commit.committed || commit.duplicate) {
    semantic = ledger.finalize(semanticState, handId, {
      reason: reason,
      timestamp: timestamp,
      fallbackHand: commit.hand || null
    });
  }
  return { commit: commit, semantic: semantic };
}

function ambiguityCodes(record) {
  return record.ambiguities.map(function (item) { return item.code; });
}

/* Settlement finalization and repeated terminal frames produce one record. */
var accounting = hands.createState();
var semanticState = ledger.createState();
stageOwnedHand(accounting, 'H1', 1000);

var start = baseState('H1', 1);
observeState(semanticState, 'H1', start, null, start, 'h1-1', 1000);

var raised = clone(start);
raised.tB.p1 = 60;
raised.cHB = 60;
raised.mR = 100;
raised.cRPI = ['p1'];
raised.players.p1.stack = 940;
observeState(semanticState, 'H1', raised, start, {
  tB: { p1: 60 },
  cHB: 60,
  mR: 100,
  cRPI: ['p1'],
  players: { p1: { stack: 940 } }
}, 'h1-2', 1010);
assert.strictEqual(stageAction(
  accounting,
  'H1',
  'p1',
  'Alice',
  'raise',
  'preflop',
  60,
  1010
).staged, true);

var terminal = terminalState(
  raised,
  { p1: { gained: 80 }, p2: { gained: 0 } },
  { p1: 1020, p2: 980 }
);
var terminalPatch = {
  gT: terminal.gT,
  pot: 0,
  cPI: null,
  pITT: null,
  gameResult: terminal.gameResult,
  players: { p1: { stack: 1020 }, p2: { stack: 980 } }
};
observeState(semanticState, 'H1', terminal, raised, terminalPatch, 'h1-3', 1020);
observeState(
  semanticState,
  'H1',
  terminal,
  terminal,
  terminalPatch,
  'h1-terminal-replay',
  1021
);

var firstCommit = mirrorCommit(
  accounting,
  semanticState,
  'H1',
  'settlement/gameResult appeared in live game-state patch',
  1030
);
assert.strictEqual(firstCommit.commit.committed, true);
assert.strictEqual(firstCommit.semantic.finalized, true);
assert.strictEqual(ledger.inspect(semanticState).finalizedRecords.length, 1);
assert.strictEqual(
  firstCommit.semantic.record.actions.filter(function (action) { return action.type === 'raise'; }).length,
  1,
  'replayed terminal evidence cannot duplicate a recognized action'
);

var duplicateCommit = mirrorCommit(
  accounting,
  semanticState,
  'H1',
  'duplicate replayed settlement',
  1040
);
assert.strictEqual(duplicateCommit.commit.duplicate, true);
assert.strictEqual(duplicateCommit.semantic.duplicate, true);
assert.strictEqual(ledger.inspect(semanticState).finalizedRecords.length, 1);
assert.strictEqual(
  observeState(
    semanticState,
    'H1',
    terminal,
    terminal,
    terminalPatch,
    'h1-after-finalize',
    1050
  ).duplicate,
  true
);
assert.strictEqual(ledger.inspect(semanticState).finalizedRecords.length, 1);

/* Restored finalized identities prevent reconnect/reload emission. */
var persistedInspection = ledger.inspect(semanticState);
var restoredFinalizedState = ledger.createState({
  finalizedRecords: persistedInspection.finalizedRecords,
  finalizedHandIds: persistedInspection.finalizedHandIds
});
assert.strictEqual(
  observeState(
    restoredFinalizedState,
    'H1',
    terminal,
    null,
    terminalPatch,
    'registered-replay',
    1100
  ).duplicate,
  true
);
assert.strictEqual(ledger.finalize(restoredFinalizedState, 'H1', {
  reason: 'reconnect settlement replay',
  timestamp: 1110
}).duplicate, true);
assert.strictEqual(ledger.inspect(restoredFinalizedState).finalizedRecords.length, 1);

/* A strongly reclaimed active hand finalizes once with partial-history ambiguity. */
var beforeReloadAccounting = hands.createState();
stageOwnedHand(beforeReloadAccounting, 'HR', 2000);
assert.strictEqual(stageAction(
  beforeReloadAccounting,
  'HR',
  'p1',
  'Alice',
  'raise',
  'preflop',
  60,
  2010
).staged, true);
var persistedActive = hands.serializeActiveHand(beforeReloadAccounting);

var afterReloadAccounting = hands.createState({ activeHand: persistedActive });
var afterReloadLedger = ledger.createState();
assert.strictEqual(ledger.seedRecoveredHand(afterReloadLedger, persistedActive).seeded, true);
assert.strictEqual(hands.reclaimRecoveredHand(afterReloadAccounting, 'HR', {
  timestamp: 2020,
  recoveryReason: 'strong persisted owned-hand continuity',
  sameHandEvidence: ['exact PokerNow hand/deal identifier']
}).reclaimed, true);

var recoveredStart = baseState('HR', 2);
var recoveredRaised = clone(recoveredStart);
recoveredRaised.tB.p1 = 60;
recoveredRaised.players.p1.stack = 940;
var recoveredTerminal = terminalState(
  recoveredRaised,
  { p1: { gained: 80 }, p2: { gained: 0 } },
  { p1: 1020, p2: 980 }
);
observeState(afterReloadLedger, 'HR', recoveredTerminal, null, {
  gT: recoveredTerminal.gT,
  gameResult: recoveredTerminal.gameResult,
  players: { p1: { stack: 1020 }, p2: { stack: 980 } }
}, 'hr-terminal', 2030);

var recoveredCommit = mirrorCommit(
  afterReloadAccounting,
  afterReloadLedger,
  'HR',
  'verified settlement after owned-hand reload recovery',
  2040
);
assert.strictEqual(recoveredCommit.commit.committed, true);
assert.strictEqual(recoveredCommit.semantic.finalized, true);
assert.strictEqual(recoveredCommit.semantic.record.provenance.recovered, true);
assert.strictEqual(recoveredCommit.semantic.record.provenance.historyComplete, false);
assert.ok(ambiguityCodes(recoveredCommit.semantic.record).includes(
  ledger.AMBIGUITY_CODES.PARTIAL_HISTORY_AFTER_RECOVERY
));
assert.strictEqual(
  recoveredCommit.semantic.record.actions.filter(function (action) { return action.type === 'raise'; }).length,
  1
);
assert.strictEqual(mirrorCommit(
  afterReloadAccounting,
  afterReloadLedger,
  'HR',
  'duplicate recovered settlement',
  2050
).semantic.duplicate, true);
assert.strictEqual(ledger.inspect(afterReloadLedger).finalizedRecords.length, 1);

/* Pause and Resume metadata/lifecycle-only patches neither finalize nor lose a hand. */
var pauseAccounting = hands.createState();
var pauseLedger = ledger.createState();
stageOwnedHand(pauseAccounting, 'HP', 3000);
var pauseStart = baseState('HP', 3);
observeState(pauseLedger, 'HP', pauseStart, null, pauseStart, 'hp-1', 3000);

assert.strictEqual(hands.setRecoveryMetadata(pauseAccounting, 'HP', {
  pausedVerified: true,
  lifecycleAtPersistence: 'paused-verified-host-command',
  timestamp: 3010
}).updated, true);
var pausedSnapshot = Object.assign(clone(pauseStart), { paused: true });
observeState(pauseLedger, 'HP', pausedSnapshot, pauseStart, {
  paused: true,
  status: 'paused'
}, 'hp-pause', 3010);
assert.strictEqual(hands.activeHand(pauseAccounting).handId, 'HP');
assert.strictEqual(pauseAccounting.finalizedEvents.length, 0);
assert.strictEqual(ledger.inspect(pauseLedger).activeHands.length, 1);
assert.strictEqual(ledger.inspect(pauseLedger).finalizedRecords.length, 0);

assert.strictEqual(hands.setRecoveryMetadata(pauseAccounting, 'HP', {
  pausedVerified: false,
  lifecycleAtPersistence: 'active-after-verified-host-resume',
  timestamp: 3020
}).updated, true);
var resumedSnapshot = Object.assign(clone(pauseStart), { paused: false });
observeState(pauseLedger, 'HP', resumedSnapshot, pausedSnapshot, {
  paused: false,
  status: 'inProgress'
}, 'hp-resume', 3020);

var pauseRaised = clone(resumedSnapshot);
pauseRaised.tB.p1 = 60;
pauseRaised.cHB = 60;
pauseRaised.mR = 100;
pauseRaised.cRPI = ['p1'];
pauseRaised.players.p1.stack = 940;
observeState(pauseLedger, 'HP', pauseRaised, resumedSnapshot, {
  tB: { p1: 60 },
  cHB: 60,
  mR: 100,
  cRPI: ['p1'],
  players: { p1: { stack: 940 } }
}, 'hp-action', 3030);
assert.strictEqual(stageAction(
  pauseAccounting,
  'HP',
  'p1',
  'Alice',
  'raise',
  'preflop',
  60,
  3030
).staged, true);

var pauseTerminal = terminalState(
  pauseRaised,
  { p1: { gained: 80 }, p2: { gained: 0 } },
  { p1: 1020, p2: 980 }
);
observeState(pauseLedger, 'HP', pauseTerminal, pauseRaised, {
  gT: pauseTerminal.gT,
  pot: 0,
  gameResult: pauseTerminal.gameResult,
  players: { p1: { stack: 1020 }, p2: { stack: 980 } }
}, 'hp-terminal', 3040);

var pauseCommit = mirrorCommit(
  pauseAccounting,
  pauseLedger,
  'HP',
  'settlement after verified Resume',
  3050
);
assert.strictEqual(pauseCommit.commit.committed, true);
assert.strictEqual(pauseCommit.semantic.finalized, true);
assert.deepStrictEqual(
  pauseCommit.semantic.record.actions.map(function (action) { return action.type; }),
  ['post_blind', 'post_blind', 'raise'],
  'Pause/Resume lifecycle observations cannot manufacture betting actions'
);
assert.strictEqual(pauseCommit.semantic.record.provenance.historyComplete, true);

/* Reload into a game break creates no hand; the verified one-shot restart does. */
var breakState = gameBreak.createState({
  buildId: 'semantic-ledger-lifecycle-test',
  gameSessionKey: 'table'
});
var waitingTrace = gameBreak.recordSnapshot(breakState, {
  timestamp: 4000,
  normalizedLifecycle: {
    classification: 'broken',
    confidence: 'authoritative',
    reason: 'waiting for second eligible player'
  },
  currentTableStatus: 'waitingToStart',
  playerStatuses: [
    { playerId: 'p1', mapped: true, occupied: true, activeInGame: true },
    { playerId: 'p2', mapped: true, occupied: true, activeInGame: false }
  ],
  occupiedSeatCount: 2,
  activeInGamePlayerCount: 1,
  mappedPlayerCount: 2,
  activeHand: null,
  activeHandId: null,
  currentBoundaryBaseline: {
    holeCardCount: 0,
    holeCardCollections: [],
    inHandPlayerIds: [],
    tB: {},
    settlementPresent: false
  },
  currentDealFingerprint: 'terminal-break-baseline',
  priorHandResolved: true,
  cleanPreDealBaseline: true,
  dealingPossible: false,
  holeCardCount: 0,
  inHandPlayerIds: [],
  initialAuthoritativeSnapshot: true,
  storageHydrationComplete: true
});
assert.strictEqual(waitingTrace.breakInitializedFromReload, true);
assert.strictEqual(waitingTrace.breakOpen, true);

var breakLedger = ledger.createState({ finalizedHandIds: ['PRE-BREAK'] });
assert.strictEqual(ledger.inspect(breakLedger).activeHands.length, 0);
assert.strictEqual(ledger.inspect(breakLedger).finalizedRecords.length, 0);

var activeTrace = gameBreak.recordSnapshot(breakState, {
  timestamp: 4010,
  normalizedLifecycle: {
    classification: 'active',
    confidence: 'authoritative',
    reason: 'verified new deal'
  },
  currentTableStatus: 'inProgress',
  playerStatuses: [
    { playerId: 'p1', mapped: true, occupied: true, activeInGame: true },
    { playerId: 'p2', mapped: true, occupied: true, activeInGame: true }
  ],
  occupiedSeatCount: 2,
  activeInGamePlayerCount: 2,
  mappedPlayerCount: 2,
  activeHand: null,
  activeHandId: null,
  currentBoundaryBaseline: {
    holeCardCount: 2,
    holeCardCollections: [{ path: '$.pC.p1.cards', length: 2 }],
    inHandPlayerIds: ['p1', 'p2'],
    sBPI: 'p1',
    bBPI: 'p2',
    cPI: 'p1',
    pITT: 'p1',
    tB: { p1: 10, p2: 20 },
    settlementPresent: false
  },
  currentDealFingerprint: 'restart-deal-fingerprint',
  priorHandResolved: true,
  cleanPreDealBaseline: false,
  dealingPossible: true,
  holeCardCount: 2,
  inHandPlayerIds: ['p1', 'p2'],
  initialAuthoritativeSnapshot: false,
  storageHydrationComplete: true
});
assert.strictEqual(activeTrace.gameBreakToActiveDetected, true);

var resumeEvaluation = gameBreak.evaluateResumeBoundary(breakState, {
  noActiveHand: true,
  mappedPlayerIds: ['p1', 'p2'],
  recoveredEligiblePlayerIds: ['p1', 'p2'],
  inHandPlayerIds: ['p1', 'p2'],
  smallBlindPlayerId: 'p1',
  bigBlindPlayerId: 'p2',
  currentPlayerId: 'p1',
  playerInTurnId: 'p1',
  holeCardPlayerIds: ['p1'],
  blindCommitmentsValid: true,
  dealSpecificTransitionObserved: true,
  tableActive: true,
  verifiedDealStarted: true,
  lifecycleTransitionVerified: activeTrace.gameBreakToActiveDetected,
  currentDealFingerprint: 'restart-deal-fingerprint',
  confidenceBeforeOverride: 15,
  requiredConfidence: 50,
  observedSignals: ['verified restart deal']
});
assert.strictEqual(resumeEvaluation.activated, true);
assert.strictEqual(gameBreak.consumeResumeBoundary(breakState, resumeEvaluation, 4020), true);
assert.strictEqual(gameBreak.consumeResumeBoundary(breakState, resumeEvaluation, 4021), false);

var restartAccounting = hands.createState();
stageOwnedHand(restartAccounting, 'H-RESTART', 4030);
var restartStart = baseState('H-RESTART', 4);
observeState(breakLedger, 'H-RESTART', restartStart, null, restartStart, 'restart-1', 4030);
var restartTerminal = terminalState(
  restartStart,
  { p1: { gained: 30 }, p2: { gained: 0 } },
  { p1: 1010, p2: 980 }
);
observeState(breakLedger, 'H-RESTART', restartTerminal, restartStart, {
  gT: restartTerminal.gT,
  pot: 0,
  gameResult: restartTerminal.gameResult,
  players: { p1: { stack: 1010 }, p2: { stack: 980 } }
}, 'restart-terminal', 4040);
var restartCommit = mirrorCommit(
  restartAccounting,
  breakLedger,
  'H-RESTART',
  'first verified hand after break reload restart',
  4050
);
assert.strictEqual(restartCommit.commit.committed, true);
assert.strictEqual(restartCommit.semantic.finalized, true);
assert.strictEqual(ledger.inspect(breakLedger).finalizedRecords.length, 1);
assert.ok(ledger.inspect(breakLedger).finalizedHandIds.includes('PRE-BREAK'));
assert.ok(ledger.inspect(breakLedger).finalizedHandIds.includes('H-RESTART'));
assert.strictEqual(mirrorCommit(
  restartAccounting,
  breakLedger,
  'H-RESTART',
  'replayed restart settlement',
  4060
).semantic.duplicate, true);
assert.strictEqual(ledger.inspect(breakLedger).finalizedRecords.length, 1);

/* A distinct next-hand boundary finalizes partial facts without inventing settlement. */
var boundaryAccounting = hands.createState();
var boundaryLedger = ledger.createState();
stageOwnedHand(boundaryAccounting, 'H-PARTIAL', 5000);
var partialStart = baseState('H-PARTIAL', 5);
observeState(boundaryLedger, 'H-PARTIAL', partialStart, null, partialStart, 'partial-1', 5000);

var partialCall = clone(partialStart);
partialCall.tB.p1 = 20;
partialCall.cPI = 'p2';
partialCall.pITT = 'p2';
partialCall.cRPI = ['p1'];
partialCall.players.p1.stack = 980;
observeState(boundaryLedger, 'H-PARTIAL', partialCall, partialStart, {
  tB: { p1: 20 },
  cPI: 'p2',
  pITT: 'p2',
  cRPI: ['p1'],
  players: { p1: { stack: 980 } }
}, 'partial-2', 5010);
assert.strictEqual(stageAction(
  boundaryAccounting,
  'H-PARTIAL',
  'p1',
  'Alice',
  'call',
  'preflop',
  20,
  5010
).staged, true);

var nextBoundary = hands.beginHand(boundaryAccounting, 'H-NEXT', {
  activate: true,
  timestamp: 5020,
  priorReason: 'next distinct hand began via websocket hand boundary'
});
assert.ok(nextBoundary.priorResult);
assert.strictEqual(nextBoundary.priorResult.committed, true);

var partialFinalize = ledger.finalize(boundaryLedger, 'H-PARTIAL', {
  reason: 'next distinct hand began',
  timestamp: 5020,
  nextAuthoritativeHandId: 'H-NEXT',
  fallbackHand: nextBoundary.priorResult.hand
});
assert.strictEqual(partialFinalize.finalized, true);
assert.strictEqual(partialFinalize.record.handIdentity.nextHandId, 'H-NEXT');
assert.strictEqual(partialFinalize.record.provenance.terminalEvidence, false);
assert.strictEqual(partialFinalize.record.settlement.status, 'unresolved');
assert.strictEqual(partialFinalize.record.settlement.chopped, null);
assert.strictEqual(partialFinalize.record.settlement.uncontested, null);
assert.strictEqual(partialFinalize.record.showdown.detected, null);
assert.ok(ambiguityCodes(partialFinalize.record).includes(
  ledger.AMBIGUITY_CODES.SETTLEMENT_UNRESOLVED
));
assert.deepStrictEqual(partialFinalize.record.settlement.awards, []);
assert.deepStrictEqual(partialFinalize.record.settlement.refunds, []);

var nextStart = baseState('H-NEXT', 6);
observeState(boundaryLedger, 'H-NEXT', nextStart, null, nextStart, 'next-1', 5030);
var repeatedSameBoundary = hands.beginHand(boundaryAccounting, 'H-NEXT', {
  activate: true,
  timestamp: 5040
});
assert.strictEqual(repeatedSameBoundary.priorResult, null);
assert.strictEqual(ledger.inspect(boundaryLedger).finalizedRecords.length, 1);
assert.strictEqual(ledger.inspect(boundaryLedger).activeHands.length, 1);
assert.strictEqual(ledger.inspect(boundaryLedger).activeHands[0].handId, 'H-NEXT');

/* Production wiring remains isolated from Full Log and converges on commitHand. */
var isolatedScripts = manifest.content_scripts.find(function (entry) {
  return entry.js.includes('content.js');
}).js;
assert.ok(isolatedScripts.includes('semanticHandLedger.js'));
assert.ok(
  isolatedScripts.indexOf('semanticHandLedger.js') < isolatedScripts.indexOf('content.js'),
  'the production ledger loads before its content-script consumer'
);

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes(
  "['PokerSemanticHandLedger', globalThis.PokerSemanticHandLedger, 'semanticHandLedger.js']"
));
assert.ok(content.includes('PokerSemanticHandLedger.createState({'));
assert.ok(content.includes('PokerSemanticHandLedger.seedRecoveredHand('));
assert.ok(content.includes('semanticHandLedger: PokerSemanticHandLedger.inspect('));
assert.ok(content.includes('PokerSemanticHandLedger.observe('));
assert.ok(content.includes('PokerSemanticHandLedger.finalize('));

var processStart = content.indexOf('function processGcSnapshot(');
var boundaryIndex = content.indexOf('detectGcNewHand(', processStart);
var observeIndex = content.indexOf('PokerSemanticHandLedger.observe(', processStart);
var snapshotAdvanceIndex = content.indexOf('previousGcSnapshot = currentSnapshot', processStart);
assert.ok(
  processStart >= 0 &&
  boundaryIndex > processStart &&
  observeIndex > boundaryIndex &&
  snapshotAdvanceIndex > observeIndex,
  'the ledger observes the authoritative owned hand after boundary ownership and before snapshot advancement'
);

var commitHookStart = content.indexOf('function applyHandCommitResult(');
var ledgerFinalizeIndex = content.indexOf('PokerSemanticHandLedger.finalize(', commitHookStart);
var beginHandIndex = content.indexOf('function beginStatsHand(', commitHookStart);
assert.ok(
  commitHookStart >= 0 &&
  ledgerFinalizeIndex > commitHookStart &&
  beginHandIndex > ledgerFinalizeIndex,
  'both accepted production completion paths converge on the bounded ledger finalizer'
);
assert.ok(content.includes("if (source === 'full-log') {"));
assert.ok(content.includes('full-log-stats-withheld'));
assert.doesNotMatch(content, /PokerSemanticHandLedger\.observe\([^)]*full-log/i);
assert.doesNotMatch(content, /PokerSemanticHandLedger\.finalize\([^)]*full-log/i);

console.log('Production semantic ledger exactly-once, replay/restore, Pause/Resume, break/reload/restart, and partial-boundary lifecycle tests passed.');
