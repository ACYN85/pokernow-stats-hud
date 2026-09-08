'use strict';

var assert = require('assert');
var fs = require('fs');
var ledger = require('./semanticHandLedger.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');
var runtime = require('./hudRuntimeStatus.js');
var overlayStats = require('./overlayStats.js');
var leaderboardStats = require('./leaderboardStats.js');
var seatOverlay = require('./seatOverlay.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function displayContract(playerStats) {
  var ids = overlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice();
  return {
    defaultIds: ids,
    catalogIds: Object.keys(overlayStats.STAT_CATALOG),
    definitions: overlayStats.definitionsFor(ids).map(function (definition) {
      return {
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        tableLabel: definition.tableLabel,
        category: definition.category,
        renderedValue: definition.formatValue(definition.getValue(playerStats))
      };
    }),
    leaderboardDefaults: clone(leaderboardStats.DEFAULTS),
    leaderboardLabels: leaderboardStats.definitions(ids).map(leaderboardStats.tableLabel),
    overlayLabel: seatOverlay.compactStatsLabel(playerStats, ids)
  };
}

function statusContract() {
  return {
    live: runtime.presentation('live'),
    paused: runtime.presentation('live-socket'),
    waiting: runtime.presentation('waiting'),
    connecting: runtime.presentation('initializing'),
    disconnected: runtime.presentation('disconnected')
  };
}

var accounting = hands.createState({ finalizedEvents: [] });
hands.beginHand(accounting, 'neutral-hand', { activate: true, timestamp: 1000 });
hands.stageEvent(accounting, {
  handId: 'neutral-hand',
  playerId: 'p1',
  player: 'Alice',
  action: 'raise',
  street: 'preflop',
  amount: 20,
  timestamp: 1100
}, { playerId: 'p1', reason: 'verified raise action' });
hands.stageEvent(accounting, {
  handId: 'neutral-hand',
  playerId: 'p2',
  player: 'Bob',
  action: 'call',
  street: 'preflop',
  amount: 20,
  timestamp: 1200
}, { playerId: 'p2', reason: 'verified call action' });
hands.stageEvent(accounting, {
  handId: 'neutral-hand',
  playerId: 'p1',
  player: 'Alice',
  action: 'bet',
  street: 'flop',
  amount: 30,
  timestamp: 1300
}, { playerId: 'p1', reason: 'verified bet action' });
hands.stageEvent(accounting, {
  handId: 'neutral-hand',
  playerId: 'p2',
  player: 'Bob',
  action: 'call',
  street: 'flop',
  amount: 30,
  timestamp: 1400
}, { playerId: 'p2', reason: 'verified call action' });
var statsCommit = hands.commitHand(accounting, 'neutral-hand', 'settlement/gameResult', 1500);
assert.strictEqual(statsCommit.committed, true);

var finalizedEventsReference = accounting.finalizedEvents;
var finalizedEventsBefore = JSON.stringify(accounting.finalizedEvents);
var playerStatsBefore = {
  Alice: stats.computePlayerStats(accounting.finalizedEvents, 'Alice'),
  Bob: stats.computePlayerStats(accounting.finalizedEvents, 'Bob')
};
var displaysBefore = displayContract(playerStatsBefore.Alice);
var statusesBefore = statusContract();
assert.deepStrictEqual(statusesBefore, {
  live: { label: 'Live', note: 'PokerNow game is actively running.' },
  paused: { label: 'Paused', note: 'PokerNow game is paused.' },
  waiting: { label: 'Waiting', note: 'PokerNow connected · waiting for the game to resume' },
  connecting: { label: 'Connecting…', note: 'Connecting to the PokerNow game state' },
  disconnected: { label: 'Disconnected', note: 'PokerNow socket unavailable' }
});
assert.deepStrictEqual(displaysBefore.defaultIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'], 'the visible registry includes the candidate showdown statistics without changing ledger behavior');

var runtimeState = runtime.createState({ timestamp: 1 });
runtime.reconcile(runtimeState, {
  timestamp: 2,
  connected: true,
  freshGameState: true,
  tableStatus: 'inProgress',
  tableClassification: 'active',
  gamePaused: false,
  gameStopped: false,
  gameBroken: false,
  waitingToStart: false
});
var runtimeStateBefore = runtime.snapshot(runtimeState);

var shadow = ledger.createState({ maxRecords: 2, maxObservationsPerHand: 20, maxAttempts: 10 });
var startState = {
  hI: 'neutral-hand',
  gN: 1,
  gT: [1, 0],
  players: { p1: { stack: 100 }, p2: { stack: 100 } },
  seats: [[1, 'p1'], [2, 'p2']],
  iHPI: ['p1', 'p2'],
  sBPI: 'p1',
  bBPI: 'p2',
  tB: { p1: 10, p2: 20 },
  pot: 30
};
var terminalState = {
  hI: 'neutral-hand',
  gN: 1,
  gT: [1, 5],
  players: { p1: { stack: 120 }, p2: { stack: 80 } },
  seats: [[1, 'p1'], [2, 'p2']],
  iHPI: ['p1'],
  sBPI: 'p1',
  bBPI: 'p2',
  tB: { p1: 20, p2: 'fold' },
  pot: 0,
  gameResult: { p1: { gained: 40, position: 1 } }
};
var ledgerInputsBefore = JSON.stringify({ startState: startState, terminalState: terminalState, fallbackHand: statsCommit.hand });
assert.strictEqual(ledger.observe(shadow, {
  handId: 'neutral-hand',
  authoritativeHandId: 'neutral-hand',
  frameId: 1,
  timestamp: 1000,
  eventName: 'gC',
  previousState: null,
  currentState: startState,
  patch: startState
}).observed, true);
assert.strictEqual(ledger.observe(shadow, {
  handId: 'neutral-hand',
  authoritativeHandId: 'neutral-hand',
  frameId: 2,
  timestamp: 1500,
  eventName: 'gC',
  previousState: startState,
  currentState: terminalState,
  patch: { gT: [1, 5], players: terminalState.players, gameResult: terminalState.gameResult }
}).observed, true);
var shadowResult = ledger.finalize(shadow, 'neutral-hand', {
  reason: 'accepted production hand commit',
  timestamp: 1500,
  fallbackHand: statsCommit.hand
});
assert.strictEqual(shadowResult.finalized, true);
assert.strictEqual(shadowResult.record.mode, 'production_shadow');
assert.strictEqual(shadowResult.record.provenance.terminalEvidence, true);
assert.strictEqual(shadowResult.record.settlement.status, 'known');
assert.strictEqual(JSON.stringify({ startState: startState, terminalState: terminalState, fallbackHand: statsCommit.hand }), ledgerInputsBefore, 'shadow extraction does not mutate normalized runtime inputs');

assert.strictEqual(accounting.finalizedEvents, finalizedEventsReference, 'shadow finalization preserves the existing HUD event-array identity');
assert.strictEqual(JSON.stringify(accounting.finalizedEvents), finalizedEventsBefore, 'shadow finalization does not change a production statistic event byte');
assert.deepStrictEqual({
  Alice: stats.computePlayerStats(accounting.finalizedEvents, 'Alice'),
  Bob: stats.computePlayerStats(accounting.finalizedEvents, 'Bob')
}, playerStatsBefore, 'Hands, VPIP, PFR, and AF remain value-for-value unchanged');
assert.deepStrictEqual(displayContract(stats.computePlayerStats(accounting.finalizedEvents, 'Alice')), displaysBefore, 'shadow finalization does not register or render a visible statistic');
assert.deepStrictEqual(statusContract(), statusesBefore, 'all runtime status labels and notes remain unchanged');
assert.deepStrictEqual(runtime.snapshot(runtimeState), runtimeStateBefore, 'shadow finalization cannot mutate runtime lifecycle/status state');

var inspection = ledger.inspect(shadow);
assert.strictEqual(inspection.finalizedRecords.length, 1, 'test-accessible shadow inspection contains the finalized hand');
inspection.finalizedRecords[0].handIdentity.handId = 'mutated-inspection-copy';
assert.strictEqual(ledger.inspect(shadow).finalizedRecords[0].handIdentity.handId, 'neutral-hand', 'inspection returns a defensive copy');

var ledgerSource = fs.readFileSync('./semanticHandLedger.js', 'utf8');
assert.doesNotMatch(ledgerSource, /chrome\s*\.\s*storage|localStorage|sessionStorage/, 'shadow ledger does not persist new data');
assert.doesNotMatch(ledgerSource, /\bdocument\b|querySelector|MutationObserver/, 'shadow ledger performs no DOM reads or rendering');
assert.doesNotMatch(ledgerSource, /PokerStats|PokerOverlayStats|PokerLeaderboardStats|PokerSeatOverlay|PokerHudRuntimeStatus/, 'shadow ledger does not depend on statistics, renderers, or runtime labels');
assert.doesNotMatch(ledgerSource, /testSupport|rawFixtureFactExtractor|fixtures[\\/]+raw-websocket/, 'production ledger does not import test-only prototype or fixture code');
assert.doesNotMatch(ledgerSource, /\brequire\s*\(/, 'production ledger has no CommonJS dependency on test-only or runtime modules');

var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
assert.ok(!JSON.stringify(manifest).includes('testSupport') && !JSON.stringify(manifest).includes('rawFixtureFactExtractor'), 'test-only semantic tooling remains outside the package');

console.log('Production semantic shadow ledger preserves stats events, VPIP/PFR/AF, runtime labels, rendering, storage, and test-only isolation.');
