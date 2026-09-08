'use strict';

var assert = require('assert');
var PokerStats = require('./stats.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/showdownStatsProductionFrames');

var COUNTERS = ['sawFlopForWTSD', 'wentToShowdown', 'showdownsForWSD', 'wonMoneyAtShowdown'];
var NEUTRAL_FIELDS = [
  'handsPlayed', 'vpipOpportunities', 'vpipHands', 'pfrOpportunities', 'pfrHands', 'vpip', 'pfr', 'af',
  'threeBetMade', 'threeBetOpportunities', 'foldToThreeBet', 'foldToThreeBetOpportunities',
  'flopCBetMade', 'flopCBetOpportunities', 'foldToFlopCBet', 'foldToFlopCBetOpportunities'
];

function initial(gameId) {
  var keys = harnessSupport.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
  return { keys: keys, storage: storage };
}

function create(gameId, storage, sessionStorageBacking) {
  var harness = harnessSupport.createHarness({
    gameId: gameId,
    initialStorage: storage,
    sessionStorageBacking: sessionStorageBacking || {},
    showdownDebugEnabled: true
  });
  assert.deepStrictEqual(harness.evaluationErrors, [], gameId + ' evaluates the exact production manifest path');
  return harness;
}

function stats(harness, keys, playerId) {
  return PokerStats.computePlayerStats(harness.storage[keys.liveEvents] || [], playerId);
}

function counters(harness, keys, playerId) {
  var value = stats(harness, keys, playerId);
  return COUNTERS.map(function (field) { return value[field]; });
}

function reductions(harness) {
  return harnessSupport.showdownDebugEntries(harness, 'reducer-invocation').filter(function (entry) { return entry.phase === 'after'; });
}

function finalizedSemantic(harness, authoritativeHandId) {
  return harnessSupport.showdownDebugEntries(harness, 'semantic-finalization').find(function (entry) {
    return entry.finalized && entry.handIdentity && entry.handIdentity.handId === authoritativeHandId;
  });
}

function runFresh(gameId, kind, authoritativeHandId, duplicateTerminal) {
  var setup = initial(gameId);
  var sessionStorageBacking = {};
  var harness = create(gameId, setup.storage, sessionStorageBacking);
  var scenario = frames.ordinary(kind, authoritativeHandId);
  var productionFrames = duplicateTerminal
    ? scenario.frames.slice(0, -2).concat([scenario.terminalFrame, scenario.terminalFrame, scenario.nextFrame])
    : scenario.frames;
  harnessSupport.dispatchFrames(harness, productionFrames, gameId);
  return { setup: setup, sessionStorageBacking: sessionStorageBacking, harness: harness, scenario: scenario };
}

// F1: a brand-new game, first lifecycle hand, complete river check-through,
// winner visible and loser unshown/mucked. The complete river action sequence,
// retained settlement, and two live entrants prove both reached showdown.
var f1 = runFresh('fresh-first-check-through', 'muck', 'AUTH-F1-CHECK-THROUGH', true);
assert.deepStrictEqual(counters(f1.harness, f1.setup.keys, 'P1'), [1, 1, 1, 1], 'F1 winner counts saw flop, showdown, supported W$SD, and win');
assert.deepStrictEqual(counters(f1.harness, f1.setup.keys, 'P2'), [1, 1, 1, 0], 'F1 unshown loser counts saw flop and supported showdown without a win');
assert.strictEqual(reductions(f1.harness).length, 1, 'duplicate terminal/settlement frames reduce F1 exactly once');

var f1Semantic = finalizedSemantic(f1.harness, 'AUTH-F1-CHECK-THROUGH');
assert.ok(f1Semantic, 'F1 creates and finalizes a semantic hand');
assert.notStrictEqual(f1Semantic.handIdentity.lifecycleHandId, f1Semantic.handIdentity.handId, 'F1 supports distinct lifecycle and authoritative identities');
assert.strictEqual(f1Semantic.handIdentity.previousHandId, null, 'F1 has no prior completed lifecycle hand');
var f1Evidence = harnessSupport.showdownDebugEntries(f1.harness, 'showdown-evidence-completeness').slice(-1)[0];
assert.deepStrictEqual(Array.from(f1Evidence.flopEntrantPlayerIds).sort(), ['P1', 'P2']);
assert.deepStrictEqual(Array.from(f1Evidence.showdownParticipantIds).sort(), ['P1', 'P2'], 'F1 establishes both live river checkers as showdown members');
assert.ok(f1Evidence.playerStates.every(function (player) { return player.folded === false && player.reachedShowdown === true; }));
var f1Readiness = harnessSupport.showdownDebugEntries(f1.harness, 'finalization-readiness').slice(-1)[0];
assert.ok(f1Readiness.ready && f1Readiness.settlementObserved && f1Readiness.settlementRetained && f1Readiness.terminalPhaseKnown, 'F1 retains complete terminal evidence');
var f1Diagnostic = f1.harness.context.PokerNowHUDDebug.exportShowdownDiagnostics().hands.find(function (hand) {
  return hand.identityAliases.includes('AUTH-F1-CHECK-THROUGH');
});
assert.ok(f1Diagnostic && f1Diagnostic.classification === 'counted_correctly', 'F1 structured diagnostic traces reducer through rendering');

// F2: same game/session after the first completed hand. Reloading the content
// instance exercises persisted finalized identity and is also the required
// reload-after-first-showdown case; the second identical hand adds exactly one.
var f2Harness = create('fresh-first-check-through', f1.harness.storage, f1.sessionStorageBacking);
var f2Scenario = frames.ordinary('muck', 'AUTH-F2-CHECK-THROUGH');
harnessSupport.dispatchFrames(f2Harness, f2Scenario.frames, 'fresh-second-check-through');
assert.deepStrictEqual(counters(f2Harness, f1.setup.keys, 'P1'), [2, 2, 2, 2], 'F2 winner totals include both check-through showdowns once');
assert.deepStrictEqual(counters(f2Harness, f1.setup.keys, 'P2'), [2, 2, 2, 0], 'F2 unshown loser totals include both check-through showdowns once');
assert.strictEqual(reductions(f2Harness).filter(function (entry) { return entry.reduced; }).length, 1, 'reloaded instance reduces only the new second hand');

// Fresh first-hand all-in runout remains supported.
var allIn = runFresh('fresh-first-allin', 'postflop-allin', 'AUTH-FRESH-ALLIN', false);
assert.deepStrictEqual(counters(allIn.harness, allIn.setup.keys, 'P1'), [1, 1, 1, 1]);
assert.deepStrictEqual(counters(allIn.harness, allIn.setup.keys, 'P2'), [1, 1, 1, 0]);

// Fresh first-hand river foldout must not gain a false showdown numerator.
var foldout = runFresh('fresh-first-river-fold', 'river-fold', 'AUTH-FRESH-FOLD', false);
assert.deepStrictEqual(counters(foldout.harness, foldout.setup.keys, 'P1'), [1, 0, 0, 0]);
assert.deepStrictEqual(counters(foldout.harness, foldout.setup.keys, 'P2'), [1, 0, 0, 0]);

// Revealed versus unshown terminal presentation cannot change any established
// statistic outside the four showdown counters.
var revealed = runFresh('fresh-first-revealed-control', 'showdown', 'AUTH-FRESH-REVEALED', false);
['P1', 'P2'].forEach(function (playerId) {
  var inferredStats = stats(f1.harness, f1.setup.keys, playerId);
  var revealedStats = stats(revealed.harness, revealed.setup.keys, playerId);
  NEUTRAL_FIELDS.forEach(function (field) {
    assert.strictEqual(inferredStats[field], revealedStats[field], playerId + ' ' + field + ' remains value-for-value neutral');
  });
});

console.log('Fresh-game first and second check-through showdowns, muck evidence, all-in, foldout, duplicate, reload, identity, and neutrality passed.');
