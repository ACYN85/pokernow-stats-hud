'use strict';

var assert = require('assert');
var fs = require('fs');
var ledger = require('./semanticHandLedger.js');

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

function observe(target, handId, currentState, previousState, patch, frameId, timestamp, extra) {
  return ledger.observe(target, Object.assign({
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
  }, extra || {}));
}

function ambiguityCodes(record) {
  return record.ambiguities.map(function (item) { return item.code; });
}

assert.strictEqual(ledger.SCHEMA_VERSION, 1);
assert.ok(Object.isFrozen(ledger.AMBIGUITY_CODES));
['createState', 'syncFinalizedHandIds', 'seedRecoveredHand', 'activeHandSnapshot', 'restoreActiveHandSnapshot', 'observe', 'finalizationReadiness', 'finalize', 'discard', 'inspect'].forEach(function (name) {
  assert.strictEqual(typeof ledger[name], 'function', name + ' is part of the production-safe pure API');
});

var unresolvedState = ledger.createState();
var unresolvedStart = baseState('U1', 1);
assert.strictEqual(observe(unresolvedState, 'U1', unresolvedStart, null, unresolvedStart, 'u-1', 1000).observed, true);
var unresolvedResult = ledger.finalize(unresolvedState, 'U1', {
  reason: 'next distinct hand began',
  timestamp: 1100,
  nextAuthoritativeHandId: 'U2'
});
assert.strictEqual(unresolvedResult.finalized, true);

var unresolved = unresolvedResult.record;
assert.strictEqual(unresolved.schemaVersion, ledger.SCHEMA_VERSION);
assert.strictEqual(unresolved.mode, 'production_shadow');
assert.strictEqual(unresolved.status, 'finalized');
assert.deepStrictEqual(unresolved.handIdentity, {
  handId: 'U1',
  lifecycleHandId: 'U1',
  gameNumber: 1,
  previousHandId: null,
  nextHandId: 'U2'
});
assert.strictEqual(unresolved.provenance.source, 'live-websocket-merged-state');
assert.strictEqual(unresolved.provenance.finalizationReason, 'next distinct hand began');
assert.strictEqual(unresolved.provenance.terminalEvidence, false);
assert.strictEqual(unresolved.settlement.status, 'unresolved');
assert.strictEqual(unresolved.settlement.chopped, null);
assert.strictEqual(unresolved.settlement.uncontested, null);
assert.strictEqual(unresolved.settlement.sidePotStatus, null);
assert.strictEqual(unresolved.showdown.detected, null);
unresolved.players.forEach(function (player) {
  assert.strictEqual(player.folded, null, 'unresolved folds remain unknown');
  assert.strictEqual(player.allIn, null, 'unobserved all-in state remains unknown');
  assert.strictEqual(player.sawFlop, null, 'unobserved flop participation remains unknown');
  assert.strictEqual(player.reachedShowdown, null, 'unresolved showdown membership remains unknown');
  assert.strictEqual(player.awardTotal, null, 'unresolved awards remain unknown');
});
assert.ok(ambiguityCodes(unresolved).includes(ledger.AMBIGUITY_CODES.SETTLEMENT_UNRESOLVED));

var knownState = ledger.createState();
var knownStart = baseState('K1', 2);
observe(knownState, 'K1', knownStart, null, knownStart, 'k-1', 2000);

var folded = clone(knownStart);
folded.pGS.p2 = 'fold';
folded.cPI = null;
folded.pITT = null;
observe(knownState, 'K1', folded, knownStart, {
  pGS: { p2: 'fold' },
  cPI: null,
  pITT: null
}, 'k-2', 2010);

var terminal = clone(folded);
terminal.gT = ['holdem', 5];
terminal.pot = 0;
terminal.gameResult = { p1: { gained: 30 }, p2: { gained: 0 } };
terminal.players.p1.stack = 1010;
terminal.players.p2.stack = 980;
observe(knownState, 'K1', terminal, folded, {
  gT: terminal.gT,
  pot: 0,
  gameResult: terminal.gameResult,
  players: { p1: { stack: 1010 }, p2: { stack: 980 } }
}, 'k-3', 2020);

var known = ledger.finalize(knownState, 'K1', {
  reason: 'settlement/gameResult',
  timestamp: 2030
}).record;
assert.strictEqual(known.provenance.terminalEvidence, true);
assert.strictEqual(known.settlement.status, 'known');
assert.strictEqual(known.settlement.chopped, false);
assert.strictEqual(known.settlement.uncontested, true);
assert.strictEqual(known.showdown.detected, false);
assert.strictEqual(known.players.find(function (player) { return player.playerId === 'p1'; }).folded, false);
assert.strictEqual(known.players.find(function (player) { return player.playerId === 'p2'; }).folded, true);
assert.strictEqual(known.players.find(function (player) { return player.playerId === 'p1'; }).awardTotal, 30);
assert.strictEqual(known.players.find(function (player) { return player.playerId === 'p2'; }).awardTotal, 0);

var splitTerminalState = ledger.createState();
var splitStart = baseState('SPLIT-TERMINAL', 21);
observe(splitTerminalState, 'SPLIT-TERMINAL', splitStart, null, splitStart, 'split-1', 2100);
var earlySettlement = clone(splitStart);
earlySettlement.gT = ['holdem', 3];
earlySettlement.gameResult = { p1: { gained: 30 } };
observe(splitTerminalState, 'SPLIT-TERMINAL', earlySettlement, splitStart, {
  gameResult: earlySettlement.gameResult
}, 'split-2', 2110);
var provisionalReadiness = ledger.finalizationReadiness(splitTerminalState, 'SPLIT-TERMINAL');
assert.strictEqual(provisionalReadiness.ready, false);
assert.strictEqual(provisionalReadiness.settlementObserved, true);
assert.strictEqual(provisionalReadiness.settlementRetained, true);
assert.strictEqual(provisionalReadiness.terminalPhaseKnown, false);
var completeTerminal = clone(earlySettlement);
completeTerminal.gT = ['holdem', 5];
completeTerminal.pC = {
  p1: { cards: [{ showing: true }] },
  p2: { cards: [{ showing: true }] }
};
observe(splitTerminalState, 'SPLIT-TERMINAL', completeTerminal, earlySettlement, {
  gT: completeTerminal.gT,
  pC: completeTerminal.pC
}, 'split-3', 2120);
var completeReadiness = ledger.finalizationReadiness(splitTerminalState, 'SPLIT-TERMINAL');
assert.strictEqual(completeReadiness.ready, true, 'retained settlement and a later terminal patch complete the exact hand');
assert.deepStrictEqual(completeReadiness.revealPlayerIds, ['p1', 'p2']);
var splitFinalized = ledger.finalize(splitTerminalState, 'SPLIT-TERMINAL', { reason: 'deferred terminal readiness', timestamp: 2130 });
assert.strictEqual(splitFinalized.record.provenance.terminalEvidence, true);
assert.strictEqual(splitFinalized.record.settlement.status, 'known');
assert.strictEqual(ledger.finalizationReadiness(splitTerminalState, 'SPLIT-TERMINAL').duplicate, true);

var recoveredState = ledger.createState();
var recoveredHand = {
  handId: 'R1',
  createdAt: 3000,
  updatedAt: 3010,
  recovered: true,
  events: [
    {
      handId: 'R1',
      playerId: 'p1',
      player: 'Alice',
      action: 'raise',
      street: 'preflop',
      amount: 60,
      timestamp: 3005
    }
  ],
  participants: {
    Alice: { playerId: 'p1', name: 'Alice', evidence: ['persisted live participant'] },
    Bob: { playerId: 'p2', name: 'Bob', evidence: ['persisted live participant'] }
  }
};
assert.deepStrictEqual(ledger.seedRecoveredHand(recoveredState, recoveredHand), {
  seeded: true,
  handId: 'R1'
});
var recoveredInspection = ledger.inspect(recoveredState);
assert.strictEqual(recoveredInspection.activeHands[0].recovered, true);
assert.strictEqual(recoveredInspection.activeHands[0].historyComplete, false);

var snapshotSource = ledger.createState();
var snapshotStart = baseState('SNAPSHOT-1', 33);
observe(snapshotSource, 'SNAPSHOT-1', snapshotStart, null, snapshotStart, 'snapshot-1', 3300);
var snapshotCall = clone(snapshotStart);
snapshotCall.tB.p1 = 60;
snapshotCall.cHB = 60;
observe(snapshotSource, 'SNAPSHOT-1', snapshotCall, snapshotStart, { tB: { p1: 60 }, cHB: 60 }, 'snapshot-2', 3310);
var activeSnapshot = ledger.activeHandSnapshot(snapshotSource, 'SNAPSHOT-1');
assert.strictEqual(activeSnapshot.kind, 'semantic-active-hand-shadow');
assert.strictEqual(activeSnapshot.schemaVersion, ledger.SCHEMA_VERSION);
assert.strictEqual(activeSnapshot.hand.observations.length, 2);
var snapshotRestored = ledger.createState();
assert.deepStrictEqual(ledger.restoreActiveHandSnapshot(snapshotRestored, activeSnapshot), {
  restored: true,
  handId: 'SNAPSHOT-1',
  observationCount: 2,
  historyComplete: true
});
var restoredSnapshotInspection = ledger.inspect(snapshotRestored).activeHands[0];
assert.strictEqual(restoredSnapshotInspection.recovered, false, 'exact semantic snapshots do not become conservative incomplete recovery seeds');
assert.strictEqual(restoredSnapshotInspection.historyComplete, true);
assert.strictEqual(restoredSnapshotInspection.observationCount, 2);
assert.strictEqual(ledger.restoreActiveHandSnapshot(snapshotRestored, { schemaVersion: 999, kind: 'semantic-active-hand-shadow', hand: { handId: 'BAD' } }).restored, false);
var finalizedSnapshotState = ledger.createState({ finalizedHandIds: ['SNAPSHOT-1'] });
assert.strictEqual(ledger.restoreActiveHandSnapshot(finalizedSnapshotState, activeSnapshot).duplicate, true, 'a finalized identity cannot be resurrected by snapshot restore');

var recoveredSnapshot = baseState('R1', 3);
observe(recoveredState, 'R1', recoveredSnapshot, null, recoveredSnapshot, 'r-1', 3020);
var recoveredRecord = ledger.finalize(recoveredState, 'R1', {
  reason: 'verified settlement after reload',
  timestamp: 3030,
  fallbackHand: recoveredHand
}).record;
assert.strictEqual(recoveredRecord.provenance.recovered, true);
assert.strictEqual(recoveredRecord.provenance.historyComplete, false);
assert.ok(ambiguityCodes(recoveredRecord).includes(ledger.AMBIGUITY_CODES.PARTIAL_HISTORY_AFTER_RECOVERY));
var recoveredRaise = recoveredRecord.actions.find(function (action) { return action.type === 'raise'; });
assert.ok(recoveredRaise, 'the persisted generic action remains available as bounded recovery evidence');
assert.strictEqual(recoveredRaise.confidence, 'recovered_generic_event');

var duplicateRecoveryState = ledger.createState({ finalizedHandIds: ['R2'] });
assert.strictEqual(ledger.seedRecoveredHand(
  duplicateRecoveryState,
  Object.assign({}, recoveredHand, { handId: 'R2' })
).duplicate, true);
assert.strictEqual(observe(
  duplicateRecoveryState,
  'R2',
  baseState('R2', 4),
  null,
  {},
  'r2-1',
  3100
).duplicate, true);
assert.strictEqual(ledger.finalize(
  duplicateRecoveryState,
  'R2',
  { reason: 'replayed settlement' }
).duplicate, true);

var discardState = ledger.createState();
var discardSnapshot = baseState('D1', 5);
observe(discardState, 'D1', discardSnapshot, null, discardSnapshot, 'd-1', 3200);
assert.strictEqual(ledger.inspect(discardState).activeHands.length, 1);
var discarded = ledger.discard(discardState, 'D1', {
  reason: 'recovered incomplete hand was superseded by a distinct boundary'
});
assert.deepStrictEqual(discarded, {
  discarded: true,
  handId: 'D1',
  previouslyFinalized: false
});
var discardedInspection = ledger.inspect(discardState);
assert.strictEqual(discardedInspection.activeHands.length, 0);
assert.strictEqual(discardedInspection.finalizedRecords.length, 0);
assert.strictEqual(discardedInspection.finalizedHandIds.includes('D1'), false);
assert.strictEqual(discardedInspection.finalizationAttempts.slice(-1)[0].type, 'discard');
assert.strictEqual(discardedInspection.finalizationAttempts.slice(-1)[0].accepted, true);
assert.strictEqual(ledger.discard(discardState, 'D1', { reason: 'repeat discard' }).discarded, false);
assert.strictEqual(ledger.discard(discardState, null).discarded, false);

var boundedState = ledger.createState({
  maxRecords: 2,
  maxObservationsPerHand: 20,
  maxAttempts: 10
});
['B1', 'B2', 'B3'].forEach(function (handId, index) {
  var snapshot = baseState(handId, 10 + index);
  observe(boundedState, handId, snapshot, null, snapshot, 'b-' + index, 4000 + index);
  assert.strictEqual(ledger.finalize(boundedState, handId, {
    reason: 'bounded record ' + handId,
    timestamp: 4100 + index
  }).finalized, true);
});

var boundedInspection = ledger.inspect(boundedState);
assert.deepStrictEqual(
  boundedInspection.finalizedRecords.map(function (record) { return record.handIdentity.handId; }),
  ['B2', 'B3']
);
assert.ok(['B1', 'B2', 'B3'].every(function (handId) {
  return boundedInspection.finalizedHandIds.includes(handId);
}), 'record retention never weakens finalized-ID deduplication');
assert.deepStrictEqual(boundedInspection.bounds, {
  maxFinalizedRecords: 2,
  maxObservationsPerHand: 20,
  maxFinalizationAttempts: 10
});

var observationBase = baseState('OBS', 20);
for (var observationIndex = 0; observationIndex < 25; observationIndex += 1) {
  var observationCurrent = clone(observationBase);
  observationCurrent.cPI = observationIndex % 2 ? 'p1' : 'p2';
  observationCurrent.pITT = observationCurrent.cPI;
  observe(
    boundedState,
    'OBS',
    observationCurrent,
    observationIndex ? observationBase : null,
    { cPI: observationCurrent.cPI, pITT: observationCurrent.pITT },
    'obs-' + observationIndex,
    5000 + observationIndex
  );
  observationBase = observationCurrent;
}
var observationRecord = ledger.finalize(boundedState, 'OBS', {
  reason: 'bounded observation finalization',
  timestamp: 5100
}).record;
assert.strictEqual(observationRecord.provenance.observationCount, 20);
assert.strictEqual(observationRecord.provenance.historyComplete, false);
assert.ok(ambiguityCodes(observationRecord).includes(ledger.AMBIGUITY_CODES.OBSERVATION_LIMIT_REACHED));

for (var attemptIndex = 0; attemptIndex < 15; attemptIndex += 1) {
  assert.strictEqual(ledger.finalize(boundedState, 'OBS', {
    reason: 'duplicate attempt ' + attemptIndex
  }).duplicate, true);
}
assert.strictEqual(
  ledger.inspect(boundedState).finalizationAttempts.length,
  10,
  'finalization-attempt diagnostics are bounded'
);

var sourceIsolationState = ledger.createState();
var sourceSnapshot = baseState('S1', 30);
sourceSnapshot.domText = 'SECRET_FULL_LOG_TEXT';
sourceSnapshot.unboundedRawPayload = { value: 'SECRET_RAW_PAYLOAD' };
observe(sourceIsolationState, 'S1', sourceSnapshot, null, {
  hI: 'S1',
  domText: 'SECRET_FULL_LOG_PATCH',
  unboundedRawPayload: { value: 'SECRET_RAW_PATCH' }
}, 's-1', 6000, {
  source: 'full-log',
  provenance: { source: 'hand-log-dom' }
});
var isolatedRecord = ledger.finalize(sourceIsolationState, 'S1', {
  reason: 'source-isolation-check',
  timestamp: 6010
}).record;
var isolatedJson = JSON.stringify(isolatedRecord);
assert.strictEqual(
  isolatedRecord.provenance.source,
  'live-websocket-merged-state',
  'callers cannot relabel the production ledger as a DOM/Full Log source'
);
assert.strictEqual(isolatedJson.includes('SECRET_FULL_LOG'), false);
assert.strictEqual(isolatedJson.includes('SECRET_RAW'), false);
assert.strictEqual(isolatedJson.includes('hand-log-dom'), false);

var ledgerSource = fs.readFileSync('./semanticHandLedger.js', 'utf8');
assert.doesNotMatch(ledgerSource, /PokerStats|computePlayerStats|render\s*\(|document\.querySelector|chrome\.storage/);
assert.doesNotMatch(ledgerSource, /require\(['"]\.\/testSupport\//);
assert.doesNotMatch(ledgerSource, /rawFixtureFactExtractor/);

var restoredFromRecords = ledger.createState({
  finalizedRecords: [isolatedRecord],
  finalizedHandIds: []
});
assert.ok(
  ledger.inspect(restoredFromRecords).finalizedHandIds.includes('S1'),
  'restored records seed finalized identity deduplication'
);
assert.strictEqual(observe(
  restoredFromRecords,
  'S1',
  baseState('S1', 30),
  null,
  {},
  's-replay',
  6020
).duplicate, true);
assert.strictEqual(ledger.syncFinalizedHandIds(
  restoredFromRecords,
  ['EXTERNAL-FINALIZED']
), 2);
assert.strictEqual(observe(
  restoredFromRecords,
  'EXTERNAL-FINALIZED',
  baseState('EXTERNAL-FINALIZED', 31),
  null,
  {},
  's-sync',
  6030
).duplicate, true);

console.log('Production semantic hand ledger pure API, schema, tri-state, bounds, recovery, discard, and source-isolation tests passed.');
